# FAROX — F4: Mercado Pago Suscripciones

> **Objetivo:** cobrar Premium con renovación automática usando Mercado Pago Suscripciones (preapproval), activar/extender Premium por webhook firmado y permitir cancelar sin perder el período pagado.
> **Rama:** `daniel`. **Entrega:** commits de unidad; sin push.
> **Runner:** `npm run test`, `typecheck`, `lint`, `check-scope`, `build`.
> **Plan de referencia:** `odd/tasks/premium-suscripciones-mercado-pago.md` (F4).

## Specs

- **S1.** `create-subscription` es una Edge Function autenticada. Recibe `plan_code` (`premium_monthly`/`premium_annual`), lee el plan activo y su última `plan_versions` en el servidor y crea un preapproval en Mercado Pago con `reason`, `external_reference`, `payer_email`, `back_url` y `auto_recurring` (`frequency`, `frequency_type=months`, `transaction_amount`, `currency_id`). Nunca usa el monto del cliente. Devuelve `init_point`; si ya existe una suscripción `pending` con `provider_init_point`, la reutiliza; si hay una `authorized`/`paused`, rechaza con un mensaje claro.
- **S2.** `mp-webhook` es público pero valida `x-signature` con el manifiesto exacto `id:{data.id};request-id:{x-request-id};ts:{ts};` y HMAC-SHA256 con `MP_WEBHOOK_SECRET`. Guarda el evento en `payment_events` de forma idempotente, consulta el recurso real en Mercado Pago y procesa `subscription_preapproval`, `subscription_authorized_payment` y `payment`. Valida monto, moneda y `external_reference`; activa/extiende con `activate_premium` solo con pago aprobado; tolera duplicados y eventos fuera de orden; responde 200/201 y 401 con firma inválida.
- **S3.** `cancel-subscription` es una Edge Function autenticada. Cancela el preapproval en Mercado Pago, marca la suscripción local `cancelled` y `cancel_at_period_end=true`, y **no** toca `premium_until`: el acceso sigue hasta el final del período pagado. Es idempotente; si Mercado Pago falla, no marca cancelada.
- **S4.** Migración 0035 agrega `subscriptions.external_reference` (único) y `subscriptions.provider_init_point`. No cambia RLS ni permite escrituras del cliente; las Edge Functions usan `service_role`. `payments` sigue registrando cada cobro con `provider_payment_id` único.
- **S5.** `/premium` habilita «Suscribirme» para usuarios free: llama `create-subscription`, muestra error amigable y redirige al `init_point`. Si ya es Premium, muestra «Ya sos Premium» sin cobrar de nuevo. El desglose visible sigue saliendo de `quote_plan`.
- **S6.** `/premium/resultado` muestra «Premium activo hasta X» o «Pago pendiente», permite actualizar el estado y refresca los privilegios (`refreshPrivileges`). El perfil muestra el estado de la suscripción y «Cancelar suscripción» con confirmación; al cancelar, el acceso sigue hasta el final del período.
- **S7.** Tests: unitarios de firma/manifiesto/payload/mapeo de estados, tests de UI de checkout/resultado/cancelación, test de contenido de la migración 0035, typecheck, lint, check-scope y build. Sin secretos en el frontend.
- **S8.** Operación: secrets `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` y `APP_URL`; webhook desplegado sin JWT de Supabase (`--no-verify-jwt`) y URL registrada en Mercado Pago. La prueba sandbox real (tarjeta aprobada/rechazada, webhook duplicado, cancelación) queda pendiente hasta que el usuario provea credenciales y URL pública.
- **S9. Fuera de alcance (F5):** job de reconciliación, emails 7/3/1, panel admin de pagos/reembolsos, campañas de precio, confirmación de PSE recurrente.

## Tasks

| ID | Specs | Ruta | Estado | Evidencia |
|---|---|---|---|---|
| T1 | S4 | inline | hecho | `20261029000035_f4_mercado_pago.sql`: columnas, índice único de referencia e índice de una suscripción activa por usuario |
| T2 | S1-S3, S7 | inline | hecho | `_shared/mercadopago.ts` + 9 tests de firma/manifiesto/payload/estados |
| T3 | S1 | inline | hecho | `create-subscription`: plan/versión desde DB, fila local primero, init_point sandbox/producción, reutilización y stale cleanup |
| T4 | S2 | inline | hecho | `mp-webhook`: firma, idempotencia, consulta real, monto/moneda, activación/extensión y mapeo de estados |
| T5 | S3 | inline | hecho | `cancel-subscription`: auth, MP PUT, `cancel_at_period_end`, sin tocar `premium_until` |
| T6 | S5-S6 | inline | hecho | API, `/premium`, `/premium/resultado`, perfil con cancelación |
| T7 | S7-S8 | inline | hecho | README de funciones, manual, `APLICAR-EN-PRODUCCION.md`, tests y checks |
| T8 | S1-S8 | delegated | hecho | verificación independiente: blocker de período corregido con RPC SQL y recheck PASS |

## Log

- **L1 (2026-11-02):** «F4». Se implementa Mercado Pago Suscripciones: check-out, webhook firmado, activación/extensión y cancelación. Sin credenciales sandbox todavía; la prueba E2E real queda pendiente.
- **L2 (2026-11-02):** Implementado: migración 0035; `create-subscription` (monto/plan desde DB, fila local antes de MP, `sandbox_init_point` con token TEST, reutilización de pending, limpieza de pending viejo); `mp-webhook` (manifiesto `id:...;request-id:...;ts:...;`, HMAC-SHA256, `payment_events`, consulta real, validación de monto/moneda/referencia, dedupe por `provider_payment_id`, `activate_premium`); `cancel-subscription`; UI de checkout/resultado/cancelación. `npx -y deno check` pasa en las tres funciones.
- **L3 (2026-11-02):** Checks locales: 734 tests, typecheck, lint, check-scope y build verdes. El sandbox real sigue bloqueado por `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` y una URL pública; no se inventa un PASS de pago.
- **L4 (2026-11-02, verificación independiente):** Blocker corregido: `updatePeriod` reautorizaba una suscripción cancelada y podía retroceder `current_period_*` con webhooks tardíos. Se reemplazó por `merge_subscription_period` (row lock, fechas monotónicas, preserva `cancelled`/`expired`/`paused`) y se agregó `activate_premium_until` (`GREATEST`, idempotente por pago) para que una factura vieja no alargue Premium de más. Recheck del verificador: **PASS** (sin blockers; SQL revisado estáticamente, sin Postgres runtime).
- **L5 (2026-11-02):** Commit `a1a2056` (`feat(premium): add Mercado Pago subscription checkout and webhooks`). Checks: 737 tests, typecheck, lint, check-scope, build y `deno check` en verde. Migración 0035 y Edge Functions pendientes de aplicar/desplegar; el sandbox real sigue requiriendo `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` y una URL pública.
