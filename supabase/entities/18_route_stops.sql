-- Entity: route_stops | Source: 0001_extensions_enums.sql:L50-56 (enum stop_status), 0003_tables_farox.sql:L73-86 (tabla+índice), 0004_functions_triggers.sql:L250-252 (sin trigger: sin updated_at), L1125-1153 (mark_stop base), 0006_rls_grants.sql:L42 (RLS), L269-275 (policy base), L351-357 (REVOKE), 0009_negocio.sql:L549-558 (policy FINAL), 0011_seguridad.sql:L388-419 (mark_stop FINAL), L501 (whitelist) | Order: after routes, stores

-- ============================================================================
-- route_stops — paradas de la ruta (orden para Google Maps). Coordenadas NO se
-- duplican: viven en stores.location. Escritura SOLO vía RPC (save_route en
-- 17_routes.sql / mark_stop abajo).
-- ============================================================================

-- CREATE TABLE — 0003_tables_farox.sql:74-83 (VERBATIM)
CREATE TABLE public.route_stops (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route_id        bigint NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  store_id        bigint NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,  -- coords viven en stores.location (no duplicar)
  stop_order      smallint NOT NULL CHECK (stop_order > 0),   -- orden para Google Maps
  estimated_time  time NULL,
  status          public.stop_status NOT NULL DEFAULT 'pending',
  arrived_at      timestamptz NULL,   -- marca real de visita
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Índice — 0003_tables_farox.sql:85-86 (VERBATIM)
-- El unique ya indexa route_id (no añadir índice FK separado)
CREATE UNIQUE INDEX uq_route_stops_route_order ON public.route_stops (route_id, stop_order);

-- Triggers — NINGUNO. Sin updated_at ⇒ no aplica touch_updated_at
-- (0004_functions_triggers.sql:250-252, VERBATIM como comentario):
-- -- BEFORE UPDATE de todas las tablas mutables con updated_at.
-- -- (No aplica a append-only: movements, credit_payments, audit_log, chat_messages,
-- --  y a tablas sin updated_at: motives, route_stops, alerts, user_stores.)
-- Tampoco trg_audit_* : route_stops NO está en el alcance D21 (0004:498).

-- ============================================================================
-- RLS — 0006_rls_grants.sql (ENABLE) + 0009_negocio.sql (policy FINAL)
-- Estado FINAL = 0009 (D-7): operador solo paradas de SUS tiendas; la policy
-- de 0006 fue DROP + CREATE (reemplazada, ver abajo).
ALTER TABLE public.route_stops ENABLE ROW LEVEL SECURITY;

-- Policy FINAL — 0009_negocio.sql:549-558 (VERBATIM; reemplaza a 0006:269-275)
DROP POLICY IF EXISTS route_stops_select ON public.route_stops;
CREATE POLICY route_stops_select ON public.route_stops
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids()))
         OR (public.my_role() = 'distribuidor'
             AND EXISTS (SELECT 1 FROM public.routes r
                         WHERE r.id = route_stops.route_id
                           AND r.distributor_id = public.my_distributor_id())));

-- Policy BASE (REEMPLAZADA por 0009) — 0006_rls_grants.sql:269-275 (histórica):
-- CREATE POLICY route_stops_select ON public.route_stops
--   FOR SELECT TO authenticated
--   USING (public.my_role() IN ('admin', 'operador')
--          OR (public.my_role() = 'distribuidor' AND EXISTS (
--               SELECT 1 FROM public.routes r
--               WHERE r.id = route_stops.route_id
--                 AND r.distributor_id = public.my_distributor_id())));
-- Sin policy INSERT/UPDATE/DELETE ⇒ escritura solo RPC (0006:260-261).

-- GRANTs — 0006_rls_grants.sql:351-357 (REVOKE DML, VERBATIM parcial): INSERT/UPDATE/DELETE
-- revocados a authenticated (escritura solo RPC SECURITY DEFINER). SELECT NO se
-- revoca (queda la policy route_stops_select); no hay GRANT SELECT explícito.
REVOKE INSERT, UPDATE, DELETE ON
  public.stock, public.movements, public.order_items, public.orders,
  public.credits, public.credit_payments, public.price_publications,
  public.alerts, public.routes, public.route_stops, public.user_stores,
  public.dashboard_daily, public.audit_log,
  public.chat_conversations, public.chat_messages
FROM authenticated;
-- GRANT EXECUTE mark_stop(bigint, public.stop_status, timestamptz) TO authenticated, service_role — 0011:501.

-- ============================================================================
-- RPCs SOBRE ESTA TABLA (estado FINAL = última migración)
-- mark_stop — transiciones de parada + arrived_at. Versión FINAL en
-- 0011_seguridad.sql:388-419 (reestructura el guard a IF/ELSIF/ELSE-RAISE:
-- el guard compound de 0004:1125-1153 era NULL-bypass — ver 0011:383-387).
-- Toca route_stops + routes (ambas de ESTE batch).
CREATE OR REPLACE FUNCTION public.mark_stop(
  p_stop bigint, p_status public.stop_status, p_arrived timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public $$
DECLARE
  v_role text := public.my_role();
  s      public.route_stops%ROWTYPE;
BEGIN
  SELECT rs.* INTO s
  FROM public.route_stops rs
  JOIN public.routes r ON r.id = rs.route_id
  WHERE rs.id = p_stop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'parada inexistente: %', p_stop; END IF;
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor'
        AND s.route_id IN (SELECT r.id FROM public.routes r
                            WHERE r.distributor_id = public.my_distributor_id()) THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'mark_stop: sin alcance sobre la parada %', p_stop;
  END IF;
  IF s.status NOT IN ('pending', 'arrived') AND p_status <> s.status THEN
    RAISE EXCEPTION 'mark_stop: transición inválida % → %', s.status, p_status;
  END IF;
  UPDATE public.route_stops
  SET status = p_status,
      arrived_at = CASE WHEN p_status = 'arrived' AND arrived_at IS NULL THEN COALESCE(p_arrived, now())
                        ELSE arrived_at END
  WHERE id = p_stop;
END;
$$;
-- GRANT EXECUTE mark_stop(bigint, public.stop_status, timestamptz) TO authenticated, service_role — 0011:501.
-- save_route (INSERT/DELETE masivo de paradas) ⇒ va en 17_routes.sql.
