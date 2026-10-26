# CatÃ¡logo del operador: alta Ã¡gil, filtros, cantidad, faltantes y pedidos

Rama: `feat/operador-catalogo` Â· Entrega: commits por unidad en la rama (push al cerrar) Â· Runner: `npm.cmd` + `npx.cmd vitest`

## Specs

- **S1** â€” En `/products` (vista del operador: `MyCatalogPage`), el botÃ³n **â€œAgregar productoâ€** queda a la derecha del tÃ­tulo `Productos`, alineado con Ã©l (â€œal lado derecho de la pagina al nivel del titulo de productos este el boton agregarâ€). Al tocarlo, **abre una ventana emergente (modal)** con el alta; Escape, â€œCerrarâ€ o el clic en el fondo la cierran.
- **S2** â€” En la ventana de alta se puede **buscar en el registro global en el servidor** (por nombre, no solo la pÃ¡gina cargada) y hay una opciÃ³n **â€œCrear productoâ€** en la misma ventana (â€œpara agregar se pueda buscar o este la opcion de crear producto cerca para mayor agilidadâ€). El producto creado se asigna automÃ¡ticamente al catÃ¡logo actual y aparece en Ã©l.
- **S3** â€” El catÃ¡logo propio se puede **filtrar** (â€œse pueda filtrar los productos que se tienen en el catologoâ€): bÃºsqueda por nombre en el servidor, filtro por categorÃ­a y filtro â€œSolo faltantesâ€. Cambiar un filtro vuelve a la pÃ¡gina 0.
- **S4** â€” Cada fila del catÃ¡logo de tienda permite **editar la cantidad** en stock y guardarla **sin generar ningÃºn movimiento** (â€œse pueda modificar la cantidad (sin generar ningun movimiento)â€). La cantidad no puede ser negativa; el guardado actualiza `stock.quantity` y re-evalÃºa la alerta de stock, sin insertar en `movements`.
- **S5** â€” Se puede **eliminar un producto del catÃ¡logo**. Sin existencias pide **una** confirmaciÃ³n. Con existencias pide **doble verificaciÃ³n** (â€œpueda eliminar un producto del catalog con doble verificacion si tiene stockâ€): la segunda advierte exactamente cuÃ¡ntas unidades se descartan. El backend exige `p_confirm_stock = true` en ese caso, registra la salida con el motivo `ajuste` (trazabilidad del ledger) y borra la fila de `stock`.
- **S6** â€” Cada fila tiene la opciÃ³n **â€œMarcar faltanteâ€ / â€œQuitar faltanteâ€** (â€œlos productos tenga la opcion de marcar como faltanteâ€). El estado se guarda en `stock.is_shortage` vÃ­a RPC y sobrevive al refetch.
- **S7** â€” El distribuidor tiene una vista **`/faltantes`** con los productos que sus tiendas vinculadas marcaron como faltantes (â€œcuando vayan a la vista de distribuidores pueda ver que productos deberia pedir (porque marco que le faltaban)â€), **agrupados por tienda**, con nombre, marca, unidad, categorÃ­a, stock actual contra la base y estado (sin stock / reponer). La RPC valida el vÃ­nculo tienda â†” distribuidor; un distribuidor no puede ver faltantes de tiendas no vinculadas.
- **S8** â€” La lista soporta **cientos de productos** (â€œQue la listo de productos soporte cientos de productos en la vista, sea por paginacion o por scrollingâ€): se mantiene paginaciÃ³n server-side (25/pÃ¡gina, `Pager`) y **todo filtro se aplica en el servidor** con `.range()` + `count: 'planned'`, nunca filtrando solo la pÃ¡gina cargada.
- **S9** â€” Los errores nuevos se traducen con `mapError` (nunca texto crudo). El administrador conserva el flujo actual. La migraciÃ³n nueva se entrega como archivo para aplicar a mano (el MCP de Supabase estÃ¡ en `read_only`).

## Tasks

