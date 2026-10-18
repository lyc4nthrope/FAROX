-- Entity: routes | Source: 0001_extensions_enums.sql:L42-48 (enum route_status), 0003_tables_farox.sql:L57-71 (tabla+índices) + L285-287 (FK entrante desde orders), 0004_functions_triggers.sql:L473-476 (trg_updated_at), L1082-1122 (save_route), L1156-1181 (update_route_status), 0006_rls_grants.sql:L41 (RLS), L263-267 (policy base), L351-357 (REVOKE), 0009_negocio.sql:L537-546 (policy FINAL), 0011_seguridad.sql:L500,L502 (whitelist EXECUTE) | Order: after distributors

-- ============================================================================
-- routes — rutas diarias por distribuidor (§3.5). Escritura SOLO vía RPC
-- (save_route / update_route_status). Una ruta activa por distribuidor por día.
-- ============================================================================

-- CREATE TABLE — 0003_tables_farox.sql:58-65 (VERBATIM)
CREATE TABLE public.routes (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  distributor_id  bigint NOT NULL REFERENCES public.distributors(id) ON DELETE RESTRICT,
  route_date      date NOT NULL,
  status          public.route_status NOT NULL DEFAULT 'planned',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Índices — 0003_tables_farox.sql:67-71 (VERBATIM)
-- Una ruta activa por distribuidor por día; el predicado corrige el unique
-- incondicional que impedía crear la ruta de reemplazo tras cancelar (B8)
CREATE UNIQUE INDEX uq_routes_distributor_day
  ON public.routes (distributor_id, route_date) WHERE status <> 'cancelled';
CREATE INDEX idx_routes_route_date ON public.routes (route_date);  -- "rutas de hoy"

-- FK entrante — 0003_tables_farox.sql:285-287 (VERBATIM; la define orders:
-- detalle en 13_orders.sql — orders.route_id ON DELETE RESTRICT corrige el SET NULL)
ALTER TABLE public.orders
  ADD CONSTRAINT orders_route_id_fkey
  FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE RESTRICT;

-- Triggers — 0004_functions_triggers.sql:473-476 (VERBATIM). Solo updated_at.
-- Sin trg_audit_* : routes NO está en el alcance D21 de 8 tablas auditadas
-- (0004:498 — audit_diff SOLO en users, products, stores, distributors,
-- price_publications, orders, credits, credit_payments).
DROP TRIGGER IF EXISTS trg_routes_updated_at ON public.routes;
CREATE TRIGGER trg_routes_updated_at
BEFORE UPDATE ON public.routes FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- RLS — 0006_rls_grants.sql (ENABLE) + 0009_negocio.sql (policy FINAL)
-- Estado FINAL = 0009 (D-7): el operador pasa a ver solo rutas CON paradas en
-- sus tiendas; la policy de 0006 fue DROP + CREATE (reemplazada, ver abajo).
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

-- Policy FINAL — 0009_negocio.sql:537-546 (VERBATIM; reemplaza a 0006:263-267)
DROP POLICY IF EXISTS routes_select ON public.routes;
CREATE POLICY routes_select ON public.routes
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND EXISTS (SELECT 1 FROM public.route_stops rs
                         WHERE rs.route_id = routes.id
                           AND rs.store_id = ANY (public.my_store_ids())))
         OR (public.my_role() = 'distribuidor'
             AND distributor_id = public.my_distributor_id()));

-- Policy BASE (REEMPLAZADA por 0009) — 0006_rls_grants.sql:263-267 (histórica):
-- CREATE POLICY routes_select ON public.routes
--   FOR SELECT TO authenticated
--   USING (public.my_role() IN ('admin', 'operador')
--          OR (public.my_role() = 'distribuidor'
--              AND distributor_id = public.my_distributor_id()));
-- Sin policy INSERT/UPDATE/DELETE ⇒ escritura solo RPC.

-- GRANTs — 0006_rls_grants.sql:351-357 (REVOKE DML, VERBATIM parcial): INSERT/UPDATE/DELETE
-- revocados a authenticated (escritura solo RPC SECURITY DEFINER). SELECT NO se
-- revoca (queda la policy routes_select); no hay GRANT SELECT explícito para routes.
REVOKE INSERT, UPDATE, DELETE ON
  public.stock, public.movements, public.order_items, public.orders,
  public.credits, public.credit_payments, public.price_publications,
  public.alerts, public.routes, public.route_stops, public.user_stores,
  public.dashboard_daily, public.audit_log,
  public.chat_conversations, public.chat_messages
