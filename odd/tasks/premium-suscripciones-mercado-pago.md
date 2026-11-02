# FAROX — Premium por suscripción con Mercado Pago

> **Estado:** planificación. No implementado.
> **Objetivo:** pasar de Premium manual (admin) a una suscripción automática con Mercado Pago, con degradación ordenada de tiendas y cumplimiento colombiano.
> **Decisiones de partida:** Mercado Pago Suscripciones; precio base 10.000 COP/mes; plan anual con descuento; precio editable por admin con histórico; desglose visible de IVA y comisión MP; al vencer, el usuario elige una tienda en un modal o renueva; los datos nunca se borran.
> **Pendiente de validar:** qué medios de Mercado Pago admiten cobro recurrente (PSE/Efecty suelen ser one-time; la recurrencia automática se apoya en tarjeta/cuenta MP), comisión exacta de Suscripciones, IVA/facturación y revisión legal.

---

## 1. Estado actual del código (lo que ya existe)

- `users.premium` es la fuente de verdad; `is_premium()` = `premium OR admin`.
- `set_user_premium` es solo admin; el cliente nunca activa Premium.
- Límite de tiendas: 1 activa para gratuito, 3 para Premium; admin exento (`enforce_store_cap`).
- Funciones Premium actuales: dashboard, movimientos manuales, precios de compra/venta, venta directa del distribuidor, hasta 3 tiendas y el preview de «QR masivo».
- No existen tablas de pagos, suscripciones, planes ni Edge Functions.
- `stores.is_active` ya funciona como soft-delete; el trigger de tope también valida la reactivación.
- `my_store_ids()` hoy NO filtra por `stores.is_active`; para pausar tiendas por plan hay que corregirlo.

---

## 2. Decisiones de producto

### 2.1 Planes propuestos

| Plan | Precio | Equivalente | Nota |
|---|---:|---:|---|
| Mensual | 10.000 COP | 10.000/mes | Precio de entrada; la comisión fija pesa. |
| Anual | 100.000 COP | 8.333/mes | 2 meses gratis; reduce comisión y churn. |
| Trial | 0 COP, 7 días | — | Opcional; no en la v1 para evitar abuso. |

El precio final debe incluir impuestos y costos (Art. 26 Ley 1480). Si 10.000 es el precio “de vitrina”, calcular el neto después de comisión de Mercado Pago (referencia pública: ~2,99%–3,29% + $800 + IVA para pagos online; **confirmar la tarifa de Suscripciones en el panel**). A 10.000, la comisión puede representar ~10–15%; el anual la diluye. Ejemplo orientativo: si querés recibir ~10.000 netos por mes, el precio de vitrina debería rondar 11.500–12.000, según la tarifa final.

**Precio editable:** el precio no queda hardcodeado. `plans` guarda el precio vigente y sus parámetros (IVA, comisión, fijo); un admin puede cambiarlo desde un panel sin deploy. Cada cambio crea una versión en `plan_versions` y queda auditado. Las suscripciones existentes conservan el precio con el que se crearon (ver 2.5).

### 2.2 Desglose de precio y precios editables

La página `/premium` y el checkout muestran un desglose **informativo** (no suman cargos sorpresa):

| Concepto | Ejemplo con precio final 10.000 |
|---|---:|
| Precio final que paga el usuario | 10.000 |
| IVA incluido (19%) | 1.597 |
| Comisión estimada de Mercado Pago | 1.343 |
| Neto estimado para FAROX | 7.060 |

- La comisión de Mercado Pago se **descuenta del recaudo**; no se suma al precio. Si el negocio decide trasladarla al cliente, se configura `fee_passed_to_customer=true` y el precio final sube; por defecto se absorbe para mantener los 10.000.
- Los porcentajes/fijos son configurables: `tax_rate_bps`, `mp_fee_bps`, `mp_fee_fixed_cents`, `mp_fee_tax_bps`. El cálculo se hace en servidor (`quote_plan`) para que la UI y el checkout usen el mismo número.
- El desglose muestra “estimado”: la comisión real puede variar por medio de pago, plazo de acreditación o cambios de Mercado Pago; el recibo final manda.
- El precio puede cambiar por demanda/oferta; el admin edita el plan y ve el histórico. Las suscripciones ya creadas mantienen su precio (grandfathering) salvo una campaña de cambio con aviso y derecho a cancelar, revisada por legal.

### 2.3 Matriz Free vs Premium (solo lo implementado)

| Función | Gratis | Premium |
|---|:---:|:---:|
| 1 tienda activa | ✅ | ✅ |
| Hasta 3 tiendas activas | ❌ | ✅ |
| Inventario, pedidos, entregas, rutas, fiado | ✅ | ✅ |
| Alertas de stock/caducidad | ✅ | ✅ |
| Dashboard | ❌ | ✅ |
| Movimientos manuales con precio | ❌ | ✅ |
| Precios de compra/venta y venta directa | ❌ | ✅ |
| QR masivo | ❌ | ⚠️ implementar o no prometer |
| Soporte prioritario | — | opcional, no inventar |

