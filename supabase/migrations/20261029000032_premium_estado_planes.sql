-- ============================================================================
-- FAROX — 0032: Premium con vencimiento, planes versionados y desglose.
--
--   · users.premium_until / premium_grace_until: el grant manual sigue en
--     users.premium; el pago tiene fecha y gracia para elegir tienda.
--   · plans + plan_versions: precio final, IVA y comisión de Mercado Pago
--     configurables por admin, con histórico. quote_plan calcula el desglose
--     server-side (la misma cifra para UI y checkout).
--   · subscriptions / payments / payment_events: modelo de F4; en F1 se usan
--     para probar activate_premium con un pago de laboratorio.
--   · is_premium respeta la fecha; job diario sincroniza users.premium.
--
-- Reglas: SECURITY DEFINER + SET search_path; alcance desde JWT; GRANT
-- explícito; el cliente nunca escribe premium/pagos/suscripciones.
-- ============================================================================

-- ============================================================================
-- 1. Vigencia del Premium.
-- ============================================================================
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS premium_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS premium_grace_until timestamptz NULL;

-- ============================================================================
-- 2. Planes y versiones de precio.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.plans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),   -- precio final
  currency char(3) NOT NULL DEFAULT 'COP',
  interval_months integer NOT NULL CHECK (interval_months BETWEEN 1 AND 12),
  trial_days integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  tax_rate_bps integer NOT NULL DEFAULT 1900 CHECK (tax_rate_bps BETWEEN 0 AND 5000),
  tax_included boolean NOT NULL DEFAULT true,
  mp_fee_bps integer NOT NULL DEFAULT 329 CHECK (mp_fee_bps BETWEEN 0 AND 2000),
  mp_fee_fixed_cents integer NOT NULL DEFAULT 80000 CHECK (mp_fee_fixed_cents >= 0),
  mp_fee_tax_bps integer NOT NULL DEFAULT 1900 CHECK (mp_fee_tax_bps BETWEEN 0 AND 5000),
  fee_passed_to_customer boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  features jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.plan_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id bigint NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  version integer NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL,
  interval_months integer NOT NULL,
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

DROP TRIGGER IF EXISTS trg_plans_updated_at ON public.plans;
CREATE TRIGGER trg_plans_updated_at
BEFORE UPDATE ON public.plans FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- 3. Suscripciones, pagos y eventos (modelo para F4).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  plan_id bigint NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  plan_version_id bigint NOT NULL REFERENCES public.plan_versions(id) ON DELETE RESTRICT,
  price_cents_at_signup integer NOT NULL CHECK (price_cents_at_signup > 0),
  currency char(3) NOT NULL DEFAULT 'COP',
  provider text NOT NULL DEFAULT 'mercadopago',
  provider_subscription_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'authorized', 'paused', 'cancelled', 'expired')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions (user_id);

CREATE TABLE IF NOT EXISTS public.payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  subscription_id bigint NULL REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  plan_id bigint NULL REFERENCES public.plans(id) ON DELETE SET NULL,
  plan_version_id bigint NULL REFERENCES public.plan_versions(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'mercadopago',
  provider_payment_id text UNIQUE,
  provider_reference text UNIQUE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL DEFAULT 'COP',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'refunded', 'charged_back')),
  raw_event jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON public.payments (user_id);

CREATE TABLE IF NOT EXISTS public.payment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL,
  event_id text NOT NULL,
  topic text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, event_id)
);

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- 4. Seed inicial (10.000/mes y 100.000/año). El admin puede cambiarlo.
-- ============================================================================
INSERT INTO public.plans
  (code, name, amount_cents, currency, interval_months, tax_rate_bps, tax_included,
   mp_fee_bps, mp_fee_fixed_cents, mp_fee_tax_bps, fee_passed_to_customer, active, features)
