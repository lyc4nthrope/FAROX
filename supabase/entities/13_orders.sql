-- Entity: orders | Source: 0002_tables_reused.sql:L168-192 (tabla+índices), 0003_tables_farox.sql:L280-287 (FKs diferidas distributor_id/route_id), 0004_functions_triggers.sql:L253-259 (touch), L266-294 (audit_diff), L453-456 (trg_updated_at), L524-527 (trg_audit), L935-972 (update_order_status), 0006_rls_grants.sql:L36 (RLS), L217-223 (policy), L351-357 (REVOKE), 0010_perf.sql:L374-376 (idx_orders_expected_open) | Order: after stores, users, distributors, routes, audit_log

-- ============================================================================
-- orders — pedidos (nombre NØSEE, semántica FAROX D9). Escriben solo RPCs
-- (create_order/confirm_delivery/update_order_status). Cierre alerta order_late.
-- ============================================================================

-- CREATE TABLE — 0002_tables_reused.sql:169-189 (VERBATIM)
CREATE TABLE public.orders (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- mod: NØSEE integer
  distributor_id    bigint NOT NULL,                    -- FK → distributors agregada en 0003
  store_id          bigint NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  status            public.order_status NOT NULL DEFAULT 'pending',  -- mod: varchar sin CHECK → enum (D2)
  route_id          bigint NULL,                        -- FK → routes agregada en 0003 (ON DELETE RESTRICT)
  created_by        uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  expected_at       timestamptz NULL,                   -- fecha prometida/SLA (alerta order_late, crítica B1)
  delivered_at      timestamptz NULL,
  notes             text NULL,
  cancelled_at      timestamptz NULL,
  cancelled_reason  text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Un pedido no puede estar "entregado sin fecha" ni "con fecha sin entregarse"
  CONSTRAINT orders_delivered_requires_at CHECK (status <> 'delivered' OR delivered_at IS NOT NULL),
  CONSTRAINT orders_delivered_only_with_at CHECK (delivered_at IS NULL OR status = 'delivered'),
  CONSTRAINT orders_cancelled_requires_at  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
  -- Eliminadas de NØSEE: ~35 columnas de flujo delivery/dealer (delivery_*, total_*,
  -- payment_*, jsonb stores/items/checked_items, pin, compromiso_*, dealer_*, etc.)
);

-- Índices — 0002_tables_reused.sql:191-192 (VERBATIM)
CREATE INDEX idx_orders_distributor_status ON public.orders (distributor_id, status);
CREATE INDEX idx_orders_store_created      ON public.orders (store_id, created_at DESC);

-- FKs diferidas (distributors/routes se crean en 0003) — 0003_tables_farox.sql:280-287 (VERBATIM)
ALTER TABLE public.orders
  ADD CONSTRAINT orders_distributor_id_fkey
  FOREIGN KEY (distributor_id) REFERENCES public.distributors(id) ON DELETE RESTRICT;

-- RESTRICT corrige el SET NULL que desenganchaba pedidos in_route de su ruta en silencio
ALTER TABLE public.orders
  ADD CONSTRAINT orders_route_id_fkey
  FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE RESTRICT;

-- Índice job order_late — 0010_perf.sql:374-376 (VERBATIM)
CREATE INDEX IF NOT EXISTS idx_orders_expected_open
  ON public.orders (expected_at)
  WHERE expected_at IS NOT NULL AND status NOT IN ('delivered', 'cancelled');

-- Triggers — 0004_functions_triggers.sql:453-456, 524-527 (VERBATIM)
DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON public.orders FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_audit_orders ON public.orders;
CREATE TRIGGER trg_audit_orders
AFTER INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();

-- ============================================================================
-- RLS — 0006_rls_grants.sql
-- ENABLE (L36). Policy (L217-223, VERBATIM): SELECT con scope (admin · operador
-- sus tiendas · distribuidor las suyas). Sin policy INSERT/UPDATE/DELETE ⇒ solo RPC.
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select ON public.orders
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids()))
         OR (public.my_role() = 'distribuidor'
             AND distributor_id = public.my_distributor_id()));

-- GRANTs — 0006_rls_grants.sql:351-357 (REVOKE DML, VERBATIM parcial): INSERT/UPDATE/DELETE
-- revocados a authenticated. SELECT no se revoca (queda la policy orders_select).
REVOKE INSERT, UPDATE, DELETE ON
  public.stock, public.movements, public.order_items, public.orders,
  public.credits, public.credit_payments, public.price_publications,
  public.alerts, public.routes, public.route_stops, public.user_stores,
  public.dashboard_daily, public.audit_log,
  public.chat_conversations, public.chat_messages
FROM authenticated;

-- ============================================================================
-- RPCs SOBRE ESTA TABLA (estado FINAL = última migración)
-- update_order_status — transiciones pending→in_route; cancelled solo admin (A7).
-- Definitiva en 0004_functions_triggers.sql:935-972 (0011 NO la reescribe; D-4 la
-- declara NULL-safe por diseño IF/ELSIF/ELSE-RAISE). Toca SOLO orders.
CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order bigint, p_status public.order_status, p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public $$
DECLARE
  v_role text := public.my_role();
  o      public.orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido inexistente: %', p_order; END IF;
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'operador' AND (o.store_id = ANY (public.my_store_ids())) THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'update_order_status: sin alcance sobre el pedido %', p_order;
  END IF;
  IF p_status = 'delivered' THEN
    RAISE EXCEPTION 'delivered solo se registra con confirm_delivery()';
  END IF;
  IF p_status = 'cancelled' THEN
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'A7: cancelar pedido es solo admin';
    END IF;
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
      RAISE EXCEPTION 'cancelar exige reason';
    END IF;
    UPDATE public.orders
    SET status = 'cancelled', cancelled_at = now(), cancelled_reason = p_reason
    WHERE id = p_order;
    PERFORM public.internal_alert_resolve('order_late', NULL, NULL, p_order);  -- A6
  ELSIF o.status = 'pending' AND p_status = 'in_route' THEN
    UPDATE public.orders SET status = p_status WHERE id = p_order;
  ELSE
    RAISE EXCEPTION 'transición inválida: % → %', o.status, p_status;
  END IF;
END;
$$;
-- GRANT EXECUTE update_order_status(bigint, public.order_status, text) TO authenticated, service_role — 0011:497.
-- NOTA: create_order / confirm_delivery son MULTI-ENTIDAD (orders+order_items+stock+
-- movements) ⇒ listados en NEGOCIO, no acá. Su versión final es 0010_perf.sql:187 / :58.
