-- Entity: dashboard_daily | Source: 0003_tables_farox.sql:L236-252 (tabla), 0004_functions_triggers.sql:L160-180 (internal_dashboard_upsert), L493-496 (trg_updated_at), L1389-1412 (get_dashboard base), 0006_rls_grants.sql:L50 (RLS), L334-345 (policy), L355 (REVOKE DML), L378 (GRANT SELECT), L409 (REVOKE EXECUTE internal_*), 0007_realtime_jobs.sql:L43-47+L50-54 (realtime), 0010_perf.sql:L317-357 (get_dashboard FINAL), 0011_seguridad.sql:L509 (whitelist get_dashboard) | Order: after distributors (sin FK: distributor_id 0 = sin pedido)

-- ============================================================================
-- dashboard_daily — agregado INT-01 (TABLA, no vista — D20). Escritura SOLO el
-- upsert interno de register_entry/register_exit/confirm_delivery/register_reverse
-- (§3.13); lectura vía get_dashboard() + policy dashboard_read. Realtime
-- publicado (0007) — solo alerts y dashboard_daily.
-- ============================================================================

-- CREATE TABLE — 0003_tables_farox.sql:237-252 (VERBATIM)
CREATE TABLE public.dashboard_daily (
  day             date NOT NULL,
  -- 0 = movimientos sin pedido/distribuidor (NO NULL: el unique no cubriría NULLs
  -- y cada fila manual crearía una entrada nueva)
  distributor_id  bigint NOT NULL DEFAULT 0,
  entries_count   integer NOT NULL DEFAULT 0,   -- CONTEOS, no sumas de quantity (kg+unidades ≠ número con significado)
  exits_count     integer NOT NULL DEFAULT 0,
  entries_value   numeric(14,2) NOT NULL DEFAULT 0,  -- quantity × movements.unit_price
  exits_value     numeric(14,2) NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- PK = el UNIQUE (day, distributor_id) del doc + replica identity que
  -- supabase_realtime exige para emitir UPDATE de la fila (§3.13/§5).
  PRIMARY KEY (day, distributor_id)
);
-- 0003_tables_farox.sql:251-252 (VERBATIM):
-- -- Escritura SOLO vía upsert interno de register_entry/register_exit (§3.13);
-- -- lectura vía get_dashboard() + policy dashboard_read (SELECT concedido en 0006).

-- Índices — NINGUNO (solo la PK compuesta; la tabla es ~50 filas con rango 30d).

-- Triggers — 0004_functions_triggers.sql:493-496 (VERBATIM): solo updated_at.
-- Sin trg_audit_* : dashboard_daily NO está en el alcance D21 (0004:498).
DROP TRIGGER IF EXISTS trg_dashboard_daily_updated_at ON public.dashboard_daily;
CREATE TRIGGER trg_dashboard_daily_updated_at
BEFORE UPDATE ON public.dashboard_daily FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- Realtime — 0007_realtime_jobs.sql:43-47 (VERBATIM, trozo del DO $$):
--   IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables
--                  WHERE pubname = 'supabase_realtime'
--                    AND schemaname = 'public' AND tablename = 'dashboard_daily') THEN
--     EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.dashboard_daily';
--   END IF;
-- 0007:50-54 (VERBATIM): "realtime UPDATE sobre dashboard_daily (§3.13): el PK
-- (day, distributor_id) ya funciona como identidad por defecto; el front solo
-- necesita la fila nueva del agregado."

-- ============================================================================
-- RLS — 0006_rls_grants.sql:50 + 334-345 (VERBATIM): policy dashboard_read —
-- copia literal del doc. is_premium() gate (analítica = premium); operador ve el
-- agregado GLOBAL en MVP (A3); distribuidor solo su distributor_id (fila 0 no le
-- corresponde). Realtime exige SELECT+RLS (D32).
ALTER TABLE public.dashboard_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY dashboard_read ON public.dashboard_daily
  FOR SELECT TO authenticated
  USING (public.is_premium()
         AND (public.my_role() = 'admin'
              OR public.my_role() = 'operador'
              OR distributor_id = public.my_distributor_id()));