VALUES
  ('premium_monthly', 'Premium mensual', 1000000, 'COP', 1, 1900, true,
   329, 80000, 1900, false, true, '{"stores":3,"dashboard":true}'::jsonb),
  ('premium_annual', 'Premium anual', 10000000, 'COP', 12, 1900, true,
   329, 80000, 1900, false, true, '{"stores":3,"dashboard":true}'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.plan_versions
  (plan_id, version, amount_cents, currency, interval_months, tax_rate_bps, tax_included,
   mp_fee_bps, mp_fee_fixed_cents, mp_fee_tax_bps, fee_passed_to_customer, created_by)
SELECT p.id, 1, p.amount_cents, p.currency, p.interval_months, p.tax_rate_bps, p.tax_included,
       p.mp_fee_bps, p.mp_fee_fixed_cents, p.mp_fee_tax_bps, p.fee_passed_to_customer, NULL
FROM public.plans p
WHERE p.code IN ('premium_monthly', 'premium_annual')
  AND NOT EXISTS (
    SELECT 1 FROM public.plan_versions v WHERE v.plan_id = p.id AND v.version = 1
  );

-- ============================================================================
-- 5. RLS: lectura pública de planes activos, lectura propia de pagos;
--    escritura solo por RPC/Edge Functions.
-- ============================================================================
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plans_select ON public.plans;
CREATE POLICY plans_select ON public.plans
  FOR SELECT TO anon, authenticated
  USING (active OR public.my_role() = 'admin');

DROP POLICY IF EXISTS plan_versions_select ON public.plan_versions;
CREATE POLICY plan_versions_select ON public.plan_versions
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin');

DROP POLICY IF EXISTS subscriptions_select ON public.subscriptions;
CREATE POLICY subscriptions_select ON public.subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.my_role() = 'admin');

DROP POLICY IF EXISTS payments_select ON public.payments;
CREATE POLICY payments_select ON public.payments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.my_role() = 'admin');

DROP POLICY IF EXISTS payment_events_select ON public.payment_events;
CREATE POLICY payment_events_select ON public.payment_events
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin');

REVOKE ALL ON public.plans FROM anon, authenticated;
REVOKE ALL ON public.plan_versions FROM anon, authenticated;
REVOKE ALL ON public.subscriptions FROM anon, authenticated;
REVOKE ALL ON public.payments FROM anon, authenticated;
REVOKE ALL ON public.payment_events FROM anon, authenticated;

GRANT SELECT ON public.plans TO anon, authenticated;
GRANT SELECT ON public.plan_versions TO authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT SELECT ON public.payments TO authenticated;
GRANT SELECT ON public.payment_events TO authenticated;

-- ============================================================================
-- 6. is_premium respeta la fecha. El admin sigue exento.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_premium() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = auth.uid()
      AND u.is_active
      AND (r.name = 'admin'
           OR (u.premium AND (u.premium_until IS NULL OR u.premium_until > now())))
  );
$$;