No vender «QR masivo» hasta que exista la pantalla real.

### 2.4 Qué pasa cuando vence Premium (decisión central)

Hoy un usuario Premium puede tener 3 tiendas activas. Si pierde Premium, no debe perder datos ni acceso de golpe. Flujo propuesto:

1. **Aviso previo:** 7, 3 y 1 día antes del vencimiento, banner + email: «Tu Premium vence el X. Renová o elegí qué tienda queda activa».
2. **Gracia de 7 días:** al vencer, las 3 tiendas siguen activas pero el usuario ve un banner persistente y las funciones Premium quedan bloqueadas. Puede elegir o renovar.
3. **Elección en ventana emergente:** al entrar (o al vencer la gracia) se abre un modal con las tiendas activas del usuario. Cada una tiene un radio «Conservar como principal»; el CTA primario es «Conservar esta tienda» y el secundario «Renovar Premium para mantener las 3 activas». Las otras pasan a `is_active=false` con `deactivated_reason='premium_expired'`; **no se borra nada** (stock, pedidos, rutas, créditos, historial). La tienda conservada se marca «Principal» mientras el plan sea gratuito.
4. **Si no elige:** durante la gracia el modal se puede cerrar con «Decidir después»; al terminar la gracia el modal es bloqueante. Si aun así no elige, un job diario conserva la tienda más antigua (o la de mayor actividad, a definir) y pausa las demás. Se notifica.
5. **Renovación:** al volver a Premium, el usuario puede reactivar las tiendas pausadas hasta el tope de 3 desde `/premium/tiendas` o un modal. Si renueva desde el modal de downgrade, no se pausa nada.
6. **Acceso:** `my_store_ids()` debe filtrar `stores.is_active`; una tienda pausada no es operable por el usuario, pero su data sigue para el admin y para cuando se reactive.
7. **Tienda pausada ≠ tienda eliminada:** la UI muestra «Pausada por plan» y un botón «Reactivar» (solo Premium). El admin conserva la reactivación manual.

**Contenido del modal de downgrade**

- Título: «Tu Premium venció».
- Texto: «Elegí una tienda para conservar como principal, o renová para mantener las 3 activas. Las demás se pausan, no se borran».
- Lista de tiendas activas (2 o 3) con nombre, ciudad y un radio; preselección: la más antigua.
- Botón primario: «Conservar esta tienda».
- Botón secundario: «Renovar Premium».
- Enlace terciario: «Ver qué incluye Premium».
- Durante la gracia: «Decidir después»; después de la gracia: sin cierre, foco atrapado, ESC deshabilitado.
- Al confirmar: se pausan las demás, se muestra «Principal» en la conservada y un aviso con opción «Reactivar mis tiendas» si renueva.
- Si el usuario tiene 1 tienda activa, el modal no aparece. Si tiene 2, muestra las 2.

**Máquina de estados resumida:**

```text
free ──pago──▶ premium_active ──vence──▶ grace (7d) ──no elige──▶ free (1 tienda)
                    │                         │
                    │                         └──elige──▶ free (1 tienda, resto pausado)
                    ├──cancela──▶ cancel_at_period_end ──vence──▶ grace
                    └──renueva──▶ premium_active (extiende)
```

**Usuarios Premium existentes:** no se cobran automáticamente. `premium=true` con `premium_until=NULL` sigue siendo un grant manual/indefinido. El admin puede migrarlos a un plan pago cuando corresponda; no hay grandfathering sorpresivo ni cobro retroactivo.

**Supuestos a confirmar:** gracia de 7 días; tienda conservada por defecto = la más antigua; no se borra nada; el usuario puede elegir antes de que venza.

### 2.5 Cancelación y reembolsos

- Cancelar en cualquier momento, sin penalidad; el acceso Premium sigue hasta el final del período pagado.
- No hay permanencia mínima. Si algún día se ofrece un plan con permanencia, debe existir una alternativa sin permanencia y cumplir el Art. 41 de la Ley 1480 (máx. 1 año, solo subsidio proporcional).
- Reembolsos: definir política simple y legal; Ley 2439/2024 exige devolución en 15 días calendario cuando aplica. No prometer «sin reembolsos» sin revisión legal.
- Cancelación desde el perfil y desde Mercado Pago; ambas deben detener el cobro.

---

## 3. Marco legal Colombia (resumen operativo, no asesoría)

### 3.1 Ley 1480 de 2011 (Estatuto del Consumidor)