FROM authenticated;
-- GRANT EXECUTE save_route(bigint, date, jsonb) TO authenticated, service_role — 0011:500.
-- GRANT EXECUTE update_route_status(bigint, public.route_status) TO authenticated, service_role — 0011:502.
-- (0011:465-467 revoca TODO EXECUTE del schema y luego re-grantea la whitelist de 0011:480-512.)

-- ============================================================================
-- RPCs SOBRE ESTA TABLA (estado FINAL = última migración)
-- save_route — crea la ruta o reemplaza su listado completo de paradas.
-- Definitiva en 0004_functions_triggers.sql:1082-1122 (0011 NO la reescribe:
-- NULL-safe por diseño IF/ELSIF/ELSE-RAISE — ver encabezado 0011:15-17).
-- Toca routes + route_stops (las dos, de ESTE batch): si la ruta existe,
-- DELETE de route_stops previo; si no, INSERT de routes.
CREATE OR REPLACE FUNCTION public.save_route(
  p_distributor bigint, p_route_date date, p_stops jsonb DEFAULT '[]'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public $$
DECLARE
  v_role  text := public.my_role();
  v_route bigint;
  it      record;
BEGIN
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor' AND p_distributor = public.my_distributor_id() THEN
    NULL;  -- paradas propias
  ELSE
    RAISE EXCEPTION 'save_route: solo admin, o distribuidor sobre su propia ruta';
  END IF;
  IF p_route_date IS NULL THEN RAISE EXCEPTION 'save_route: route_date requerida'; END IF;
  SELECT id INTO v_route FROM public.routes
  WHERE distributor_id = p_distributor AND route_date = p_route_date AND status <> 'cancelled'
  FOR UPDATE;
  IF FOUND THEN
    DELETE FROM public.route_stops WHERE route_id = v_route;  -- reemplaza el listado completo
  ELSE
    INSERT INTO public.routes (distributor_id, route_date)
    VALUES (p_distributor, p_route_date)
    RETURNING id INTO v_route;
  END IF;
  FOR it IN
    SELECT x.store_id, x.stop_order, x.estimated_time
    FROM jsonb_to_recordset(COALESCE(p_stops, '[]'::jsonb))
      AS x(store_id bigint, stop_order smallint, estimated_time time)
  LOOP
    IF it.stop_order IS NULL OR it.stop_order <= 0 THEN
      RAISE EXCEPTION 'save_route: stop_order debe ser > 0';
    END IF;
    INSERT INTO public.route_stops (route_id, store_id, stop_order, estimated_time)
    VALUES (v_route, it.store_id, it.stop_order, it.estimated_time);
  END LOOP;
  RETURN v_route;
END;
$$;
-- GRANT EXECUTE save_route(bigint, date, jsonb) TO authenticated, service_role — 0011:500.

-- update_route_status — planned → active → completed/cancelled; distribuidor
-- solo completed de suya (A8). Definitiva en 0004_functions_triggers.sql:1156-1181
-- (0011 NO la reescribe — ver 0011:15-17). Toca SOLO routes.
CREATE OR REPLACE FUNCTION public.update_route_status(
  p_route bigint, p_status public.route_status
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public $$
DECLARE
  v_role text := public.my_role();
  r      public.routes%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.routes WHERE id = p_route FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ruta inexistente: %', p_route; END IF;
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor'
        AND r.distributor_id = public.my_distributor_id()
        AND r.status = 'active' AND p_status = 'completed' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'update_route_status: rol/estado no permitido (% → %)', r.status, p_status;
  END IF;
  IF NOT ((r.status = 'planned'   AND p_status IN ('active', 'cancelled')) OR
          (r.status = 'active'    AND p_status IN ('completed', 'cancelled'))) THEN
    RAISE EXCEPTION 'update_route_status: transición inválida % → %', r.status, p_status;
  END IF;
  UPDATE public.routes SET status = p_status WHERE id = p_route;
END;
$$;
-- GRANT EXECUTE update_route_status(bigint, public.route_status) TO authenticated, service_role — 0011:502.
-- mark_stop muta route_stops + lee routes ⇒ va en 18_route_stops.sql (misma alma).
