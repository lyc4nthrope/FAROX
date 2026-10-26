# Catálogo del operador: alta ágil, filtros, cantidad, faltantes y pedidos

Rama: `feat/operador-catalogo` · Entrega: commits por unidad en la rama (push al cerrar) · Runner: `npm.cmd` + `npx.cmd vitest`

## Specs

- **S1** — En `/products` (vista del operador: `MyCatalogPage`), el botón **“Agregar producto”** queda a la derecha del título `Productos`, alineado con él (“al lado derecho de la pagina al nivel del titulo de productos este el boton agregar”). Al tocarlo, abre/enfoca el panel de alta.
- **S2** — En el panel de alta se puede **buscar en el registro global en el servidor** (por nombre, no solo la página cargada) y hay una opción **“Crear producto”** en el mismo panel (“para agregar se pueda buscar o este la opcion de crear producto cerca para mayor agilidad”). El producto creado se asigna automáticamente al catálogo actual y aparece en él.
- **S3** — El catálogo propio se puede **filtrar** (“se pueda filtrar los productos que se tienen en el catologo”): búsqueda por nombre en el servidor, filtro por categoría y filtro “Solo faltantes”. Cambiar un filtro vuelve a la página 0.
- **S4** — Cada fila del catálogo de tienda permite **editar la cantidad** en stock y guardarla **sin generar ningún movimiento** (“se pueda modificar la cantidad (sin generar ningun movimiento)”). La cantidad no puede ser negativa; el guardado actualiza `stock.quantity` y re-evalúa la alerta de stock, sin insertar en `movements`.
- **S5** — Se puede **eliminar un producto del catálogo**. Sin existencias pide **una** confirmación. Con existencias pide **doble verificación** (“pueda eliminar un producto del catalog con doble verificacion si tiene stock”): la segunda advierte exactamente cuántas unidades se descartan. El backend exige `p_confirm_stock = true` en ese caso, registra la salida con el motivo `ajuste` (trazabilidad del ledger) y borra la fila de `stock`.
- **S6** — Cada fila tiene la opción **“Marcar faltante” / “Quitar faltante”** (“los productos tenga la opcion de marcar como faltante”). El estado se guarda en `stock.is_shortage` vía RPC y sobrevive al refetch.
- **S7** — El distribuidor tiene una vista **`/faltantes`** con selector de tienda vinculada y la lista de productos que esa tienda marcó como faltantes (“cuando vayan a la vista de distribuidores pueda ver que productos deberia pedir (porque marco que le faltaban)”), con nombre, marca, unidad, categoría, cantidad actual y enlace a “Nuevo pedido”. La RPC valida el vínculo tienda ↔ distribuidor; un distribuidor no puede ver faltantes de tiendas no vinculadas.
- **S8** — La lista soporta **cientos de productos** (“Que la listo de productos soporte cientos de productos en la vista, sea por paginacion o por scrolling”): se mantiene paginación server-side (25/página, `Pager`) y **todo filtro se aplica en el servidor** con `.range()` + `count: 'planned'`, nunca filtrando solo la página cargada.
- **S9** — Los errores nuevos se traducen con `mapError` (nunca texto crudo). El administrador conserva el flujo actual. La migración nueva se entrega como archivo para aplicar a mano (el MCP de Supabase está en `read_only`).

## Tasks

- [ ] T1 (S4, S5, S6, S7) — Migración `20261025000022_catalogo_operador.sql`: columna `stock.is_shortage`, índice parcial, RPCs `set_store_product_quantity`, `remove_store_product`, `set_store_shortage`, `list_store_shortages`, RLS/Grants. Test de contrato SQL. Ruta inline.
- [ ] T2 (S3, S6, S8) — `useList` con `setQuery` + `ListQuery` extendido; api del catálogo con filtros server-side, `is_shortage` y las RPCs nuevas; tests de contrato. Ruta inline.
- [ ] T3 (S1, S3, S4, S5, S6, S8) — `MyCatalogPage` + `ProductList`: botón de encabezado, filtros, cantidad editable, baja con doble confirmación, toggle de faltante. Tests de UI. Ruta inline.
- [ ] T4 (S2) — Alta ágil: búsqueda server-side en el registro global + “Crear producto” inline reutilizando `ProductForm`, con asignación automática. Tests de UI. Ruta inline.
- [ ] T5 (S7) — Vista `/faltantes` del distribuidor + ruta + navegación + tests. Ruta inline.
- [ ] T6 (S9) — Gate completo (typecheck, lint, tests, check-scope), `supabase/README.md` y este documento. Ruta inline.

## Log

### L1 — Pedido original (2026-10-26)

> Quiero que la vista de los productos del operador mejore, que al lado derecho de la pagina al nivel del titulo de productos este el boton agregar para agregar un producto facilmente, que para agregar se pueda buscar o este la opcion de crear producto cerca para mayor agilidad, que se pueda filtrar los productos que se tienen en el catologo, que se pueda modificar la cantidad (sin generar ningun movimiento), que pueda eliminar un producto del catalog con doble verificacion si tiene stock, que los productos tenga la opcion de marcar como faltante y que cuando vayan a la vista de distribuidores pueda ver que productos deberia pedir (porque marco que le faltaban). Que la listo de productos soporte cientos de productos en la vista, sea por paginacion o por scrolling.

### L2 — Diagnóstico y decisiones (2026-10-26)

- El catálogo del operador **es** `stock`: `fetchStoreCatalog` lee `stock` con el producto embebido, así que “mis productos”, la cantidad y el faltante son la misma fila `(product_id, store_id)`.
- Hoy la cantidad es de solo lectura y `unassign_product_from_store` **rechaza** quitar con `quantity > 0`. Ambas cosas cambian con RPCs nuevas; no se reescribe la RPC existente (la usan otros flujos).
- “Sin generar ningún movimiento” se implementa como update directo de `stock.quantity` + `internal_eval_stock_alert`, sin insertar en `movements`. Tradeoff aceptado y explícito: el ledger deja de cuadrar con el stock cuando se usa esta edición.
- La baja con stock **sí** registra un movimiento de salida con motivo `ajuste` antes de borrar la fila: el usuario aceptó descartar existencias, y el ledger debe reflejarlo en vez de perderlas en silencio.
- Faltante = `stock.is_shortage boolean` (no tabla nueva). Ventaja: la baja del catálogo lo elimina solo, y la lectura del operador entra en el mismo select paginado. El distribuidor lo lee por RPC `list_store_shortages`, que valida `store_distributors` porque la RLS de `stock` no le da acceso a tiendas sin pedido/ruta.
- `products_insert` ya permite `operador AND has_scope()` en la DB; el bloqueo de “crear producto” era solo de UI (0019/S7). Se habilita un alta inline en el panel del catálogo, no la ruta `/products/new`.
- Paginación (no scroll infinito): ya existe `useList` + `Pager` con 25/página y está probado; se extiende con filtros server-side.
- La migración no se puede aplicar desde el agente (MCP `read_only` + `supabase_execute_sql` denegado): queda como archivo para el SQL Editor, igual que `supabase/seed.sql`.