-- GRANTs — 0006_rls_grants.sql:351-357 (REVOKE DML, VERBATIM parcial) + :378 (GRANT SELECT)
REVOKE INSERT, UPDATE, DELETE ON
  public.stock, public.movements, public.order_items, public.orders,
  public.credits, public.credit_payments, public.price_publications,
  public.alerts, public.routes, public.route_stops, public.user_stores,
  public.dashboard_daily, public.audit_log,
  public.chat_conversations, public.chat_messages
FROM authenticated;
-- D38/D32: estas dos NO se revocan; se GRANTEAN SELECT con su policy
-- (audit_log: admin la lee; dashboard_daily: realtime exige SELECT+RLS, D32).
GRANT SELECT ON public.dashboard_daily TO authenticated;
-- REVOKE EXECUTE public.internal_dashboard_upsert(bigint, integer, integer, numeric, numeric) FROM authenticated — 0006:409.
-- GRANT EXECUTE get_dashboard(date, date) TO authenticated, service_role — 0011:509.

-- ============================================================================
-- RPCs SOBRE ESTA TABLA (estado FINAL = última migración)
-- internal_dashboard_upsert — upsert O(1) del agregado INT-01 (D20), deltas con
-- clampa en 0. 0004_functions_triggers.sql:160-180 (VERBATIM; nunca redefinida).
-- La llaman register_entry/exit, confirm_delivery y register_reverse ⇒ MULTI-ENTIDAD (ver NEGOCIO).
CREATE OR REPLACE FUNCTION public.internal_dashboard_upsert(
  p_distributor_id bigint,
  p_entries_count  integer,
  p_exits_count    integer,
  p_entries_value  numeric,
  p_exits_value    numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public $$
BEGIN
  INSERT INTO public.dashboard_daily AS d (day, distributor_id, entries_count, exits_count, entries_value, exits_value)
  VALUES (CURRENT_DATE, COALESCE(p_distributor_id, 0), p_entries_count, p_exits_count, p_entries_value, p_exits_value)
  ON CONFLICT (day, distributor_id) DO UPDATE SET
    entries_count = GREATEST(d.entries_count + EXCLUDED.entries_count, 0),
    exits_count   = GREATEST(d.exits_count   + EXCLUDED.exits_count,   0),
    entries_value = GREATEST(d.entries_value + EXCLUDED.entries_value, 0),
    exits_value   = GREATEST(d.exits_value   + EXCLUDED.exits_value,   0),
    updated_at    = now();
END;
$$;
-- REVOKE EXECUTE … FROM authenticated — 0006:409.

-- get_dashboard — Versión FINAL en 0010_perf.sql:328-357 (R11: RAISE si rango
-- > 366 días; LANGUAGE sql → plpgsql, MISMA firma/OUT/atributos — el reemplazo
-- conserva el OID ⇒ los grants de 0006 siguen vigentes, ver 0010:317-327).
-- Supera a 0004:1392-1412. NOTA VERIFICADA: get_dashboard LEE SOLO
-- dashboard_daily (0004:1405 y 0010:349: FROM public.dashboard_daily d) — NO
-- toca orders/credits/credit_payments/order_items/movements/alerts.
CREATE OR REPLACE FUNCTION public.get_dashboard(
  p_from date DEFAULT CURRENT_DATE - 30, p_to date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  day             date,
  distributor_id  bigint,
  entries_count   integer,
  exits_count     integer,
  entries_value   numeric(14,2),
  exits_value     numeric(14,2)
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public $$
DECLARE
  v_from date := COALESCE(p_from, CURRENT_DATE - 30);  -- R11: mismos defaults que el WHERE original
  v_to   date := COALESCE(p_to, CURRENT_DATE);
BEGIN
  IF v_to - v_from > 366 THEN  -- R11 / AC 11.2
    RAISE EXCEPTION 'get_dashboard: rango de % días excede el máximo de 366', v_to - v_from;
  END IF;
  RETURN QUERY
  SELECT d.day, d.distributor_id, d.entries_count, d.exits_count, d.entries_value, d.exits_value
  FROM public.dashboard_daily d
  WHERE d.day BETWEEN v_from AND v_to
    AND public.is_premium()  -- gate premium por fila-función (evalúa 1 vez)
    AND (public.my_role() = 'admin'
         OR public.my_role() = 'operador'            -- A3: agregado global en MVP
         OR d.distributor_id = public.my_distributor_id())
  ORDER BY d.day;
END;
$$;
-- GRANT EXECUTE get_dashboard(date, date) TO authenticated, service_role — 0011:509.
