-- ============================================================================
-- FAROX — 0035: soporte de F4 (Mercado Pago Suscripciones).
--
--   · external_reference: referencia única que viaja al preapproval y vuelve
--     en los webhooks; permite conciliar sin confiar en el monto del cliente.
--   · provider_init_point: URL de checkout devuelta por Mercado Pago para
--     reutilizarla si el usuario vuelve a entrar con una suscripción pending.
--
-- No cambia RLS: subscriptions ya es SELECT propio/admin y las escrituras
-- pasan solo por service_role (Edge Functions). Agrega EXECUTE de las RPC
-- nuevas a service_role, revocado de PUBLIC/anon/authenticated.
-- ============================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS external_reference text,
  ADD COLUMN IF NOT EXISTS provider_init_point text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_external_reference
  ON public.subscriptions (external_reference)
  WHERE external_reference IS NOT NULL;

-- Un usuario no puede tener dos suscripciones activas/pendientes a la vez.
-- Al cancelar o vencer, la fila sale del índice y puede volver a suscribirse.
-- Antes de crear el índice, se cancelan duplicados de datos de laboratorio:
-- se conserva la suscripción autorizada más reciente (o la pending más nueva).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id
           ORDER BY (status = 'authorized') DESC, created_at DESC, id DESC
         ) AS rn
  FROM public.subscriptions
  WHERE status IN ('pending', 'authorized', 'paused')
)
UPDATE public.subscriptions s
SET status = 'cancelled',
    cancel_at_period_end = true
FROM ranked r
WHERE s.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_one_active_per_user
  ON public.subscriptions (user_id)
  WHERE status IN ('pending', 'authorized', 'paused');

-- ============================================================================
-- 2. Merge atómico del período pagado.
--
-- Un webhook de pago puede llegar tarde o desordenado. Esta función:
--   · nunca retrocede current_period_start/end;
--   · no reautoriza una suscripción cancelled/expired;
--   · serializa con la cancelación mediante el row lock.
-- Solo service_role (Edge Function) puede ejecutarla.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.merge_subscription_period(
  p_subscription bigint,
  p_start timestamptz,
  p_end timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM public.subscriptions
  WHERE id = p_subscription
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_subscription_period: suscripción inexistente: %', p_subscription;
  END IF;

  UPDATE public.subscriptions
  SET current_period_start = CASE
        WHEN p_start IS NULL THEN current_period_start
        WHEN current_period_start IS NULL OR p_start > current_period_start THEN p_start
        ELSE current_period_start
      END,
      current_period_end = CASE
        WHEN p_end IS NULL THEN current_period_end
        WHEN current_period_end IS NULL OR p_end > current_period_end THEN p_end
        ELSE current_period_end
      END,
      status = CASE
        WHEN v_status IN ('cancelled', 'expired', 'paused') THEN v_status
        ELSE 'authorized'
      END,
      updated_at = now()
  WHERE id = p_subscription;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.merge_subscription_period(bigint, timestamptz, timestamptz)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.merge_subscription_period(bigint, timestamptz, timestamptz)
TO service_role;

-- ============================================================================
-- 3. Activación por período pagado.
--
-- A diferencia de activate_premium (que suma meses desde premium_until), esta
-- función usa el fin real del período de la factura y toma el máximo. Un
-- webhook viejo que llega tarde no alarga Premium de más ni lo acorta.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.activate_premium_until(
  p_user uuid,
  p_until timestamptz,
  p_payment_id bigint
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_status text;
  v_until  timestamptz;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'activate_premium_until: usuario requerido';
  END IF;
  IF p_until IS NULL THEN
    RAISE EXCEPTION 'activate_premium_until: fin de período requerido';
  END IF;
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'activate_premium_until: pago requerido';
  END IF;

  SELECT status INTO v_status
  FROM public.payments
  WHERE id = p_payment_id AND user_id = p_user
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'activate_premium_until: pago % no existe para el usuario', p_payment_id;
  END IF;
  IF v_status = 'approved' THEN
    SELECT premium_until INTO v_until FROM public.users WHERE id = p_user;
    RETURN v_until;
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'activate_premium_until: el pago % no está pendiente (%)', p_payment_id, v_status;
  END IF;

  UPDATE public.users
  SET premium = true,
      premium_until = GREATEST(COALESCE(premium_until, now()), p_until),
      premium_grace_until = NULL,
      updated_at = now()
  WHERE id = p_user
  RETURNING premium_until INTO v_until;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'activate_premium_until: usuario inexistente: %', p_user;
  END IF;

  UPDATE public.payments
  SET status = 'approved', paid_at = now()
  WHERE id = p_payment_id;

  RETURN v_until;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.activate_premium_until(uuid, timestamptz, bigint)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.activate_premium_until(uuid, timestamptz, bigint)
TO service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · information_schema.columns muestra external_reference y
--     provider_init_point en public.subscriptions.
--   · pg_indexes muestra uq_subscriptions_external_reference y
--     uq_subscriptions_one_active_per_user.
--   · Un INSERT/UPDATE directo de authenticated sobre subscriptions sigue
--     revocado (solo SELECT propio/admin).
--   · merge_subscription_period no es ejecutable por authenticated; solo
--     service_role. Un pago con fecha vieja no retrocede el período.
--   · activate_premium_until tampoco es ejecutable por authenticated; un pago
--     viejo no reduce premium_until y un pago nuevo lo extiende.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   DROP FUNCTION IF EXISTS public.activate_premium_until(uuid, timestamptz, bigint);
--   DROP FUNCTION IF EXISTS public.merge_subscription_period(bigint, timestamptz, timestamptz);
--   DROP INDEX IF EXISTS public.uq_subscriptions_one_active_per_user;
--   DROP INDEX IF EXISTS public.uq_subscriptions_external_reference;
--   ALTER TABLE public.subscriptions
--     DROP COLUMN IF EXISTS provider_init_point,
--     DROP COLUMN IF EXISTS external_reference;
