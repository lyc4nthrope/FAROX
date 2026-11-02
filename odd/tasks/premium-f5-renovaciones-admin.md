# FAROX — F5: renovaciones, avisos y administración de pagos

> **Objetivo:** que soporte pueda operar el ciclo Premium (planes, suscripciones, pagos, reembolsos y avisos) sin tocar SQL, y que las renovaciones/vencimientos se reconcilien y avisen a tiempo.
> **Rama:** `daniel`. **Entrega:** commits de unidad; sin push.
> **Runner:** `npm run test`, `typecheck`, `lint`, `check-scope`, `build`, `deno check`.
> **Plan de referencia:** `odd/tasks/premium-suscripciones-mercado-pago.md` (F5).

## Specs

- **S1. Panel de planes y precios (admin):** `/planes` lista `plans` y `plan_versions`; permite editar precio final, IVA, comisión fija/porcentual, IVA de comisión, `tax_included` y `active`; guarda con `update_plan_pricing` (crea versión). `fee_passed_to_customer` se muestra como no disponible y se guarda siempre `false`: la comisión se descuenta del recaudo, no se suma al precio. Previsualiza el desglose server-side con `preview_plan_quote`. No cambia el precio de suscripciones existentes; la UI lo advierte. No hay campaña automática de cambio de precio.
- **S2. Panel de pagos (admin):** `/pagos` lista suscripciones y pagos con usuario, plan, estado, monto, moneda, fechas y referencia de Mercado Pago; pagina con «Cargar más» y permite cancelar una suscripción y reembolsar un pago aprobado. Las acciones pasan por Edge Functions admin-only y quedan en `audit_log`. El cliente no escribe `subscriptions`, `payments` ni `premium`.
- **S3. Conciliación:** `reconcile-subscriptions` (Edge Function) consulta por lotes rotativos las suscripciones `pending`/`authorized`/`paused` y los pagos `pending` con referencia de Mercado Pago (`payments.last_reconciled_at`), actualiza estados y activa pagos aprobados reutilizando el mismo procesador del webhook. Se puede invocar por admin o por cron con `CRON_SECRET`; no duplica meses ni deja starvation a los pagos fuera del primer lote.
- **S4. Avisos:** migración `premium_notices` (outbox idempotente) y `send-premium-notices` (Edge Function) para renovación 7/3/1, gracia por vencer, vencimiento y pago rechazado. Usa Resend (`RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`); si no está configurado devuelve 503 y no marca avisos como enviados. No expone secretos ni datos de tarjeta.
- **S5. Gracia y downgrade:** se mantienen los jobs de 0032/0033; los avisos de gracia/vencimiento se enqueue con la fecha real. No se borran datos; las tiendas pausadas conservan stock, pedidos, rutas y créditos.
- **S6. Reembolsos y contracargos:** `refund-payment` reembolsa en Mercado Pago y marca `payments.status='refunded'`; el webhook registra `refunded`/`charged_back` sin revocar Premium automáticamente. La revocación manual sigue siendo decisión admin (`set_user_premium`). Toda acción queda auditada.
- **S7. Precio nuevo vs existentes:** `create-subscription` sigue usando la última `plan_versions`; las suscripciones existentes conservan `price_cents_at_signup` y el monto autorizado en Mercado Pago. Cambiar el precio no actualiza cobros existentes.
- **S8. Tests:** unitarios de plantillas/fechas, preview de precio, paneles admin, conciliación (mocks), reembolso/cancelación admin y migración 0036; typecheck, lint, check-scope, build y Deno check. Sin credenciales reales no se declara PASS sandbox.
- **S9. Fuera de alcance (F6):** revisión legal final, facturación DIAN, PQR, feature flags, canary/rollback y campaña masiva de precio.

## Tasks

| ID | Specs | Ruta | Estado | Evidencia |
|---|---|---|---|---|
| T1 | S1, S3-S6 | inline | hecho | migración 0036: `premium_notices`, `preview_plan_quote`, `enqueue_premium_notices` |
| T2 | S1 | inline | hecho | API de planes/versiones/preview, `/planes` y tests |
| T3 | S2 | inline | hecho | API de suscripciones/pagos, `/pagos`, conciliación y tests |
| T4 | S2, S6 | inline | hecho | `admin-cancel-subscription`, `refund-payment`, audit_log |
| T5 | S3 | inline | hecho | `premiumProcessor` compartido + `reconcile-subscriptions` |
| T6 | S4 | inline | hecho | outbox, plantillas, `send-premium-notices` (Resend) |
| T7 | S1-S7 | inline | hecho | router/nav, README de funciones, manual, APLICAR, tests y checks |
| T8 | S1-S8 | delegated | hecho | verificación independiente: 3 blockers corregidos y recheck PASS |

## Log

- **L1 (2026-11-02):** «F5». Se implementa administración de planes/pagos, conciliación, avisos y reembolsos. Asunciones: Resend como proveedor de email y reembolso sin revocación automática de Premium. Sin credenciales Resend/MP para E2E.
- **L2 (2026-11-02):** Implementado: migración 0036; `/planes` (preview server-side, versiones, aviso de grandfathering); `/pagos` (suscripciones/pagos, cancelar, reembolsar, conciliar); Edge Functions admin con audit; procesador compartido con webhook + conciliación; outbox `premium_notices` y `send-premium-notices` con Resend; reembolsos/contracargos registrados sin revocación automática. Pendiente: verificación independiente y sandbox con credenciales.
- **L3 (2026-11-02, verificación independiente):** Blockers corregidos: `requireAdmin` exige `is_active`; la conciliación rota pagos con `last_reconciled_at` (sin starvation); `/pagos` muestra moneda/referencias y permite cargar más de 50. También se movió el enqueue de avisos antes del chequeo de Resend (503 deja outbox pendiente), `CRON_SECRET` usa comparación constante y se agregaron mappings de error.
- **L4 (2026-11-02):** Recheck del verificador: **PASS** (sin blockers). Se extendió la rotación a suscripciones (`subscriptions.last_reconciled_at`), se manejan errores del marcado de conciliación y se agregó test de paginación >50. Checks finales: 748 tests, typecheck, lint, check-scope, build y `deno check` verdes. Resend/MP/DB runtime siguen sin ejecutarse.
- **L5 (2026-11-02):** Commit `eea8fc1` (`feat(premium): add admin plans, payments, reconciliation and notices`). Migración 0036 y Edge Functions pendientes de aplicar/desplegar; los avisos requieren `RESEND_API_KEY`/`EMAIL_FROM`, y la conciliación sandbox requiere MP.
