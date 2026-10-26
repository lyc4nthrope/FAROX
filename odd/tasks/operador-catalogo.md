# Catálogo del operador: alta ágil, filtros, cantidad, faltantes y pedidos

Rama: `feat/operador-catalogo` · Entrega: commits por unidad en la rama (push al cerrar) · Runner: `npm.cmd` + `npx.cmd vitest`

## Specs

- **S1** — En `/products` (vista del operador: `MyCatalogPage`), el botón **“Agregar producto”** queda a la derecha del título `Productos`, alineado con él (“al lado derecho de la pagina al nivel del titulo de productos este el boton agregar”). Al tocarlo, **abre una ventana emergente (modal)** con el alta; Escape, “Cerrar” o el clic en el fondo la cierran.
- **S2** — En la ventana de alta se puede **buscar en el registro global en el servidor** (por nombre, no solo la página cargada) y hay una opción **“Crear producto”** en la misma ventana (“para agregar se pueda buscar o este la opcion de crear producto cerca para mayor agilidad”). El producto creado se asigna automáticamente al catálogo actual y aparece en él.
- **S3** — El catálogo propio se puede **filtrar** (“se pueda filtrar los productos que se tienen en el catologo”): búsqueda por nombre en el servidor, filtro por categoría y filtro “Solo faltantes”. Cambiar un filtro vuelve a la página 0.
- **S4** — Cada fila del catálogo de tienda permite **editar la cantidad** en stock y guardarla **sin generar ningún movimiento** (“se pueda modificar la cantidad (sin generar ningun movimiento)”). La cantidad no puede ser negativa; el guardado actualiza `stock.quantity` y re-evalúa la alerta de stock, sin insertar en `movements`.
- **S5** — Se puede **eliminar un producto del catálogo**. Sin existencias pide **una** confirmación. Con existencias pide **doble verificación** (“pueda eliminar un producto del catalog con doble verificacion si tiene stock”): la segunda advierte exactamente cuántas unidades se descartan. El backend exige `p_confirm_stock = true` en ese caso, registra la salida con el motivo `ajuste` (trazabilidad del ledger) y borra la fila de `stock`.
- **S6** — Cada fila tiene la opción **“Marcar faltante” / “Quitar faltante”** (“los productos tenga la opcion de marcar como faltante”). El estado se guarda en `stock.is_shortage` vía RPC y sobrevive al refetch.
- **S7** — El distribuidor tiene una vista **`/faltantes`** con los productos que sus tiendas vinculadas marcaron como faltantes (“cuando vayan a la vista de distribuidores pueda ver que productos deberia pedir (porque marco que le faltaban)”), **agrupados por tienda**, con nombre, marca, unidad, categoría, stock actual contra la base y estado (sin stock / reponer). La RPC valida el vínculo tienda ↔ distribuidor; un distribuidor no puede ver faltantes de tiendas no vinculadas.
- **S8** — La lista soporta **cientos de productos** (“Que la listo de productos soporte cientos de productos en la vista, sea por paginacion o por scrolling”): se mantiene paginación server-side (25/página, `Pager`) y **todo filtro se aplica en el servidor** con `.range()` + `count: 'planned'`, nunca filtrando solo la página cargada.
- **S9** — Los errores nuevos se traducen con `mapError` (nunca texto crudo). El administrador conserva el flujo actual. La migración nueva se entrega como archivo para aplicar a mano (el MCP de Supabase está en `read_only`).

## Tasks

- [x] T1 (S4, S5, S6, S7) — Migración `20261025000022_catalogo_operador.sql`: columna `stock.is_shortage`, índice parcial, RPCs `set_store_product_quantity`, `remove_store_product`, `set_store_shortage`, `list_shortage_products`, grants. Test de contrato SQL. Ruta inline. Commit `b29cca7`.
- [x] T2 (S3, S6, S8) — `useList` con `setQuery` + `ListQuery` extendido; api del catálogo con filtros server-side, `is_shortage` y las RPCs nuevas; tests de contrato. Ruta inline. Commit `f8c706f`.
- [x] T3 (S1, S3, S4, S5, S6, S8) — `MyCatalogPage` + `CatalogBox` + `ProductList`: botón de encabezado, filtros, cantidad editable, baja con doble confirmación, toggle de faltante. Tests de UI. Ruta inline. Commit `f8c706f`.
- [x] T4 (S2) — Alta ágil: búsqueda server-side en el registro global + “Crear producto” inline reutilizando `ProductForm`, con asignación automática. Tests de UI. Ruta inline. Commit `f8c706f`.
- [x] T5 (S7) — Vista `/faltantes` agrupada por tienda + ruta + navegación + tests. Ruta inline. Commit `cdff737`.
- [x] T6 (S9) — Gate completo (typecheck, lint, tests, check-scope), `supabase/APLICAR-EN-PRODUCCION.md` y este documento. Ruta inline.
- [x] T7 (S1, S2) — Alta en **ventana emergente**: `Modal` compartido (rol `dialog`, Escape, fondo, foco al buscador y retorno al disparador, bloqueo de scroll) + `MyCatalogPage` lo usa; tests del primitivo y de la pantalla. Ruta inline. Commit `a753e19`.

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

