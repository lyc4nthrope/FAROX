# UX P4 — vínculo contextual y alta de productos en móvil

Rama: `daniel` · Entrega: commits por unidad · Runner: `node node_modules/vitest/vitest.mjs run`

Objetivo: sacar del nav la acción de configuración del distribuidor y hacer usable el alta de productos en móvil.

## Specs

- **S1** — «Vincular tienda» deja de ser una entrada fija del nav del distribuidor. Se ofrece donde hace falta: Perfil, estado vacío de Mis pedidos y estado vacío de tiendas en Mi ruta. La ruta `/vincular` y `/vincular/:code` siguen funcionando.
- **S2** — El modal «Agregar productos» muestra cada fila como tarjeta en pantallas angostas, conservando precio, stepper y botón «Agregar». En escritorio mantiene la tabla.

## Tareas

- **T1** — Nav + CTAs contextuales de vínculo. Ruta: inline. Estado: hecho.
- **T2** — Filas del alta de productos como tarjetas en móvil. Ruta: inline. Estado: hecho.
- **T3** — Verificación y commits. Ruta: inline. Estado: hecho.

## Log

- **L1** — «Si» (aprobación de la propuesta: «¿Querés que implemente "Vincular tienda" contextual y las tarjetas del modal "Agregar productos" en la próxima?»).
- **L2** — Decisión: el CTA de Perfil se muestra solo al rol distribuidor; los estados vacíos de pedidos y de tiendas lo muestran porque esas vistas ya son del distribuidor o tienen el rol resuelto.
