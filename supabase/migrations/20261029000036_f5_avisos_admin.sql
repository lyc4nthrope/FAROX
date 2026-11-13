-- ============================================================================
-- FAROX — 0036: soporte de F5 (avisos, preview de precios y operación admin).
--
--   · premium_notices: outbox idempotente para avisos de renovación/gracia/
--     vencimiento/pago rechazado/cancelación. La escribe service_role y la
--     lee el admin; el cliente no puede escribirla.
--   · preview_plan_quote: mismo cálculo server-side de quote_plan pero con
--     valores de borrador, para el panel admin de precios.
--   · enqueue_premium_notices: crea los avisos que corresponden al día.
-- ============================================================================

-- ============================================================================
-- 1. Outbox de avisos.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.premium_notices (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN (
    'renewal_7', 'renewal_3', 'renewal_1',
    'grace_ending', 'expired', 'downgraded',
    'payment_failed', 'cancellation'
  )),
  period_key  text NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  error       text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz NULL,
  UNIQUE (user_id, kind, period_key)
);

CREATE INDEX IF NOT EXISTS idx_premium_notices_pending
  ON public.premium_notices (created_at)
  WHERE status = 'pending';

-- Rotación de conciliación: los pagos pending se procesan por turnos para que
-- un lote de 50 no deje starvation a los siguientes.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_payments_pending_reconcile
  ON public.payments (last_reconciled_at)
  WHERE status = 'pending';

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_active_reconcile
  ON public.subscriptions (last_reconciled_at)
  WHERE status IN ('pending', 'authorized', 'paused');

ALTER TABLE public.premium_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS premium_notices_select ON public.premium_notices;
CREATE POLICY premium_notices_select ON public.premium_notices
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin');

REVOKE ALL ON public.premium_notices FROM anon, authenticated;
GRANT SELECT ON public.premium_notices TO authenticated;

