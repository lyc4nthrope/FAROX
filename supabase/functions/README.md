# FAROX — Edge Functions de Mercado Pago (F4)

Estas funciones implementan el cobro recurrente de Premium. El frontend solo ve el
`init_point`; el access token y el secreto del webhook viven en los secrets de
Supabase y nunca se exponen con prefijo `VITE_`.

## Funciones

| Función                     | Autenticación         | Qué hace                                                                                                                                     |
| --------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-subscription`       | JWT de Supabase       | Lee el plan y su última versión en la DB, crea el preapproval en Mercado Pago y devuelve `init_point`. Nunca confía en el monto del cliente. |
| `mp-webhook`                | Firma `x-signature`   | Valida el origen, guarda el evento, consulta el recurso real y activa/extiende Premium con `activate_premium`. Tolera duplicados.            |
| `cancel-subscription`       | JWT de Supabase       | Cancela el preapproval en Mercado Pago y marca `cancel_at_period_end`; no borra el período ya pagado.                                        |
| `admin-cancel-subscription` | Admin                 | Cancela la suscripción de otro usuario y audita la acción.                                                                                   |
| `refund-payment`            | Admin                 | Reembolsa un pago aprobado en Mercado Pago, marca `refunded` y audita. No revoca Premium automáticamente.                                    |
| `reconcile-subscriptions`   | Admin o `CRON_SECRET` | Consulta suscripciones/pagos pendientes en Mercado Pago y corrige estados con el mismo procesador del webhook.                               |
| `send-premium-notices`      | Admin o `CRON_SECRET` | Encola y envía avisos de renovación/gracia/vencimiento/pago rechazado/cancelación con Resend.                                                |

## Secrets

```bash
supabase secrets set \
  MP_ACCESS_TOKEN="APP_USR-..." \
  MP_WEBHOOK_SECRET="..." \
  APP_URL="https://tu-dominio" \
  CRON_SECRET="un-secreto-largo-aleatorio" \
  RESEND_API_KEY="re_..." \
  EMAIL_FROM="FAROX <no-reply@tu-dominio>" \
  PREMIUM_CHECKOUT_ENABLED="false" \
  PREMIUM_CHECKOUT_ALLOWLIST="interno1@...,interno2@..."
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta
Supabase en el runtime. No los pongas en `.env` del frontend ni en el repositorio.

- `MP_ACCESS_TOKEN`: credencial de producción o de prueba de Mercado Pago.
- `MP_WEBHOOK_SECRET`: secreto que muestra Mercado Pago en **Webhooks → Configurar notificación**.
- `APP_URL`: origen público de FAROX; se usa para el `back_url` del checkout.
- `PREMIUM_CHECKOUT_ENABLED`: debe ser `true` para aceptar nuevos checkouts. Si falta o es `false`, `create-subscription` devuelve 503 y `/premium` muestra el pago como no disponible.
- `PREMIUM_CHECKOUT_ALLOWLIST`: emails separados por coma para un canary. Si está vacío, el checkout queda abierto a todos una vez habilitado.

## Deploy

```bash
supabase functions deploy create-subscription
supabase functions deploy cancel-subscription
supabase functions deploy admin-cancel-subscription
supabase functions deploy refund-payment
supabase functions deploy mp-webhook --no-verify-jwt
supabase functions deploy reconcile-subscriptions --no-verify-jwt
supabase functions deploy send-premium-notices --no-verify-jwt
```

`mp-webhook` debe desplegarse con `--no-verify-jwt`: Mercado Pago no envía un JWT
de Supabase; la autenticidad se valida con la firma HMAC. `reconcile-subscriptions`
y `send-premium-notices` también se despliegan así para que el cron use
`x-cron-secret`; cuando las invoca un humano, la función valida el JWT y el rol
admin con `auth.getUser()`. Las demás funciones conservan la verificación JWT.

En **Mercado Pago → Tu integración → Webhooks → Configurar notificación**:

- URL de producción: `https://<project-ref>.supabase.co/functions/v1/mp-webhook`
- Eventos: `payment`, `subscription_preapproval`, `subscription_authorized_payment`
- Guardá el secreto generado y cargalo como `MP_WEBHOOK_SECRET`.

## Flujo

1. `/premium` llama `create-subscription` con `plan_code`.
2. La función crea `subscriptions` (pending) con `external_reference` único y
   `provider_init_point`, y devuelve el `init_point`.
3. El usuario autoriza el cobro en Mercado Pago y vuelve a
   `/premium/resultado?ref=...`.
4. `mp-webhook` valida `x-signature` con el manifiesto
   `id:{data.id};request-id:{x-request-id};ts:{ts};`, consulta el recurso real y,
   si el pago está aprobado, llama `activate_premium` en una transacción.
5. La renovación se registra como otro `payments` con `provider_payment_id`
   único; `activate_premium` extiende desde `max(now, premium_until)`.
6. `cancel-subscription` cancela el preapproval y deja `premium_until` intacto.

## Pruebas

Los helpers puros viven en `_shared/mercadopago.ts` y se prueban con Vitest:

```bash
npm run test -- supabase/functions/_shared/mercadopago.test.ts
```

La prueba sandbox real (tarjeta aprobada/rechazada, webhook duplicado,
cancelación) requiere credenciales de Mercado Pago y una URL pública. Sin esos
datos la integración queda verificada solo a nivel unitario/estático.

## Lanzamiento gradual (F6)

- `PREMIUM_CHECKOUT_ENABLED=false` por defecto: `create-subscription` devuelve 503 y no se puede iniciar un cobro nuevo.
- `PREMIUM_CHECKOUT_ALLOWLIST="interno1@...,interno2@..."` limita el checkout a un canary. Vacío = todos, una vez habilitado.
- `VITE_PREMIUM_CHECKOUT_ENABLED=false` en el build de producción oculta/habilita el botón de checkout. En dev/test queda habilitado por defecto.
- El runbook completo (deploy, canary, rollback, incidentes, PQR y monitoreo) está en `docs/runbooks/premium-lanzamiento.md`.

## Conciliación y avisos programados

`reconcile-subscriptions` y `send-premium-notices` se despliegan con
`--no-verify-jwt` para que un cron pueda invocarlas con el header
`x-cron-secret: <CRON_SECRET>`. Un admin autenticado también puede invocarlas
desde `/pagos` (conciliación) o manualmente; la función valida el rol.

Programá ambas una vez al día desde Supabase Cron / `pg_cron` + `pg_net`:

- `reconcile-subscriptions`: después del cierre del día.
- `send-premium-notices`: por la mañana, antes de los vencimientos.

`send-premium-notices` usa Resend (`https://api.resend.com/emails`). El dominio
de `EMAIL_FROM` debe estar verificado en Resend. Si faltan `RESEND_API_KEY`,
`EMAIL_FROM` o `APP_URL`, la función devuelve 503 y no marca avisos como
enviados; el outbox queda pendiente. Los avisos son idempotentes por
`(user_id, kind, period_key)`.

## Seguridad

- No se guardan datos de tarjeta; el checkout es hospedado por Mercado Pago.
- El webhook valida firma, monto, moneda y `external_reference` antes de activar.
- `payment_events` es idempotente por `(provider, event_id)`.
- `payments.provider_payment_id` es único; un webhook repetido no duplica meses.
- Las escrituras usan `service_role` solo dentro de las funciones; el cliente
  autenticado sigue sin poder escribir `premium`, `subscriptions` ni `payments`.