- **Art. 26:** precio en COP, visual, con todos los impuestos y costos adicionales. El consumidor solo paga el precio anunciado.
- **Art. 27:** derecho a constancia/factura de cada operación.
- **Art. 35:** prohibido establecer o renovar un ofrecimiento que genere costo si el consumidor no lo aceptó expresamente. El checkout debe tener aceptación clara, sin casillas premarcadas.
- **Art. 41:** permanencia mínima solo con ventaja sustancial, por una vez, máximo 1 año, ofreciendo una alternativa sin permanencia; terminación anticipada solo paga el subsidio proporcional.
- **Art. 43.14:** son abusivas las cláusulas de renovación automática que impidan terminar el contrato en cualquier momento o impongan sanciones por terminación anticipada (salvo Art. 41). **La suscripción debe poder cancelarse en cualquier momento sin penalidad.**
- **Art. 47 (modificado por Ley 2439/2024):** retracto en ventas a distancia y devolución; revisar aplicabilidad a servicios digitales y definir el flujo.

### 3.2 Ley 2439 de 2024 (comercio electrónico)

- Información clara, veraz, suficiente y oportuna.
- Canales de atención de fácil acceso y trazabilidad de PQR con radicado (fecha/hora) y seguimiento.
- Devolución del dinero en máximo 15 días calendario cuando aplica.
- Plazo de entrega informado; si no, 30 días calendario.
- Responsabilidades de portales de contacto; FAROX debe tener términos, privacidad y canal de soporte visibles.

### 3.3 Protección de datos

- Ley 1581 de 2012 y Decreto 1377 de 2013: autorización, finalidad, retención, derechos del titular, política de privacidad.
- El pago comparte datos con Mercado Pago; declararlo y enlazar su política.
- Definir responsable/encargado y transferencias internacionales si aplican.

### 3.4 Mercado Pago: términos y condiciones a revisar

- Cuenta de vendedor, KYC, actividades permitidas/restringidas, reservas, contracargos, reembolsos, cancelaciones, impuestos y datos.
- Suscripciones: preapproval, autorización del pagador, reintentos automáticos, cancelación, `back_url`, `external_reference`, estados.
- **Medios recurrentes:** la página de Suscripciones de Mercado Pago Colombia lista PSE/Efecty, pero la recurrencia automática suele apoyarse en tarjeta o cuenta MP. Confirmar por escrito con soporte qué medios permiten cobros sucesivos; si PSE es solo primer pago, ofrecer «renovación manual» o exigir tarjeta para auto-renovación.
- **Webhooks:** validar `x-signature` (`ts`, `v1`) y `x-request-id`; no confiar solo en el redirect; consultar el pago/suscripción real por API.
- **Comisiones:** confirmar tarifa de Suscripciones (no asumir la de Checkout Pro); sumar IVA y retenciones.
- **Facturación:** Mercado Pago no reemplaza necesariamente la factura electrónica DIAN; definir con contador.

### 3.5 Checklist legal antes de lanzar

- [ ] Términos y condiciones de Premium (precio, frecuencia, renovación, cancelación, reembolso, soporte).
- [ ] Política de privacidad actualizada (pagos, Mercado Pago, retención).
- [ ] Checkbox de aceptación explícita + registro de versión/fecha/IP.
- [ ] Email de confirmación con términos, recibo, próximo cobro y link de cancelación.
- [ ] Canal PQR con radicado y tiempos de respuesta.
- [ ] Política de reembolso y procedimiento.
- [ ] Revisión de IVA/facturación electrónica.
- [ ] Revisión por abogado colombiano; esto es un resumen operativo, no asesoría.

---

## 4. Arquitectura

### 4.1 Modelo de datos (migraciones 0032+)

```sql
-- 0032: estado premium y planes
ALTER TABLE public.users
  ADD COLUMN premium_until timestamptz NULL,
  ADD COLUMN premium_grace_until timestamptz NULL;

CREATE TABLE public.plans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text UNIQUE NOT NULL,              -- 'premium_monthly', 'premium_annual'
  name text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),  -- precio final
  currency char(3) NOT NULL DEFAULT 'COP',
  interval_months integer NOT NULL CHECK (interval_months BETWEEN 1 AND 12),
  trial_days integer NOT NULL DEFAULT 0,
  tax_rate_bps integer NOT NULL DEFAULT 1900,       -- 19% en basis points
  tax_included boolean NOT NULL DEFAULT true,       -- el precio final ya incluye IVA
  mp_fee_bps integer NOT NULL DEFAULT 329,          -- comisión estimada MP
  mp_fee_fixed_cents integer NOT NULL DEFAULT 80000, -- 800 COP en centavos
  mp_fee_tax_bps integer NOT NULL DEFAULT 1900,     -- IVA sobre la comisión
  fee_passed_to_customer boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  features jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.plan_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id bigint NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  version integer NOT NULL,
  amount_cents integer NOT NULL,
  currency char(3) NOT NULL,
  tax_rate_bps integer NOT NULL,
  tax_included boolean NOT NULL,
  mp_fee_bps integer NOT NULL,
  mp_fee_fixed_cents integer NOT NULL,
  mp_fee_tax_bps integer NOT NULL,
  fee_passed_to_customer boolean NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version)
);

CREATE TABLE public.subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  plan_id bigint NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  plan_version_id bigint NOT NULL REFERENCES public.plan_versions(id) ON DELETE RESTRICT,
  price_cents_at_signup integer NOT NULL,  -- grandfathering
  currency char(3) NOT NULL DEFAULT 'COP',
  provider text NOT NULL DEFAULT 'mercadopago',
  provider_subscription_id text UNIQUE,
  status text NOT NULL,                    -- pending, authorized, paused, cancelled, expired
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  subscription_id bigint NULL REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  plan_id bigint NULL REFERENCES public.plans(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'mercadopago',
  provider_payment_id text UNIQUE,
  provider_reference text UNIQUE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL DEFAULT 'COP',
  status text NOT NULL,                    -- pending, approved, rejected, refunded, charged_back
  raw_event jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL,
  event_id text NOT NULL,
  topic text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, event_id)
);
```

