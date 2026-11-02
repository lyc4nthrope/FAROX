# FAROX — Edge Functions de Mercado Pago (F4)

Estas funciones implementan el cobro recurrente de Premium. El frontend solo ve el
`init_point`; el access token y el secreto del webhook viven en los secrets de
Supabase y nunca se exponen con prefijo `VITE_`.

## Funciones

| Función | Autenticación | Qué hace |
|---|---|---|
| `create-subscription` | JWT de Supabase | Lee el plan y su última versión en la DB, crea el preapproval en Mercado Pago y devuelve `init_point`. Nunca confía en el monto del cliente. |
| `mp-webhook` | Firma `x-signature` | Valida el origen, guarda el evento, consulta el recurso real y activa/extiende Premium con `activate_premium`. Tolera duplicados. |
| `cancel-subscription` | JWT de Supabase | Cancela el preapproval en Mercado Pago y marca `cancel_at_period_end`; no borra el período ya pagado. |

## Secrets

```bash
supabase secrets set \
  MP_ACCESS_TOKEN="APP_USR-..." \
  MP_WEBHOOK_SECRET="..." \
  APP_URL="https://tu-dominio"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta
Supabase en el runtime. No los pongas en `.env` del frontend ni en el repositorio.

- `MP_ACCESS_TOKEN`: credencial de producción o de prueba de Mercado Pago.
- `MP_WEBHOOK_SECRET`: secreto que muestra Mercado Pago en **Webhooks → Configurar notificación**.
- `APP_URL`: origen público de FAROX; se usa para el `back_url` del checkout.

## Deploy

```bash
supabase functions deploy create-subscription
supabase functions deploy cancel-subscription
supabase functions deploy mp-webhook --no-verify-jwt
```

`mp-webhook` debe desplegarse con `--no-verify-jwt`: Mercado Pago no envía un JWT
de Supabase; la autenticidad se valida con la firma HMAC. Las otras dos funciones
conservan la verificación JWT y además llaman `auth.getUser()`.

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

## Seguridad

- No se guardan datos de tarjeta; el checkout es hospedado por Mercado Pago.
- El webhook valida firma, monto, moneda y `external_reference` antes de activar.
- `payment_events` es idempotente por `(provider, event_id)`.
- `payments.provider_payment_id` es único; un webhook repetido no duplica meses.
- Las escrituras usan `service_role` solo dentro de las funciones; el cliente
  autenticado sigue sin poder escribir `premium`, `subscriptions` ni `payments`.