- [x] T1 (S4, S5, S6, S7) â€” MigraciÃ³n `20261025000022_catalogo_operador.sql`: columna `stock.is_shortage`, Ã­ndice parcial, RPCs `set_store_product_quantity`, `remove_store_product`, `set_store_shortage`, `list_shortage_products`, grants. Test de contrato SQL. Ruta inline. Commit `b29cca7`.
- [x] T2 (S3, S6, S8) â€” `useList` con `setQuery` + `ListQuery` extendido; api del catÃ¡logo con filtros server-side, `is_shortage` y las RPCs nuevas; tests de contrato. Ruta inline. Commit `f8c706f`.
- [x] T3 (S1, S3, S4, S5, S6, S8) â€” `MyCatalogPage` + `CatalogBox` + `ProductList`: botÃ³n de encabezado, filtros, cantidad editable, baja con doble confirmaciÃ³n, toggle de faltante. Tests de UI. Ruta inline. Commit `f8c706f`.
- [x] T4 (S2) â€” Alta Ã¡gil: bÃºsqueda server-side en el registro global + â€œCrear productoâ€ inline reutilizando `ProductForm`, con asignaciÃ³n automÃ¡tica. Tests de UI. Ruta inline. Commit `f8c706f`.
- [x] T5 (S7) â€” Vista `/faltantes` agrupada por tienda + ruta + navegaciÃ³n + tests. Ruta inline. Commit `cdff737`.
- [x] T6 (S9) â€” Gate completo (typecheck, lint, tests, check-scope), `supabase/APLICAR-EN-PRODUCCION.md` y este documento. Ruta inline.
- [x] T7 (S1, S2) â€” Alta en **ventana emergente**: `Modal` compartido (rol `dialog`, Escape, fondo, foco al buscador y retorno al disparador, bloqueo de scroll) + `MyCatalogPage` lo usa; tests del primitivo y de la pantalla. Ruta inline. Commit `a753e19`.

## Log

### L1 â€” Pedido original (2026-10-26)

> Quiero que la vista de los productos del operador mejore, que al lado derecho de la pagina al nivel del titulo de productos este el boton agregar para agregar un producto facilmente, que para agregar se pueda buscar o este la opcion de crear producto cerca para mayor agilidad, que se pueda filtrar los productos que se tienen en el catologo, que se pueda modificar la cantidad (sin generar ningun movimiento), que pueda eliminar un producto del catalog con doble verificacion si tiene stock, que los productos tenga la opcion de marcar como faltante y que cuando vayan a la vista de distribuidores pueda ver que productos deberia pedir (porque marco que le faltaban). Que la listo de productos soporte cientos de productos en la vista, sea por paginacion o por scrolling.

### L2 â€” DiagnÃ³stico y decisiones (2026-10-26)

- El catÃ¡logo del operador **es** `stock`: `fetchStoreCatalog` lee `stock` con el producto embebido, asÃ­ que â€œmis productosâ€, la cantidad y el faltante son la misma fila `(product_id, store_id)`.
- Hoy la cantidad es de solo lectura y `unassign_product_from_store` **rechaza** quitar con `quantity > 0`. Ambas cosas cambian con RPCs nuevas; no se reescribe la RPC existente (la usan otros flujos).
- â€œSin generar ningÃºn movimientoâ€ se implementa como update directo de `stock.quantity` + `internal_eval_stock_alert`, sin insertar en `movements`. Tradeoff aceptado y explÃ­cito: el ledger deja de cuadrar con el stock cuando se usa esta ediciÃ³n.
- La baja con stock **sÃ­** registra un movimiento de salida con motivo `ajuste` antes de borrar la fila: el usuario aceptÃ³ descartar existencias, y el ledger debe reflejarlo en vez de perderlas en silencio.
- Faltante = `stock.is_shortage boolean` (no tabla nueva). Ventaja: la baja del catÃ¡logo lo elimina solo, y la lectura del operador entra en el mismo select paginado. El distribuidor lo lee por RPC `list_store_shortages`, que valida `store_distributors` porque la RLS de `stock` no le da acceso a tiendas sin pedido/ruta.
- `products_insert` ya permite `operador AND has_scope()` en la DB; el bloqueo de â€œcrear productoâ€ era solo de UI (0019/S7). Se habilita un alta inline en el panel del catÃ¡logo, no la ruta `/products/new`.
- PaginaciÃ³n (no scroll infinito): ya existe `useList` + `Pager` con 25/pÃ¡gina y estÃ¡ probado; se extiende con filtros server-side.
- La migraciÃ³n no se puede aplicar desde el agente (MCP `read_only` + `supabase_execute_sql` denegado): queda como archivo para el SQL Editor, igual que `supabase/seed.sql`.

### L3 â€” ImplementaciÃ³n, decisiones de alcance y evidencia (2026-10-26)