- `users.premium` sigue siendo el grant manual/indefinido.
- `premium_until` es la vigencia pagada.
- `premium_grace_until` se setea al vencer/revocar para la ventana de elección (propuesta: +7 días).
- `is_premium()`:

```sql
SELECT EXISTS (
  SELECT 1
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id
  WHERE u.id = auth.uid()
    AND u.is_active
    AND (r.name = 'admin'
         OR (u.premium AND (u.premium_until IS NULL OR u.premium_until > now())))
);
```

- `set_user_premium(true)` = grant manual indefinido (`premium_until=NULL`, limpia `premium_grace_until`).
- `set_user_premium(false)` = revoca el grant manual; si hay una suscripción paga, no se usa para cortar el período: se cancela la suscripción y se deja vencer. Para un grant manual, setea `premium=false` y `premium_grace_until=now()+7 días` para que el usuario elija tienda o renueve.
- `activate_premium` setea `premium=true`, extiende `premium_until` y limpia `premium_grace_until`.
- RPC `activate_premium(p_user uuid, p_months integer, p_payment_id bigint)`:
  - Solo service_role/owner.
  - Idempotente por `p_payment_id`.
  - Extiende `premium_until = GREATEST(COALESCE(premium_until, now()), now()) + (p_months || ' months')::interval`.
  - Marca el pago aprobado y audita.
- RPC `my_premium_status()` para la UI: `premium`, `premium_until`, `premium_grace_until`, `needs_store_choice`, `active_owned_stores`.
- `my_store_ids()` se corrige para filtrar `stores.is_active`.
- `quote_plan(p_code text)` (SECURITY DEFINER, grant anon/authenticated) devuelve `final_cents`, `base_cents`, `tax_cents`, `mp_fee_cents`, `net_cents`, `currency`, `interval_months`, `tax_included`, `fee_passed_to_customer`. La UI y el checkout usan el mismo cálculo; el cliente nunca calcula el monto a cobrar.
- `update_plan_pricing(p_code, p_amount_cents, ...)` (solo admin): valida, inserta `plan_versions`, incrementa `plans.version`, actualiza el precio vigente y audita. No hay precios hardcodeados.
- `create-subscription` lee la versión vigente, guarda `plan_version_id` y `price_cents_at_signup`; el preapproval de MP usa ese monto. Las suscripciones existentes conservan su versión/precio (grandfathering).
- Si se quiere cambiar el precio a suscriptores existentes, se hace una campaña aparte: actualizar el preapproval en MP, avisar con antelación y permitir cancelar; no se hace silenciosamente.
- RLS: `plans` y `plan_versions` lectura pública solo de planes activos (o autenticada), escritura admin; `subscriptions`/`payments` solo dueño/admin; `payment_events` solo service_role/admin.
- Panel admin «Planes y precios»: editar precio, IVA, comisión/fijo, `fee_passed_to_customer`, activo; previsualizar el desglose y ver el histórico. Al guardar, se crea una versión nueva.

### 4.2 Edge Functions

```text
supabase/functions/
  create-subscription/   POST autenticado: plan_code -> crea preapproval MP -> init_point
  mp-webhook/            POST público: valida x-signature, guarda evento, consulta API, activa/extiende
  cancel-subscription/   POST autenticado: cancela en MP, marca cancel_at_period_end
  reconcile-subscriptions/ cron: consulta pendientes/vencidos y corrige estados
```

