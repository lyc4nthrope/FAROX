# UX P2 — legibilidad, sistema visual y cartera

Rama: `daniel` · Entrega: commits por unidad · Runner: `node node_modules/vitest/vitest.mjs run`

Objetivo: cerrar la tercera prioridad de la auditoría UX sin tocar datos ni reglas de negocio.

## Specs

- **S1** — Microcopy legible: las micro-etiquetas suben a 12 px y a `gray-500` (antes 11 px y `gray-400`, ≈2.5:1 de contraste). No se repite el título de la página como eyebrow (Movimientos, Asistente) y Alertas deja de agruparse bajo «Inventario».
- **S2** — Un solo `PremiumBadge` para las insignias del shell, inicio, dashboard, paywall y aviso de límite de plan.
- **S3** — Las pestañas de Inventario (Productos, Movimientos, Precios) llevan icono para reconocerse sin leer.
- **S4** — Fiado se presenta como tabla de cartera con detalle en modal, en lugar de un formulario de pago por cada crédito apilado en la página.

## Tareas

- **T1** — Sistema visual: eyebrow, `PremiumBadge`, iconos de pestañas. Ruta: inline. Estado: hecho.
- **T2** — Cartera de fiado como tabla + detalle. Ruta: inline. Estado: hecho.
- **T3** — Verificación completa y commits. Ruta: inline. Estado: hecho.

## Log

- **L1** — «Si» (aprobación de continuar con P2).
- **L2** — Alcance P2 propuesto: «disciplina de eyebrows, contraste de microcopy, iconos en pestañas, `CreditsPage` como tabla + detalle».
- **L3** — Decisión: se aplicó el cambio de clase de eyebrow a todas las páginas (incluidas admin) para que el sistema quede parejo; el reemplazo es solo de clases, sin cambios de contenido.