- **S7 sin selector de tienda ni enlace a â€œNuevo pedidoâ€.** El agrupamiento por tienda ya cumple el pedido original y evita un selector redundante. El enlace se descartÃ³ con evidencia: `/pedidos/nuevo` estÃ¡ detrÃ¡s de `RequireRole roles={ADMIN_OR_OPERATOR}` en `src/app/router.tsx`, asÃ­ que un distribuidor que lo abriera chocarÃ­a con el guard; y `NewOrderPage` solo prellena `?storeId=` (no productos). Se prefiriÃ³ no ofrecer un enlace que no puede completar el flujo.
- **Cantidad sin movimiento**: `set_store_product_quantity` actualiza `stock.quantity` y llama `internal_eval_stock_alert`; no inserta en `movements`. Tradeoff de L2 confirmado.
- **Filtros en el servidor**: `product:products!inner(...)` â€” sin `!inner` PostgREST no recorta las filas de `stock` por los filtros del embed y el filtro queda decorativo. La bÃºsqueda escapa `\ % _` para que el tÃ©rmino sea literal.
- **Alta rÃ¡pida**: `createProduct` ahora devuelve `id` (`.select("id").single()`) para asignar el producto a la tienda en el mismo paso; `ProductFormPage` sigue usando solo `error`.
- **`useList` genÃ©rico**: `setQuery` fusiona filtros y vuelve a pÃ¡gina 0; el catÃ¡logo no se remonta al agregar (`reloadToken` â†’ `refetch`), asÃ­ no se pierden bÃºsqueda, filtros ni pÃ¡gina.
- **Â§S8-4 y los grants**: el test de contrato ya no puede nombrar el rol de servidor (el gate prohÃ­be ese literal en `src/`), asÃ­ que valida la forma del `GRANT` (4 firmas, sin `PUBLIC`/`anon`, exactamente 2 roles) y el `REVOKE` a `PUBLIC, anon`.
- **Evidencia**: `npm run lint` OK Â· `npm run typecheck` OK Â· `npm run test` 67 archivos / 552 tests verdes Â· `npm run check-scope` Â§S8 OK (235 archivos). Commits: `d8a3c41` (barcode opcional + escaneo), `f8c706f` (filtros, cantidad, baja y faltante), `cdff737` (`/faltantes`), `96769a4` (seed demo), `b29cca7` (0022), `d47aad7` (plan).
- **Pendiente manual (bloquea la verificaciÃ³n real)**: aplicar `20261025000022_catalogo_operador.sql` y, si se quieren datos demo, `supabase/seed.sql` desde el SQL Editor. Hasta entonces el comportamiento de las 4 RPCs nuevas no estÃ¡ verificado contra una base real; la UI y los contratos SQL estÃ¡n cubiertos por tests.
- **No verificado en dispositivo real**: el escaneo con cÃ¡mara (jsdom no decodifica video); los tests cubren estructura y presencia/ausencia del control.

### L4 â€” Alta como ventana emergente (2026-10-26)

> Cuando se presiona agregar que lo dirija hacia abajo o que sea una ventana emergente.

- Se eligiÃ³ **ventana emergente**: no alarga la pÃ¡gina ni obliga a scrollear con cientos de productos, y el buscador queda enfocado al abrir.
- `src/shared/ui/Modal.tsx` es un primitivo reutilizable: `role="dialog"` + `aria-modal`, Escape y clic en el fondo cierran, botÃ³n â€œCerrarâ€, bloquea el scroll del `body` y devuelve el foco al disparador.
- Trampa encontrada: el foco previo se capturaba en un `useEffect`, pero `autoFocus` del buscador ya habÃ­a movido el foco al montar, asÃ­ que al cerrar se intentaba enfocar el input eliminado. Se captura en el render (`useRef` inicializado) y el efecto solo enfoca el contenedor si el contenido no se autoenfocÃ³.
- `AddProductsPanel` perdiÃ³ su marco propio (`<Box>`); ahora lo aporta `Modal`. Se removiÃ³ el toggle de etiqueta del botÃ³n de encabezado: siempre dice â€œAgregar productoâ€.
- **Evidencia**: `npm run lint` OK Â· `npm run typecheck` OK Â· `npm run test` 68 archivos / 558 tests verdes Â· `npm run check-scope` Â§S8 OK (237 archivos).