-- ============================================================================
-- 2. Preview de precios (mismo cálculo de quote_plan, con valores de borrador).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.preview_plan_quote(
  p_amount_cents integer,
  p_tax_rate_bps integer,
  p_tax_included boolean,
  p_mp_fee_bps integer,
  p_mp_fee_fixed_cents integer,
  p_mp_fee_tax_bps integer
) RETURNS TABLE (
  final_cents integer,
  base_cents integer,
  tax_cents integer,
  mp_fee_cents integer,
  net_cents integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_base    integer;
  v_tax     integer;
  v_final   integer;
  v_fee     integer;
  v_fee_tax integer;
  v_net     integer;
BEGIN
  PERFORM public.assert_admin();
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'preview_plan_quote: el precio debe ser > 0';
  END IF;
  IF p_tax_rate_bps IS NULL OR p_tax_rate_bps < 0 OR p_tax_rate_bps > 5000 THEN
    RAISE EXCEPTION 'preview_plan_quote: IVA fuera de rango';
  END IF;
  IF p_mp_fee_bps IS NULL OR p_mp_fee_bps < 0 OR p_mp_fee_bps > 2000 THEN
    RAISE EXCEPTION 'preview_plan_quote: comisión fuera de rango';
  END IF;
  IF p_mp_fee_fixed_cents IS NULL OR p_mp_fee_fixed_cents < 0 THEN
    RAISE EXCEPTION 'preview_plan_quote: fijo inválido';
  END IF;
  IF p_mp_fee_tax_bps IS NULL OR p_mp_fee_tax_bps < 0 OR p_mp_fee_tax_bps > 5000 THEN
    RAISE EXCEPTION 'preview_plan_quote: IVA de comisión fuera de rango';
  END IF;
  IF p_tax_included IS NULL THEN
    RAISE EXCEPTION 'preview_plan_quote: tax_included requerido';
  END IF;

  v_final := p_amount_cents;
  IF p_tax_included THEN
    v_base := round(v_final::numeric * 10000 / (10000 + p_tax_rate_bps))::integer;
    v_tax := v_final - v_base;
  ELSE
    v_base := v_final;
    v_tax := round(v_base::numeric * p_tax_rate_bps / 10000)::integer;
    v_final := v_base + v_tax;
  END IF;

  v_fee := round(v_final::numeric * p_mp_fee_bps / 10000)::integer + p_mp_fee_fixed_cents;
  v_fee_tax := round(v_fee::numeric * p_mp_fee_tax_bps / 10000)::integer;
  v_fee := v_fee + v_fee_tax;
  v_net := v_final - v_tax - v_fee;

  RETURN QUERY SELECT v_final, v_base, v_tax, v_fee, v_net;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.preview_plan_quote(integer, integer, boolean, integer, integer, integer)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.preview_plan_quote(integer, integer, boolean, integer, integer, integer)
TO authenticated, service_role;

-- ============================================================================
-- 3. Encolar avisos del día.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enqueue_premium_notices()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_total integer := 0;
  v_count integer := 0;
BEGIN
  -- Renovación 7/3/1 días antes del fin pagado, solo si sigue autorizada y
  -- sin cancelación programada.
  INSERT INTO public.premium_notices (user_id, kind, period_key)
  SELECT u.id, k.kind, to_char(u.premium_until, 'YYYY-MM-DD')
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id AND r.name <> 'admin'
  JOIN public.subscriptions s
    ON s.user_id = u.id
   AND s.status = 'authorized'
   AND NOT s.cancel_at_period_end
  CROSS JOIN (VALUES ('renewal_7', 7), ('renewal_3', 3), ('renewal_1', 1))
    AS k(kind, days)
  WHERE u.is_active
    AND u.premium_until IS NOT NULL
    AND u.premium_until::date = current_date + k.days
  ON CONFLICT (user_id, kind, period_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  -- Gracia por vencer mañana.
  INSERT INTO public.premium_notices (user_id, kind, period_key)
  SELECT u.id, 'grace_ending', to_char(u.premium_grace_until, 'YYYY-MM-DD')
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id AND r.name <> 'admin'
  WHERE u.is_active
    AND u.premium_grace_until IS NOT NULL
    AND u.premium_grace_until::date = current_date + 1
    AND NOT (u.premium AND (u.premium_until IS NULL OR u.premium_until > now()))
  ON CONFLICT (user_id, kind, period_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  -- Vencimiento hoy.
  INSERT INTO public.premium_notices (user_id, kind, period_key)
  SELECT u.id, 'expired', to_char(u.premium_until, 'YYYY-MM-DD')
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id AND r.name <> 'admin'
  WHERE u.is_active
    AND u.premium_until IS NOT NULL
    AND u.premium_until::date = current_date
    AND NOT (u.premium AND (u.premium_until IS NULL OR u.premium_until > now()))
  ON CONFLICT (user_id, kind, period_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  -- Tiendas pausadas por downgrade hoy (un aviso por usuario/día).
  INSERT INTO public.premium_notices (user_id, kind, period_key)
  SELECT s.created_by, 'downgraded', to_char(max(s.deactivated_at), 'YYYY-MM-DD')
  FROM public.stores s
  WHERE s.deactivated_reason = 'premium_expired'
    AND s.deactivated_at IS NOT NULL
    AND s.deactivated_at::date >= current_date - 1
  GROUP BY s.created_by
  ON CONFLICT (user_id, kind, period_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  -- Pago rechazado hoy (una fila por pago).
  INSERT INTO public.premium_notices (user_id, kind, period_key)
  SELECT p.user_id, 'payment_failed', p.id::text
  FROM public.payments p
  JOIN public.users u ON u.id = p.user_id AND u.is_active
  WHERE p.status = 'rejected'
    AND p.created_at::date >= current_date - 1
  ON CONFLICT (user_id, kind, period_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  -- Cancelación: aviso 7 días antes del fin del período ya pagado.
  INSERT INTO public.premium_notices (user_id, kind, period_key)
  SELECT s.user_id, 'cancellation', to_char(s.current_period_end, 'YYYY-MM-DD')
  FROM public.subscriptions s
  WHERE s.status = 'cancelled'
    AND s.cancel_at_period_end
    AND s.current_period_end IS NOT NULL
    AND s.current_period_end::date = current_date + 7
  ON CONFLICT (user_id, kind, period_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;

  RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_premium_notices()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_premium_notices()
TO service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · premium_notices existe, RLS activo y solo admin puede SELECT; el cliente
--     no puede INSERT/UPDATE/DELETE.
--   · preview_plan_quote(1000000,1900,true,329,80000,1900) devuelve el mismo
--     desglose que quote_plan('premium_monthly') con los valores actuales.
--   · enqueue_premium_notices no es ejecutable por authenticated; solo
--     service_role. Insertar un aviso y llamar dos veces no duplica.
--   · payments.last_reconciled_at y subscriptions.last_reconciled_at existen;
--     los índices parciales de conciliación están.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   DROP FUNCTION IF EXISTS public.enqueue_premium_notices();
--   DROP FUNCTION IF EXISTS public.preview_plan_quote(integer, integer, boolean, integer, integer, integer);
--   DROP TABLE IF EXISTS public.premium_notices;
--   DROP INDEX IF EXISTS public.idx_subscriptions_active_reconcile;
--   ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS last_reconciled_at;
--   DROP INDEX IF EXISTS public.idx_payments_pending_reconcile;
--   ALTER TABLE public.payments DROP COLUMN IF EXISTS last_reconciled_at;