- `SUPABASE_SERVICE_ROLE_KEY`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` solo en secrets de Edge Functions.
- El frontend nunca ve el access token ni escribe `premium`.
- `create-subscription`:
  - Autentica el JWT; obtiene `user.id` y email.
  - Lee `plans` por `code` (nunca confía en el monto del cliente).
  - Crea `subscriptions`/`payments` pending con `external_reference` único.
  - Crea preapproval en MP (`auto_recurring`: frequency 1 month, amount, currency COP, start_date, back_url; `payer_email`; `external_reference`).
  - Devuelve `init_point`.
- `mp-webhook`:
  - Valida firma; guarda `payment_events` (idempotente).
  - Consulta el recurso real en MP (`/preapproval`, `/authorized_payments`, `/v1/payments`).
  - Mapea estados: `authorized`/`approved` → activar; `paused`/`cancelled` → no renovar; `rejected` → avisar.
  - Llama `activate_premium` en una transacción; responde 200 rápido.
- Reintentos: Mercado Pago reintenta; el webhook debe tolerar duplicados y eventos fuera de orden.

### 4.3 Flujo de pago (usuario)

1. `/premium` → elige plan → «Suscribirme».
2. `create-subscription` → `init_point`.
3. Mercado Pago: autoriza tarjeta/cuenta (o PSE si aplica).
4. `back_url` → `/premium/resultado?ref=...`.
5. El resultado consulta `my_premium_status`/`payments` propio; muestra «Premium hasta X» o «Pago pendiente».
6. Webhook confirma y activa; la UI refresca `fetchPrivileges` (agregar `refreshPrivileges` al AuthProvider).
7. Renovaciones: webhook de pago autorizado extiende `premium_until`; si falla, reintentos + email + gracia.

### 4.4 Downgrade de tiendas (migración 0033)

```sql
ALTER TABLE public.stores
  ADD COLUMN deactivated_reason text NULL,
  ADD COLUMN deactivated_at timestamptz NULL;