### L3 — Implementación, decisiones de alcance y evidencia (2026-10-26)

- **S7 sin selector de tienda ni enlace a “Nuevo pedido”.** El agrupamiento por tienda ya cumple el pedido original y evita un selector redundante. El enlace se descartó con evidencia: `/pedidos/nuevo` está detrás de `RequireRole roles={ADMIN_OR_OPERATOR}` en `src/app/router.tsx`, así que un distribuidor que lo abriera chocaría con el guard; y `NewOrderPage` solo prellena `?storeId=` (no productos). Se prefirió no ofrecer un enlace que no puede completar el flujo.
- **Cantidad sin movimiento**: `set_store_product_quantity` actualiza `stock.quantity` y llama `internal_eval_stock_alert`; no inserta en `movements`. Tradeoff de L2 confirmado.
- **Filtros en el servidor**: `product:products!inner(...)` — sin `!inner` PostgREST no recorta las filas de `stock` por los filtros del embed y el filtro queda decorativo. La búsqueda escapa `\ % _` para que el término sea literal.
- **Alta rápida**: `createProduct` ahora devuelve `id` (`.select("id").single()`) para asignar el producto a la tienda en el mismo paso; `ProductFormPage` sigue usando solo `error`.
- **`useList` genérico**: `setQuery` fusiona filtros y vuelve a página 0; el catálogo no se remonta al agregar (`reloadToken` → `refetch`), así no se pierden búsqueda, filtros ni página.
- **§S8-4 y los grants**: el test de contrato ya no puede nombrar el rol de servidor (el gate prohíbe ese literal en `src/`), así que valida la forma del `GRANT` (4 firmas, sin `PUBLIC`/`anon`, exactamente 2 roles) y el `REVOKE` a `PUBLIC, anon`.
- **Evidencia**: `npm run lint` OK · `npm run typecheck` OK · `npm run test` 67 archivos / 552 tests verdes · `npm run check-scope` §S8 OK (235 archivos). Commits: `d8a3c41` (barcode opcional + escaneo), `f8c706f` (filtros, cantidad, baja y faltante), `cdff737` (`/faltantes`), `96769a4` (seed demo), `b29cca7` (0022), `d47aad7` (plan).
- **Pendiente manual (bloquea la verificación real)**: aplicar `20261025000022_catalogo_operador.sql` y, si se quieren datos demo, `supabase/seed.sql` desde el SQL Editor. Hasta entonces el comportamiento de las 4 RPCs nuevas no está verificado contra una base real; la UI y los contratos SQL están cubiertos por tests.
- **No verificado en dispositivo real**: el escaneo con cámara (jsdom no decodifica video); los tests cubren estructura y presencia/ausencia del control.

### L4 — Alta como ventana emergente (2026-10-26)

> Cuando se presiona agregar que lo dirija hacia abajo o que sea una ventana emergente.

- Se eligió **ventana emergente**: no alarga la página ni obliga a scrollear con cientos de productos, y el buscador queda enfocado al abrir.
- `src/shared/ui/Modal.tsx` es un primitivo reutilizable: `role="dialog"` + `aria-modal`, Escape y clic en el fondo cierran, botón “Cerrar”, bloquea el scroll del `body` y devuelve el foco al disparador.
- Trampa encontrada: el foco previo se capturaba en un `useEffect`, pero `autoFocus` del buscador ya había movido el foco al montar, así que al cerrar se intentaba enfocar el input eliminado. Se captura en el render (`useRef` inicializado) y el efecto solo enfoca el contenedor si el contenido no se autoenfocó.
- `AddProductsPanel` perdió su marco propio (`<Box>`); ahora lo aporta `Modal`. Se removió el toggle de etiqueta del botón de encabezado: siempre dice “Agregar producto”.
- **Evidencia**: `npm run lint` OK · `npm run typecheck` OK · `npm run test` 68 archivos / 558 tests verdes · `npm run check-scope` §S8 OK (237 archivos).
