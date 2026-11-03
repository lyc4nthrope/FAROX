# FAROX — Runbook de lanzamiento de Premium

> **Estado:** preparado para canary. La revisión legal, la facturación electrónica DIAN y el canal PQR con radicado requieren validación humana antes de abrir a todos.
> **Última actualización:** 2026-11-02.

## 1. Precondiciones (no abrir checkout sin esto)

- [ ] Migraciones **0032–0036** aplicadas en producción con `supabase/APLICAR-EN-PRODUCCION.md`.
- [ ] `plans` y `plan_versions` tienen el precio/IVA/comisión definitivos y `fee_passed_to_customer = false`.
- [ ] Edge Functions desplegadas: `create-subscription`, `cancel-subscription`, `mp-webhook`, `admin-cancel-subscription`, `refund-payment`, `reconcile-subscriptions`, `send-premium-notices`.
- [ ] Secrets cargados: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `APP_URL`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `PREMIUM_CHECKOUT_ENABLED=false` (inicialmente), `PREMIUM_CHECKOUT_ALLOWLIST` con cuentas internas.
- [ ] Webhook de Mercado Pago apuntando a `https://<project-ref>.supabase.co/functions/v1/mp-webhook`, eventos `payment`, `subscription_preapproval`, `subscription_authorized_payment`.
- [ ] Dominio de `EMAIL_FROM` verificado en Resend.
- [ ] **Revisión legal** de términos Premium, privacidad (Mercado Pago/Resend), cancelación, reembolsos y PQR.
- [ ] **DIAN/IVA** confirmado con contador; el IVA mostrado es informativo, no reemplaza factura electrónica.
- [ ] Canal PQR publicado con radicado, responsable y tiempos de respuesta.
- [ ] Responsable de soporte y ventana de monitoreo definidos.

## 2. Deploy

```bash
# 1. Migraciones en orden, una por transacción (SQL editor o CLI).
# 2. Funciones:
supabase functions deploy create-subscription
supabase functions deploy cancel-subscription
supabase functions deploy admin-cancel-subscription
supabase functions deploy refund-payment
supabase functions deploy mp-webhook --no-verify-jwt
supabase functions deploy reconcile-subscriptions --no-verify-jwt
supabase functions deploy send-premium-notices --no-verify-jwt

# 3. Secrets (sin commitear):
supabase secrets set \
  MP_ACCESS_TOKEN="..." MP_WEBHOOK_SECRET="..." APP_URL="https://..." \
  CRON_SECRET="..." RESEND_API_KEY="..." EMAIL_FROM="FAROX <no-reply@...>" \
  PREMIUM_CHECKOUT_ENABLED="false" PREMIUM_CHECKOUT_ALLOWLIST="interno1@...,interno2@..."

# 4. Frontend: VITE_PREMIUM_CHECKOUT_ENABLED=false y rebuild/deploy.
```

Programar `reconcile-subscriptions` y `send-premium-notices` una vez al día con
`x-cron-secret: <CRON_SECRET>`. Ejecutar la conciliación después del cierre y los
avisos por la mañana.

## 3. Canary

1. Dejar `PREMIUM_CHECKOUT_ENABLED=false` y `VITE_PREMIUM_CHECKOUT_ENABLED=false`; confirmar que `/premium` muestra «Pago disponible próximamente» y que el admin puede activar Premium manualmente.
2. Cargar 1–3 emails internos en `PREMIUM_CHECKOUT_ALLOWLIST`.
3. Poner `PREMIUM_CHECKOUT_ENABLED=true` y `VITE_PREMIUM_CHECKOUT_ENABLED=true`; rebuild/deploy del frontend.
4. Probar con una cuenta interna:
   - plan mensual y anual;
   - pago aprobado y rechazado en sandbox;
   - webhook duplicado (repetir notificación) no duplica meses;
   - cancelación: `premium_until` no cambia;
   - reembolso: `payments.status=refunded`, Premium no se revoca solo;
   - aviso de prueba con Resend;
   - `/pagos` muestra salud y referencias.
5. Monitorear 24–48 h: `/pagos` → «Salud de pagos», logs de funciones, `payment_events`, errores de Resend.
6. Si todo está limpio, vaciar `PREMIUM_CHECKOUT_ALLOWLIST` y mantener el flag en `true`.

## 4. Monitoreo

Panel `/pagos` → «Salud de pagos»:

| Señal | Qué significa | Acción |
|---|---|---|
| Pagos pendientes > 1 h | Webhook perdido o MP demorado | Ejecutar «Conciliar»; revisar `payment_events` |
| Suscripciones pendientes > 1 h | Checkout abandonado o preapproval atascado | Revisar `subscriptions`/MP; cancelar si corresponde |
| Avisos fallidos | Resend rechazó o faltó config | Revisar `premium_notices.error`; corregir la causa y devolver el aviso a `pending` (SQL de abajo) |
| Usuarios en gracia | Premium vencido, aún con acceso | Confirmar aviso de gracia y downgrade |
| Eventos webhook 24 h | Volumen de notificaciones | Si cae a 0 con pagos, revisar webhook/secreto |

Consultas útiles (SQL editor, admin):

```sql
-- Pagos pendientes viejos
select id, user_id, amount_cents, provider_payment_id, created_at
from public.payments
where status = 'pending' and created_at < now() - interval '1 hour'
order by created_at;

-- Eventos sin procesar
select provider, event_id, topic, received_at, processed_at
from public.payment_events
where processed_at is null
order by received_at desc
limit 50;

-- Avisos fallidos
select id, user_id, kind, period_key, error, created_at
from public.premium_notices
where status = 'failed'
order by created_at desc;

-- Reintentar avisos fallidos después de corregir la causa
update public.premium_notices
set status = 'pending', error = null
where status = 'failed'
  and created_at > now() - interval '7 days';

-- Suscripciones activas y períodos
select s.id, s.user_id, s.status, s.current_period_end, s.cancel_at_period_end
from public.subscriptions s
where s.status in ('authorized', 'paused')
order by s.current_period_end;
```

## 5. Incidentes

### «Pagué y no se activó»

1. Buscar el pago en `/pagos` o `payments` por email/importe/fecha.
2. Ver `payment_events` y el estado real en Mercado Pago (`/v1/payments/{id}`).
3. Ejecutar «Conciliar con Mercado Pago».
4. Si el pago está aprobado y sigue sin activar, activar Premium manual en `/users/:id` con una nota interna y abrir incidencia técnica.
5. No pedir al usuario que pague de nuevo.

### «Cancelé y me cobraron»

1. Verificar `cancel-subscription`/`admin-cancel-subscription` y la fecha de cancelación en Mercado Pago.
2. Si el cobro es posterior a la cancelación, reembolsar desde `/pagos` y escalar a Mercado Pago.
3. Si el cobro es del período ya autorizado, explicar que el acceso sigue hasta el final del período.

### PSE pendiente

1. No activar Premium hasta que el pago esté `approved`.
2. Revisar el estado en Mercado Pago y conciliar.
3. Si PSE no permite recurrencia, ofrecer tarjeta/cuenta MP o activación manual con revisión.

### Contracargo

1. Registrar el estado `charged_back` en `payments` (webhook/conciliación).
2. No revocar Premium automáticamente; decidir con soporte/legal.
3. Adjuntar evidencia y responder dentro del plazo de Mercado Pago.

## 6. Rollback

1. `PREMIUM_CHECKOUT_ENABLED=false` (Edge) y `VITE_PREMIUM_CHECKOUT_ENABLED=false` + rebuild del frontend.
2. No retirar ni deshabilitar `mp-webhook` ni `reconcile-subscriptions`: deben seguir desplegados y activos para pagos ya autorizados.
3. Las suscripciones existentes siguen su curso; el admin puede cancelar/reembolsar desde `/pagos`.
4. No borrar tablas ni datos. Si una migración debe revertirse, usar los bloques `INVERSE` en una transacción y con respaldo.

## 7. PQR (borrador operativo)

- Canal: `<email/formulario>` (completar).
- Radicado: `<formato>` (completar).
- Responsable: `<nombre>`.
- Tiempo de acuse: `<horas>`; respuesta: `<días hábiles>`.
- Guardar copia en `<sistema>` y no incluir datos de tarjeta.

## 8. Criterio de lanzamiento

- [ ] Canary 24–48 h sin incidentes críticos.
- [ ] Salud de pagos sin pendientes viejos ni avisos fallidos.
- [ ] Legal/DIAN/PQR aprobados por los responsables.
- [ ] Rollback probado en staging.
- [ ] Se vacía la allowlist y se comunica el lanzamiento.
