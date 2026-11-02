-- ============================================================================
-- FAROX — 0033: downgrade de tiendas al vencer Premium.
--
--   · stores.deactivated_reason/at: distingue una pausa por plan de un
--     soft-delete administrativo.
--   · my_store_ids() filtra stores.is_active: una tienda pausada no es
--     operable, pero su data sigue existiendo.
--   · choose_store_for_free_plan / reactivate_premium_stores: el usuario
--     elige la tienda principal o reactiva las pausadas al renovar.
--   · job_scan_premium_downgrade: si no elige, conserva la más antigua y
--     pausa las demás al terminar la gracia.
-- ============================================================================

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS deactivated_reason text NULL,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz NULL;

-- ============================================================================
-- 1. Alcance: las tiendas pausadas dejan de estar en my_store_ids.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_store_ids() RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(array_agg(us.store_id), '{}'::bigint[])
  FROM public.user_stores us
  JOIN public.stores s ON s.id = us.store_id AND s.is_active
  WHERE us.user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.is_active
    );
$$;

-- ============================================================================
-- 2. Tiendas propias para el modal y la página de reactivación.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_owned_stores()
RETURNS TABLE (
  id bigint,
  name text,
  city text,
  created_at timestamptz,
  is_active boolean,
  deactivated_reason text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT s.id, s.name, s.city, s.created_at, s.is_active, s.deactivated_reason
  FROM public.stores s
  WHERE s.created_by = auth.uid()
  ORDER BY s.created_at, s.id;
$$;

-- ============================================================================
-- 3. Elegir la tienda principal sin Premium.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.choose_store_for_free_plan(p_keep bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF public.is_premium() THEN
    RAISE EXCEPTION 'choose_store_for_free_plan: todavía tenés Premium activo';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 0));
  IF p_keep IS NULL THEN
    RAISE EXCEPTION 'choose_store_for_free_plan: elegí una tienda';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stores
    WHERE id = p_keep AND created_by = auth.uid() AND is_active
  ) THEN
    RAISE EXCEPTION 'choose_store_for_free_plan: la tienda % no es tuya o no está activa', p_keep;
  END IF;

  UPDATE public.stores
  SET is_active = false,
      deactivated_reason = 'premium_expired',
      deactivated_at = now()
  WHERE created_by = auth.uid()
    AND is_active
    AND id <> p_keep;
END;
$$;

-- ============================================================================
-- 4. Reactivar tiendas pausadas al renovar.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reactivate_premium_stores(p_ids bigint[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_ids    bigint[];
  v_count  integer;
  v_active integer;
BEGIN
  IF NOT public.is_premium() THEN
    RAISE EXCEPTION 'reactivate_premium_stores: requiere Premium';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 0));
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL OR array_length(p_ids, 1) = 0 THEN
    RAISE EXCEPTION 'reactivate_premium_stores: elegí al menos una tienda';
  END IF;
  v_ids := p_ids;

  SELECT count(*) INTO v_count
  FROM public.stores
  WHERE id = ANY (v_ids)
    AND created_by = auth.uid()
    AND NOT is_active
    AND deactivated_reason = 'premium_expired';
  IF v_count <> array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'reactivate_premium_stores: alguna tienda no es tuya o no está pausada por plan';
  END IF;

  SELECT count(*) INTO v_active
  FROM public.stores
  WHERE created_by = auth.uid() AND is_active;
  IF v_active + array_length(v_ids, 1) > 3 THEN
    RAISE EXCEPTION 'reactivate_premium_stores: el tope es 3 tiendas activas';
  END IF;

  UPDATE public.stores
  SET is_active = true,
      deactivated_reason = NULL,
      deactivated_at = NULL
  WHERE id = ANY (v_ids) AND created_by = auth.uid();
END;
$$;

-- ============================================================================
-- 5. Job: si la gracia terminó sin elección, conservar la más antigua.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.job_scan_premium_downgrade() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  WITH candidates AS (
    SELECT s.id,
           row_number() OVER (
             PARTITION BY s.created_by
             ORDER BY s.created_at, s.id
           ) AS rn
    FROM public.stores s
    JOIN public.users u ON u.id = s.created_by
    JOIN public.roles r ON r.id = u.role_id
    WHERE s.is_active
      AND u.is_active
      AND r.name <> 'admin'
      AND NOT (u.premium AND (u.premium_until IS NULL OR u.premium_until > now()))
      AND (
        (u.premium_until IS NULL AND u.premium_grace_until IS NULL)
        OR COALESCE(u.premium_grace_until, u.premium_until + interval '7 days') <= now()
      )
  )
  UPDATE public.stores s
  SET is_active = false,
      deactivated_reason = 'premium_expired',
      deactivated_at = now()
  FROM candidates c
  WHERE s.id = c.id
    AND c.rn > 1
    -- No dejar al usuario sin ninguna tienda si otra pestaña ya eligió una
    -- (el job y choose_store_for_free_plan pueden competir).
    AND (SELECT count(*) FROM public.stores s2
         WHERE s2.created_by = s.created_by AND s2.is_active) > 1;
END;
$$;

-- ============================================================================
-- 6. Grants y cron.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.job_scan_premium_downgrade()
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.my_owned_stores(),
  public.choose_store_for_free_plan(bigint),
  public.reactivate_premium_stores(bigint[])
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.my_owned_stores(),
  public.choose_store_for_free_plan(bigint),
  public.reactivate_premium_stores(bigint[])
TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'farox_premium_downgrade') THEN
    PERFORM cron.unschedule('farox_premium_downgrade');
  END IF;
END $$;
SELECT cron.schedule('farox_premium_downgrade', '0 11 * * *',
  $$SELECT public.job_scan_premium_downgrade();$$);

-- ============================================================================
-- Verificación manual (SQL editor):
--   · Un operador free con 3 tiendas activas elige una ⇒ queda 1 activa,
--     2 con deactivated_reason='premium_expired'; stock/pedidos intactos.
--   · my_store_ids() ya no devuelve la tienda pausada; el operador no accede
--     a su stock/pedidos.
--   · Un Premium con 2 pausadas reactiva hasta 3; la cuarta ⇒ excepción.
--   · job_scan_premium_downgrade conserva la tienda más antigua y pausa el
--     resto solo cuando la gracia terminó.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   SELECT cron.unschedule('farox_premium_downgrade');
--   DROP FUNCTION IF EXISTS public.job_scan_premium_downgrade();
--   DROP FUNCTION IF EXISTS public.reactivate_premium_stores(bigint[]);
--   DROP FUNCTION IF EXISTS public.choose_store_for_free_plan(bigint);
--   DROP FUNCTION IF EXISTS public.my_owned_stores();
--   Restaurar my_store_ids() desde 0009 (sin join a stores).
--   ALTER TABLE public.stores
--     DROP COLUMN IF EXISTS deactivated_reason,
--     DROP COLUMN IF EXISTS deactivated_at;