```

- `choose_store_for_free_plan(p_keep bigint)`:
  - Auth user; no Premium; `p_keep` es una tienda propia activa.
  - `UPDATE stores SET is_active=false, deactivated_reason='premium_expired', deactivated_at=now() WHERE created_by=auth.uid() AND is_active AND id <> p_keep;`
  - Mantiene `p_keep` activa; audita.
- `reactivate_premium_stores(p_ids bigint[])`:
  - Auth user Premium; tiendas propias; máximo 3 activas; el trigger de cap valida.
  - Set `is_active=true, deactivated_reason=NULL, deactivated_at=NULL`.
- Job diario `job_scan_premium_expiry`:
  - Usuarios sin Premium con `premium_grace_until < now()` y >1 tienda activa propia.
  - Conserva la más antigua (`created_at`) y pausa el resto; email.
  - Si hay suscripción activa, no tocar.
- `my_store_ids()`:
  - `JOIN stores s ON s.id=us.store_id AND s.is_active`.
- Modal de downgrade (componente `PremiumDowngradeModal`):
  - `needs_store_choice` = true cuando no Premium, >1 tienda activa y gracia vencida (o el usuario entra manualmente).
  - Lista tiendas activas con radio, preselección de la más antigua, «Conservar esta tienda» y «Renovar Premium».
  - Durante la gracia se puede cerrar con «Decidir después»; después de la gracia es bloqueante (sin ESC, foco atrapado).
  - Bloquea el resto de la app hasta resolver o renovar (solo para operadores con tiendas propias).
  - `/premium/vencido` queda como página de respaldo/Deep link con el mismo contenido.
- Reactivación:
  - `/premium/tiendas` con checkboxes de tiendas pausadas por plan; máximo 3; al renovar se ofrece.
  - No reactivar automáticamente sin preguntar.

### 4.5 Seguridad y RLS

- `plans`: SELECT autenticado (o público para la página), escritura admin.
- `subscriptions`/`payments`: SELECT solo del dueño y admin; sin INSERT/UPDATE/DELETE para authenticated; Edge Functions con service_role.
- `payment_events`: solo service_role/admin.
- `activate_premium`: `REVOKE EXECUTE FROM PUBLIC, anon, authenticated; GRANT TO service_role`.
- `set_user_premium` sigue admin-only.
- `my_premium_status` SECURITY DEFINER, solo devuelve la fila propia.
- Auditoría de activaciones, cancelaciones, reembolsos y cambios manuales.
- Webhook: firma, monto/moneda/referencia, idempotencia, rate limit, log crudo.
- No guardar datos de tarjeta; Checkout hospedado/Bricks.

### 4.6 Operación y admin

- Panel admin de pagos: lista `payments`/`subscriptions`, estado, usuario, plan, monto, fecha, `provider_reference`; acciones: aprobar manual, reembolsar, cancelar, reactivar.
- Reconciliación: job/consulta de pendientes y webhooks perdidos.
- Soporte: runbook para «pagué y no se activó», «cancelé y me cobraron», «PSE pendiente», contracargos.
- Alertas internas: pago aprobado sin activación, webhook con firma inválida, suscripción vencida sin downgrade.

---

## 5. UX

- **Landing:** sección «Premium» con precio y CTA; modal explicativo si el usuario está logueado. No bloquear la landing pública.
- **Perfil:** tarjeta «Plan actual: Gratis / Premium hasta X», botón «Mejorar plan» o «Renovar», link «Cancelar suscripción».
- **`/premium`:** comparativa Free vs Premium, planes, **desglose de precio** (precio final, IVA incluido, comisión MP estimada, neto FAROX), FAQ (renovación, cancelación, reembolso, PSE), links legales, CTA.
- **`/premium/resultado`:** aprobado / pendiente / rechazado; «Premium hasta X»; botón «Volver a la app».
- **Modal de downgrade:** las 3 tiendas con radio, «Conservar como principal» o «Renovar para mantener las 3»; bloqueante después de la gracia. `/premium/vencido` como respaldo.
- **Tiendas:** badge «Pausada por plan» y acción «Reactivar» (Premium); la conservada muestra «Principal» mientras el plan sea gratuito; el admin ve todas.
- **Admin:** «Planes y precios» con precio/IVA/comisión, previsualización del desglose e histórico de versiones.
- **Emails:** confirmación de suscripción, próximo cobro, pago fallido, vencimiento, gracia, downgrade, cancelación.
- **Accesibilidad:** foco, teclado, contraste, textos claros; no dark patterns.

---

## 6. Fases de implementación

### F0 — Decisiones y cumplimiento (1–2 días)

- Cerrar precio mensual/anual, trial, gracia, tienda por defecto.
- Definir si el precio final absorbe la comisión de Mercado Pago o la traslada (`fee_passed_to_customer`); recomendado absorber para mantener 10.000.
- Confirmar IVA incluido y régimen de facturación con contador.
- Abrir cuenta Mercado Pago, KYC, aplicación, credenciales sandbox, webhook HTTPS.
- Definir modalidad de Suscripciones (plan creado en el panel vs preapproval dinámico), moneda COP, `back_url`, `external_reference`.
- Borrador de términos/privacidad/reembolso/PQR; revisión legal.
- **Salida:** documento de decisiones firmado; sandbox listo.
- **No code.**

### F1 — Estado Premium con vencimiento (2–3 días)

- Migración 0032: `premium_until`, `premium_grace_until`, `plans` con parámetros de precio/IVA/comisión, `plan_versions`, `subscriptions` con `plan_version_id`/`price_cents_at_signup`, `payments`, `payment_events`; `is_premium`, `set_user_premium`, `activate_premium`, `my_premium_status`, `quote_plan`, `update_plan_pricing`.
- Migración de datos: los `premium=true` existentes quedan `premium_until=NULL` (manual/indefinido); no se cobran ni se vencen.
- UI: perfil muestra plan/vigencia; badge; `refreshPrivileges`.
- Tests SQL: fecha futura/pasada, admin, grant manual, expiración, RLS, matemática del desglose (IVA incluido/excluido, comisión fija/porcentual), versionado y grandfathering.
- **Aceptación:** un admin puede dar 1 mes; `is_premium` true hasta la fecha y false después; nadie más escribe `premium`; el desglose coincide con el monto que se cobra.

### F2 — Downgrade de tiendas y modal (3–4 días)

- Migración 0033: `deactivated_reason/at`, `my_store_ids` con `is_active`, `choose_store_for_free_plan`, `reactivate_premium_stores`, job de expiración.
- UI: `PremiumDowngradeModal` con las 2–3 tiendas, radio, «Conservar como principal», «Renovar Premium»; versión bloqueante después de la gracia; `/premium/vencido` como respaldo; badge «Principal»; badges de pausa; reactivación.
- Tests: 3 activas + vencido → modal; elegir 1 → 2 pausadas; datos intactos; renovar → reactivar hasta 3; free no puede 2 activas; RLS de tienda pausada; modal accesible/bloqueante.
- **Aceptación:** no se pierde data; el usuario elige o renueva; el tope se cumple.

### F3 — Página `/premium`, desglose y CTAs (2–3 días)

- Comparativa, planes, **desglose de precio** (final, IVA incluido, comisión MP estimada, neto FAROX), FAQ, links legales, landing banner/modal, perfil.
- Analítica de clics; modo manual (sin pago) para validar demanda.
- Admin preview del desglose (sin guardar) para ajustar precio/IVA/comisión.
- Tests UI/accesibilidad/copys y matemática del desglose.
- **Aceptación:** se ve precio y beneficios; el desglose es claro y no hay cargos sorpresa; CTA; activación manual sigue funcionando.

### F4 — Mercado Pago Suscripciones (5–7 días)

- Edge Functions `create-subscription`, `mp-webhook`, `cancel-subscription`; secrets; migración de soporte si falta.
- Preapproval con plan o dinámico; `external_reference`; `back_url`; monto desde `plan_versions`, nunca desde el cliente.
- Webhook con firma, idempotencia, consulta real, activación/extensión.
- UI checkout/resultado/cancelación; el checkout muestra el mismo desglose de `quote_plan`.
- Tests sandbox: tarjeta aprobada/rechazada, PSE (si aplica), webhook duplicado, monto alterado, usuario no autenticado, cancelación.
- **Aceptación:** sandbox activa Premium; el cliente no escribe `premium`; cancelar detiene el cobro; el acceso sigue hasta el fin del período; el pago coincide con el desglose.
- **Riesgo:** PSE recurrente; confirmar con MP.

### F5 — Renovaciones, gracia, avisos y admin (4–6 días)

- Emails 7/3/1, vencimiento, pago fallido, gracia, downgrade, cancelación.
- Job de gracia/downgrade; reconciliación; panel admin de pagos; reembolsos; auditoría.
- Panel admin «Planes y precios»: editar precio/IVA/comisión, previsualizar desglose, ver versiones; campaña de cambio de precio a suscriptores existentes con aviso y cancelación.
- Tests de ciclo completo, contracargos y cambio de precio (nuevos vs existentes).
- **Aceptación:** ciclo completo sin sorpresas; soporte puede resolver; el precio nuevo aplica a nuevos y no cambia silenciosamente a los existentes.

### F6 — Lanzamiento (1–2 semanas, paralelo)

- Legal final, facturación/IVA, PQR, runbook, monitoreo, feature flag, staging, canary, rollback.
- **Aceptación:** checklist legal y operativo completo; rollout gradual.

### Definición de Done (aplica a cada fase)

- Migraciones idempotentes y probadas en un Supabase limpio + una copia de producción.
- RLS verificada: ningún cliente puede escribir `premium`, `payments`, `subscriptions` ni `payment_events`.
- `typecheck`, `lint`, `check-scope`, tests y build en verde.
- Tests nuevos para el flujo de la fase y regresión de los flujos existentes.
- Documentación actualizada (`supabase/APLICAR-EN-PRODUCCION.md`, manual, este plan).
- Feature flag y rollback definidos para lo que toque producción.
- Revisión legal de los copys visibles al usuario.
- Sin datos borrados: pausar una tienda no elimina stock, pedidos, rutas ni créditos.

---

## 7. Estrategia de pruebas

- **SQL:** estado premium, fechas, idempotencia, RLS, downgrade, cap, `my_store_ids` activo, job, matemática de `quote_plan` (IVA incluido/excluido, comisión fija/porcentual, `fee_passed_to_customer`), versionado de planes y grandfathering.
- **Edge Functions:** unitarias con mocks de MP; integración sandbox; webhook con firma inválida/duplicada/fuera de orden.
- **E2E sandbox:** suscripción mensual/anual, pago aprobado, rechazado, PSE pendiente, cancelación, renovación, reembolso.
- **UI:** free/premium, perfil, `/premium`, desglose, resultado, modal de downgrade (gracia y bloqueante), reactivación, accesibilidad.
- **Regresión:** no romper dashboard, movimientos, precios, venta directa, pedidos, rutas, alertas.
- **Legal:** revisión de copys y flujo por abogado; prueba de aceptación y cancelación; revisar que el desglose no se perciba como cargo extra.

## 8. Rollout y operación

- Feature flag `premium_payments_enabled` (env/config) para activar checkout sin redeploy.
- Staging con Mercado Pago sandbox; producción con credenciales productivas.
- Canary: admin + 5–10 usuarios; monitorear conversión, activación, webhooks, errores.
- Métricas: checkout iniciado, pago aprobado, activación, renovación, churn, downgrade, reembolsos, contracargos, tickets.
- Alertas: pago aprobado sin activación, firma inválida, webhook caído, suscripción vencida sin job.
- Rollback: desactivar flag, volver a activación manual; no borrar datos.

## 9. Riesgos y preguntas abiertas

1. **PSE recurrente:** ¿Mercado Pago Colombia permite cobros automáticos con PSE o solo el primero? Si no, exigir tarjeta/cuenta MP para auto-renovación o vender renovación manual.
2. **Comisión de Suscripciones:** confirmar tarifa exacta y IVA; ajustar precio.
3. **IVA/factura electrónica:** definir si el precio incluye IVA y cómo se emite la factura.
4. **Retracto/reembolsos:** revisar aplicabilidad a servicio digital y política.
5. **Tienda por defecto:** ¿la más antigua o la de más actividad? Propuesta: la más antigua.
6. **Gracia:** ¿7 días? ¿Se bloquean funciones Premium durante la gracia? Propuesta: sí, funciones bloqueadas; tiendas activas solo para elegir/renovar.
7. **Trial:** no en v1; evaluar después.
8. **QR masivo:** implementarlo antes de venderlo.
9. **Precio y transparencia:** el desglose debe dejar claro que la comisión de MP se descuenta del recaudo; si se traslada al cliente, el precio final sube y hay que actualizar términos/UX.
10. **Cambio de precio a suscriptores existentes:** requiere aviso y consentimiento/cancelación; no hacerlo silenciosamente. Definir si se mantiene grandfathering.
11. **Modal bloqueante:** validar UX y accesibilidad; no encerrar al usuario sin opción de renovar o elegir. Después de la gracia, el modal debe permitir ambas acciones.
12. **Legal:** validar todo con abogado colombiano; este documento no es asesoría legal.

## 10. Log


- **L1 (2026-11-01):** «Me gusta tu plan, pero si el usuario tiene 3 tiendas, porque es premium, si deja de serlo perderia 2 tiendas, deberia estar la opcion de que escoja una tienda o que renueve el premium. Y lo de mercado pago me convence mas por la renovacion automatica. Una cosa a revisar, es la ley en colombia para las suscripciones y los terminos de mercado pago para implementar. Genera un plan lo mas completo posible para luego ir desarrollando fase a fase y disminuir los errores.»
- **L2 (diseño):** Mercado Pago Suscripciones; `premium_until` + `premium_grace_until`; downgrade con elección/pausa; `my_store_ids` filtra activas; fases F0–F6; revisión legal y de comisiones pendiente.
- **L3 (2026-11-01):** «Si, ademas me gustaria que se mostrara la lista de precios que agregan valor como el impuesto y el cobro que se lleva mercado pago. El precio mantenlo asi, pero que se modificable para cambiar segun la demanda y la oferta. La seleccion de la tienda que queda a manos del usuario, como una ventana emergente que muestre las 3 tiendas diciendo que cual desea conservar como principal o la opcion de renovar para mantener las 3 tiendas activas.»
- **L4 (diseño):** desglose `quote_plan` (precio final, IVA incluido, comisión MP estimada, neto), precios editables por admin con `plan_versions` y grandfathering; modal de downgrade con las 3 tiendas, «Conservar como principal» y «Renovar para mantener las 3».

## 11. Backlog: edición, eliminación y transferencia de tiendas

Solicitado por el usuario el 2026-11-02; **no se implementa en F3**.

- **Editar tienda:** el dueño (`created_by`) o admin puede cambiar nombre, dirección, ciudad, teléfono y tipo; la RLS `stores_update` ya lo permite. La UI debe mostrarlo sin depender del admin.
- **Desactivar/eliminar por el dueño:** permitir que el dueño pause una tienda voluntariamente (`is_active=false`, `deactivated_reason='user_removed'`, `deactivated_at`) para liberar un cupo o porque ya no la usa. No borra stock, pedidos, rutas ni créditos. El borrado duro/purga sigue siendo admin-only sobre una tienda ya inactiva (retención/auditoría).
- **Transferir propiedad:** si la tienda ya no es del usuario, un admin debe transferirla (`created_by` + `user_stores`) en una RPC auditada; no debe quedar huérfana ni el dueño anterior conservar acceso. El tope de 3 cuenta tiendas activas del nuevo dueño.
- **Menos tiendas:** al desactivar una tienda, el cupo se libera; al reactivarla, el trigger de tope sigue siendo la última defensa. Si la tienda está pausada por plan, el dueño puede eliminarla/transferirla sin esperar a Premium.
- **UI:** acciones «Editar», «Desactivar» y «Eliminar» (admin) en la lista/detalle; confirmación; badge «Pausada por plan» vs «Inactiva»; auditoría.
- **Tests:** RLS de dueño/admin, transferencia, cap, datos preservados, no acceso del dueño anterior.

## 12. Fuentes consultadas

- Ley 1480 de 2011 (Estatuto del Consumidor), arts. 26, 35, 41, 43.14: https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=44306
- Ley 2439 de 2024 (comercio electrónico): https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=171718
- Resumen de Ley 2439 (Holland & Knight): https://www.hklaw.com/en/insights/publications/2025/01/ley-2439-de-2024-modificaciones-al-estatuto-del-consumidor-en-colombia
- Mercado Pago Colombia — Suscripciones: https://www.mercadopago.com.co/herramientas-para-vender/suscripciones
- Mercado Pago Developers — Suscripciones (resumen): https://www.mercadopago.com.co/developers/es/docs/subscriptions/overview
- Mercado Pago Developers — API de Suscripciones/preapproval: https://www.mercadopago.com.co/developers/es/reference/online-payments/subscriptions/get-preapproval/get
- Mercado Pago Developers — Webhooks y `x-signature`: https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/resources/notifications/webhooks
- Documento SIC sobre cláusulas de renovación automática: https://enlegislacion.com/files/susc/cdj/doct/sic_171559_26.pdf
- Referencia de comisiones de pasarelas en Colombia 2026 (secundaria; verificar en el panel): https://btodigital.com/pasarelas-pago-colombia-comparativa-guia-negocio

> Las cifras de comisiones y la elegibilidad de PSE para cobros recurrentes deben confirmarse con Mercado Pago Colombia antes de fijar el precio. La revisión legal final corresponde a un abogado colombiano.