-- ============================================================================
-- 7. Grant manual del admin: true = indefinido; false = revoca + gracia.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_user_premium(
  p_user_id uuid, p_value boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.assert_admin();
  UPDATE public.users
  SET premium = p_value,
      premium_until = CASE
        WHEN p_value THEN NULL
        WHEN premium THEN now()
        ELSE premium_until
      END,
      premium_grace_until = CASE
        WHEN p_value THEN NULL
        WHEN premium THEN now() + interval '7 days'
        ELSE premium_grace_until
      END,
      updated_at = now()
  WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'usuario inexistente: %', p_user_id;
  END IF;
END;
$$;

-- ============================================================================
-- 8. Activación pagada (service_role/Edge Function). Idempotente por pago.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.activate_premium(
  p_user uuid,
  p_months integer,
  p_payment bigint DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_until  timestamptz;
  v_status text;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'activate_premium: usuario requerido';
  END IF;
  IF p_months IS NULL OR p_months < 1 OR p_months > 12 THEN
    RAISE EXCEPTION 'activate_premium: meses fuera de rango (%)', p_months;
  END IF;

  IF p_payment IS NOT NULL THEN
    SELECT status INTO v_status
    FROM public.payments
    WHERE id = p_payment AND user_id = p_user
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'activate_premium: pago % no existe para el usuario', p_payment;
    END IF;
    IF v_status = 'approved' THEN
      SELECT premium_until INTO v_until FROM public.users WHERE id = p_user;
      RETURN v_until;
    END IF;
    IF v_status <> 'pending' THEN
      RAISE EXCEPTION 'activate_premium: el pago % no está pendiente (%)', p_payment, v_status;
    END IF;
  END IF;

  UPDATE public.users
  SET premium = true,
      premium_until = GREATEST(COALESCE(premium_until, now()), now())
                      + (p_months || ' months')::interval,
      premium_grace_until = NULL,
      updated_at = now()
  WHERE id = p_user
  RETURNING premium_until INTO v_until;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'activate_premium: usuario inexistente: %', p_user;
  END IF;

  IF p_payment IS NOT NULL THEN
    UPDATE public.payments
    SET status = 'approved', paid_at = now()
    WHERE id = p_payment;
  END IF;

  RETURN v_until;
END;
$$;

-- ============================================================================
-- 9. Estado para el perfil y el futuro modal de downgrade.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_premium_status()
RETURNS TABLE (
  premium boolean,
  premium_until timestamptz,
  premium_grace_until timestamptz,
  grace_active boolean,
  needs_store_choice boolean,
  active_owned_stores bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT
    public.is_premium(),
    u.premium_until,
    COALESCE(u.premium_grace_until, u.premium_until + interval '7 days'),
    COALESCE(
      COALESCE(u.premium_grace_until, u.premium_until + interval '7 days') > now(),
      false
    ),
    (NOT public.is_premium())
      AND (SELECT count(*) FROM public.stores s
           WHERE s.created_by = auth.uid() AND s.is_active) > 1,
    (SELECT count(*) FROM public.stores s
     WHERE s.created_by = auth.uid() AND s.is_active)
  FROM public.users u
  WHERE u.id = auth.uid();
$$;

-- ============================================================================
-- 10. Desglose server-side. Precio final = amount_cents; IVA y comisión se
--     muestran, la comisión se descuenta (fee_passed_to_customer=false).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.quote_plan(p_code text)
RETURNS TABLE (
  code text,
  name text,
  final_cents integer,
  base_cents integer,
  tax_cents integer,
  mp_fee_cents integer,
  net_cents integer,
  currency char(3),
  interval_months integer,
  tax_included boolean,
  fee_passed_to_customer boolean,
  mp_fee_bps integer,
  mp_fee_fixed_cents integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  p       public.plans%ROWTYPE;
  v_base  integer;
  v_tax   integer;
  v_final integer;
  v_fee   integer;
  v_fee_tax integer;
  v_net   integer;
BEGIN
  SELECT * INTO p
  FROM public.plans
  WHERE plans.code = p_code AND plans.active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote_plan: plan inexistente o inactivo: %', p_code;
  END IF;
  IF p.fee_passed_to_customer THEN
    RAISE EXCEPTION 'quote_plan: fee_passed_to_customer se implementará en F3/F5';
  END IF;

  v_final := p.amount_cents;
  IF p.tax_included THEN
    v_base := round(v_final * 10000.0 / (10000 + p.tax_rate_bps))::integer;
    v_tax := v_final - v_base;
  ELSE
    v_base := v_final;
    v_tax := round(v_base * p.tax_rate_bps / 10000.0)::integer;
    v_final := v_base + v_tax;
  END IF;

  v_fee := round(v_final * p.mp_fee_bps / 10000.0)::integer + p.mp_fee_fixed_cents;
  v_fee_tax := round(v_fee * p.mp_fee_tax_bps / 10000.0)::integer;
  v_fee := v_fee + v_fee_tax;
  v_net := v_final - v_tax - v_fee;

  RETURN QUERY SELECT
    p.code, p.name, v_final, v_base, v_tax, v_fee, v_net,
    p.currency, p.interval_months, p.tax_included, p.fee_passed_to_customer,
    p.mp_fee_bps, p.mp_fee_fixed_cents;
END;
$$;

-- ============================================================================
-- 11. Edición de precios: solo admin; cada cambio crea versión.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_plan_pricing(
  p_code text,
  p_amount_cents integer,
  p_tax_rate_bps integer,
  p_tax_included boolean,
  p_mp_fee_bps integer,
  p_mp_fee_fixed_cents integer,
  p_mp_fee_tax_bps integer,
  p_fee_passed_to_customer boolean,
  p_active boolean DEFAULT true
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_plan    public.plans%ROWTYPE;
  v_version integer;
BEGIN
  PERFORM public.assert_admin();
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'update_plan_pricing: code requerido';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'update_plan_pricing: el precio debe ser > 0';
  END IF;
  IF p_tax_rate_bps IS NULL OR p_tax_rate_bps < 0 OR p_tax_rate_bps > 5000 THEN
    RAISE EXCEPTION 'update_plan_pricing: IVA fuera de rango';
  END IF;
  IF p_mp_fee_bps IS NULL OR p_mp_fee_bps < 0 OR p_mp_fee_bps > 2000 THEN
    RAISE EXCEPTION 'update_plan_pricing: comisión fuera de rango';
  END IF;
  IF p_mp_fee_fixed_cents IS NULL OR p_mp_fee_fixed_cents < 0 THEN
    RAISE EXCEPTION 'update_plan_pricing: fijo inválido';
  END IF;
  IF p_mp_fee_tax_bps IS NULL OR p_mp_fee_tax_bps < 0 OR p_mp_fee_tax_bps > 5000 THEN
    RAISE EXCEPTION 'update_plan_pricing: IVA de comisión fuera de rango';
  END IF;
  IF p_fee_passed_to_customer IS NULL THEN
    RAISE EXCEPTION 'update_plan_pricing: fee_passed_to_customer requerido';
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_plan_pricing: plan inexistente: %', p_code;
  END IF;
  v_version := v_plan.version + 1;

  INSERT INTO public.plan_versions
    (plan_id, version, amount_cents, currency, interval_months, tax_rate_bps, tax_included,
     mp_fee_bps, mp_fee_fixed_cents, mp_fee_tax_bps, fee_passed_to_customer, created_by)
  VALUES
    (v_plan.id, v_version, p_amount_cents, v_plan.currency, v_plan.interval_months,
     p_tax_rate_bps, p_tax_included, p_mp_fee_bps, p_mp_fee_fixed_cents, p_mp_fee_tax_bps,
     p_fee_passed_to_customer, auth.uid());

  UPDATE public.plans
  SET amount_cents = p_amount_cents,
      tax_rate_bps = p_tax_rate_bps,
      tax_included = p_tax_included,
      mp_fee_bps = p_mp_fee_bps,
      mp_fee_fixed_cents = p_mp_fee_fixed_cents,
      mp_fee_tax_bps = p_mp_fee_tax_bps,
      fee_passed_to_customer = p_fee_passed_to_customer,
      active = COALESCE(p_active, true),
      version = v_version,
      updated_at = now()
  WHERE id = v_plan.id;

  RETURN v_version;
END;
$$;

-- ============================================================================
-- 12. Job diario: sincroniza users.premium con la fecha (para el listado
--     admin) y deja la gracia lista para el downgrade.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.job_sync_premium_expiry() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.users
  SET premium = false,
      premium_grace_until = COALESCE(premium_grace_until, premium_until + interval '7 days'),
      updated_at = now()
  WHERE premium = true
    AND premium_until IS NOT NULL
    AND premium_until <= now();

  UPDATE public.users
  SET premium_grace_until = premium_until + interval '7 days',
      updated_at = now()
  WHERE premium = false
    AND premium_until IS NOT NULL
    AND premium_until <= now()
    AND premium_grace_until IS NULL;
END;
$$;

-- ============================================================================
-- 13. Grants.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.activate_premium(uuid, integer, bigint),
  public.job_sync_premium_expiry()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.activate_premium(uuid, integer, bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION
  public.quote_plan(text),
  public.update_plan_pricing(text, integer, integer, boolean, integer, integer, integer, boolean, boolean),
  public.my_premium_status()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.quote_plan(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_premium_status() TO authenticated;

GRANT EXECUTE ON FUNCTION
  public.update_plan_pricing(text, integer, integer, boolean, integer, integer, integer, boolean, boolean)
TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'farox_premium_expiry') THEN
    PERFORM cron.unschedule('farox_premium_expiry');
  END IF;
END $$;
SELECT cron.schedule('farox_premium_expiry', '0 11 * * *',
  $$SELECT public.job_sync_premium_expiry();$$);

-- ============================================================================
-- Verificación manual (SQL editor):
--   · quote_plan('premium_monthly') ⇒ final 1.000.000 céntimos, IVA 159.664,
--     comisión ~134.351, neto ~705.985 (según la tarifa configurada).
--   · update_plan_pricing cambia el precio y crea plan_versions v2; quote_plan
--     usa el precio nuevo; las suscripciones existentes no cambian.
--   · is_premium() false cuando premium_until < now(); admin sigue true.
--   · activate_premium extiende desde max(now, premium_until); repetir con el
--     mismo pago aprobado no duplica meses.
--   · job_sync_premium_expiry deja premium=false y grace=until+7d.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   SELECT cron.unschedule('farox_premium_expiry');
--   DROP FUNCTION IF EXISTS public.job_sync_premium_expiry();
--   DROP FUNCTION IF EXISTS public.update_plan_pricing(text, integer, integer, boolean, integer, integer, integer, boolean, boolean);
--   DROP FUNCTION IF EXISTS public.quote_plan(text);
--   DROP FUNCTION IF EXISTS public.my_premium_status();
--   DROP FUNCTION IF EXISTS public.activate_premium(uuid, integer, bigint);
--   Restaurar is_premium() y set_user_premium() desde 0004/0011.
--   DROP TABLE IF EXISTS public.payment_events, public.payments, public.subscriptions, public.plan_versions, public.plans;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS premium_until, DROP COLUMN IF EXISTS premium_grace_until;
