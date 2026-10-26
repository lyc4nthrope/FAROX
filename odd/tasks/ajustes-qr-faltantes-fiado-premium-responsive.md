# Ajustes: QR a demanda, faltantes del operador, fiado, premium con candado y responsive

Rama: `feat/operador-catalogo` · Entrega: commits por unidad · Runner: `npm.cmd` + `npx.cmd vitest`

## Specs

- **S1** — El QR de vínculo se genera **a demanda** (nunca automáticamente) y, cuando la tienda **no tiene ningún distribuidor vinculado**, su bloque aparece de inmediato con el título “Vinculá algún distribuidor”, el QR, el código, el botón **“Generar código”** y una explicación de cómo funciona el vínculo. Con vínculos, el bloque queda plegado y el botón pasa a “Generar código nuevo” (pide confirmación y el anterior deja de servir).
- **S2** — Los productos faltantes los ve **solo el operador asignado a esa tienda** (admin ve todas); el distribuidor **no** ve faltantes en ninguna vista. `list_shortage_products()` deja de resolver por vínculo de distribuidor y resuelve por `my_store_ids()`.
- **S3** — Desde `/faltantes`, el operador **solicita** los faltantes a un distribuidor vinculado: se abre `/pedidos/nuevo` con la tienda, el distribuidor y los productos faltantes preseleccionados. Sin distribuidores vinculados, la página invita a vincular uno.
- **S4** — El **fiado** se puede crear desde un pedido entregado también por el **operador dueño de la tienda** (antes solo admin, por guarda de DB y de UI). Los pagos ya estaban permitidos al operador.
- **S5** — Las acciones **Premium** se muestran **bloqueadas con candado** y una **vista previa** de lo que desbloquean, en vez de un botón deshabilitado con texto plano. Aplica a movimientos manuales de inventario y sus variantes Premium.
- **S6** — **Todas las vistas son responsive**: usables a 360 px de ancho (tablas con scroll propio, grillas que colapsan, modal a ancho completo, shell/navegación, paginador y formularios).

## Tasks

- [x] T1 (S1) — Estado vacío del QR + generación a demanda + explicación del vínculo. Ruta inline. Commit `025705c`.
- [x] T2 (S2) — Migración 0023: `list_shortage_products()` por rol; `/faltantes` solo admin/operador; navegación; tests. Commit `feat(shortage): scope the shortage board to the store operator` (0023 en el árbol, pendiente de aplicar en Supabase).
- [x] T3 (S3) — “Solicitar faltantes” → `/pedidos/nuevo` con preselección; estado sin distribuidores. Commit `9a1813e` (+ `dab23cb` corrige el timing del test).
- [x] T4 (S4) — `create_credit` para operador de la tienda + bloque “Fiado” visible al operador; tests. Commit `c88208b`.
- [x] T5 (S5) — `PremiumLock` (candado, beneficios y vista previa) en inventario, dashboard y QR masivo. Commit `225b338`.
- [x] T6 (S6) — Pasada responsive: scroll por tabla, filas que envuelven, modal y shell ya móviles. Commit `77029d3`.
- [x] T7 — Gate completo, runbook de la 0023, manual de uso y este documento. Commit `docs(odd): close the adjustments feature`.

## Log

### L1 — Pedido original (2026-10-26)

> Otra cosa es que el codigo qr del operador (dueño de la tienda) se genere, no sea el mismo de siempre. Que los productos faltantes solo lo veo el operador asignado a esa tienda, el distribuidor no lo ve a menos que un operador de esa tienda solicite el producto faltante a el.
> Otra cosa que veo, es que no se puede crear un "fiado", y las acciones que son premium deberian salir ocn un candado, con un vista previa para llamar la atencion.

> Garantiza que todas las vistas sean responsive

### L2 — Aclaración del QR (2026-10-26)

> que se genere a demanda, pero cuadno hay ningun distribuidor aparece inmediatamente, donde creo qeu deberia decir vincula algun distribuidor y aparezca el boton de generar y explicar como funciona eso de vincular.

Decisiones: no hay rotación automática (rompería QR impresos); el código ya es aleatorio por tienda desde 0017, así que “a demanda” = botón explícito. El bloque del código se muestra de entrada cuando no hay vínculos y queda plegado cuando ya hay.

### L3 — Evidencia (2026-10-26)

- Gate verde: `lint` + `typecheck` + `test` (71 archivos / 573 tests) + `check-scope` (241 archivos, §S8 OK).
- T1: `StoreLinkPages.tsx` muestra el bloque desde el inicio sin vínculos (`Vinculá algún distribuidor`, 3 pasos, `Generar código` sin confirmación) y lo deja plegado con vínculos (`Generar código nuevo`, con confirmación porque invalida el anterior). `DistributorsPage.test.tsx` actualizado.
- T2: 0023 acota `list_shortage_products()` a admin/`my_store_ids()` y quita `/faltantes` de la navegación del distribuidor; `router.tsx` la exige `ADMIN_OR_OPERATOR`.
- T3: `ShortageRequest` autoselecciona el primer distribuidor vinculado y arma `/pedidos/nuevo?...&faltantes=1,4`; `NewOrderPage` prefiltra solo productos con precio y cantidad 1.
- T4: el bloque Fiado aparece para admin y operador con el pedido entregado; `OrderDetailPage.test.tsx` cubre los tres casos.
- T5: `PremiumLock` deja la UI real deshabilitada (`fieldset disabled`), lista lo que desbloquea y muestra una vista previa decorativa (`aria-hidden`). Se aplica en Registrar entrada o salida, Dashboard analítico (con `ExampleDashboard`) y QR masivo (en Distribuidores del operador).
- T6: `overflow-x-auto` en las 10 tablas propias de features y en `DataTable`; `flex-wrap` en barras de filtros, acciones de formularios, líneas de pedido, paginador, rango de fechas del dashboard y header de la landing. Modal y shell ya eran móviles (`w-full max-w-3xl`, menú colapsable).
- Pendiente de verificación real: 0022 y 0023 sin aplicar en Supabase; `create_credit` y el tablero de faltantes solo se validan en la DB.