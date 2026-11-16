# UX P3 — inicio del distribuidor y tablas en móvil

Rama: `daniel` · Entrega: commits por unidad · Runner: `node node_modules/vitest/vitest.mjs run`

Objetivo: quitar datos de ejemplo del inicio y hacer que las tablas se lean en móvil sin scroll horizontal.

## Specs

- **S1** — «quitar la vista de ejemplo del inicio del distribuidor». El inicio del distribuidor muestra solo datos y accesos reales; la vista de ejemplo y sus constantes desaparecen.
- **S2** — «Adapta las tablas a movil, si no es posible o es molesto al usar, que otras opciones hay para mostrar la informacion?». En pantallas angostas cada fila se presenta como tarjeta con rótulos (`data-label`); en escritorio se conserva la tabla. Las tablas densas de admin que no se migran conservan scroll horizontal.
- **S3** — Explicar la propuesta de «Vincular tienda» contextual (sin cambio de código en esta unidad).

## Tareas

- **T1** — Quitar la vista de ejemplo del inicio del distribuidor. Ruta: inline. Estado: hecho.
- **T2** — Primitiva `ResponsiveTable` + estilos `.responsive-table`. Ruta: inline. Estado: hecho.
- **T3** — Migrar Pedidos, Faltantes, Fiado, Detalle de pedido, Dashboard, Tiendas, Distribuidores y las tablas de `DataTable` (inventario, usuarios, roles, catálogos, auditoría). Ruta: inline. Estado: hecho.
- **T4** — Verificación y commits. Ruta: inline. Estado: hecho.

## Log

- **L1** — «quitar la vista de ejemplo del inicio del distribuidor. A que te refieres con "Vincular tienda" contextual?. Adapta las tablas a movil, si no es posible o es molesto al usar, que otras opciones hay para mostrar la informacion?»
- **L2** — Decisión: se usa una sola tabla en el DOM (sin duplicar markup) y CSS con `data-label`; así los tests y la semántica de tabla se mantienen, y no hay parpadeo por `matchMedia`.
- **L3** — Límite: la comparativa de planes se deja con scroll horizontal por densidad; Auditoría se migra automáticamente porque usa `DataTable`.
