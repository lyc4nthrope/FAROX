-- Entity: order_items | Source: 0002_tables_reused.sql:L195-213 (tabla+índices), 0004_functions_triggers.sql:L458-461 (trg_updated_at), L1053-1073 (get_order_items), 0006_rls_grants.sql:L37 (RLS), L225-226 (sin policies), L373 (REVOKE SELECT), 0011_seguridad.sql:L547 (REVOKE SELECT anon) | Order: after orders, products

-- ============================================================================
-- order_items — líneas del pedido. unit_price CONGELADO en la línea (D40).
-- Escritura SOLO vía RPCs (create_order/confirm_delivery). LECTURA DENEGADA al
-- cliente (SELECT revocado): lee get_order_items() que oculta unit_price a
-- no-premium (D40). Sin policy RLS ⇒ deny-all total + REVOKE SELECT.
-- ============================================================================

-- CREATE TABLE — 0002_tables_reused.sql:196-208 (VERBATIM)
CREATE TABLE public.order_items (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- mod: NØSEE integer
  order_id           bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id         bigint NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity           numeric(12,3) NOT NULL CHECK (quantity > 0),      -- mod: integer sin CHECK → numeric(12,3) (B10: 2,5 kg era inexpressible)
  received_quantity  numeric(12,3) NULL CHECK (received_quantity IS NULL OR (received_quantity >= 0 AND received_quantity <= quantity)),  -- FAROX (p.11)
  status             public.order_item_status NOT NULL DEFAULT 'pending',  -- FAROX: estado por línea
  unit_price         numeric(12,2) NOT NULL CHECK (unit_price > 0),    -- FAROX: precio congelado en la línea (D40)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
  -- Eliminadas de NØSEE: assigned_store_id, assigned_price, substituted_with_product_id
  -- (status redefinido: varchar 'PENDING' → enum order_item_status)
);

-- Índices — 0002_tables_reused.sql:210-213 (VERBATIM)
-- Una línea por producto por pedido (evita duplicados por doble submit);
-- este unique CUBRE la FK order_id (§2.11 — NØSEE deja order_items sin índices FK).
CREATE UNIQUE INDEX uq_order_items_order_product ON public.order_items (order_id, product_id);
CREATE INDEX idx_order_items_product ON public.order_items (product_id);

-- Triggers — 0004_functions_triggers.sql:458-461 (VERBATIM). Solo updated_at.
-- Sin trg_audit_* : order_items NO está en el alcance D21 de 8 tablas auditadas.
DROP TRIGGER IF EXISTS trg_order_items_updated_at ON public.order_items;
CREATE TRIGGER trg_order_items_updated_at
BEFORE UPDATE ON public.order_items FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- RLS — 0006_rls_grants.sql
-- ENABLE (L37). SIN policies (L225-226 comentario VERBATIM): "order_items (§8 fila 8):
-- SIN policies — SELECT revocado (D40, unit_price solo premium vía get_order_items);
-- ENABLE RLS = deny-all total."
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
-- (Sin CREATE POLICY en esta tabla.)

-- GRANTs — deny-all de lectura (D40):
-- 0006_rls_grants.sql:351-357 (REVOKE DML, VERBATIM parcial): INSERT/UPDATE/DELETE a authenticated.
REVOKE INSERT, UPDATE, DELETE ON
  public.stock, public.movements, public.order_items, public.orders,
  public.credits, public.credit_payments, public.price_publications,
  public.alerts, public.routes, public.route_stops, public.user_stores,
  public.dashboard_daily, public.audit_log,
  public.chat_conversations, public.chat_messages
FROM authenticated;
-- 0006_rls_grants.sql:373 (VERBATIM): SELECT revocado a authenticated.
REVOKE SELECT ON public.user_stores, public.order_items FROM authenticated;
-- 0011_seguridad.sql:547 (VERBATIM): SELECT revocado también a anon.
REVOKE SELECT ON public.user_stores, public.order_items FROM anon;

-- ============================================================================
-- RPC de LECTURA (única vía de leer la tabla; omite unit_price a no-premium, D40)
-- get_order_items — 0004_functions_triggers.sql:1053-1073 (VERBATIM). Toca order_items
-- + orders (scope) + products (nombre). Definitiva en 0004 (0011 solo la GRANTEA).
CREATE OR REPLACE FUNCTION public.get_order_items(p_order bigint)
RETURNS TABLE (
  id                 bigint,
  product_id         bigint,
  product_name       text,
  quantity           numeric(12,3),
  received_quantity  numeric(12,3),
  status             public.order_item_status,
  unit_price         numeric(12,2)
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public $$
  SELECT oi.id, oi.product_id, p.name, oi.quantity, oi.received_quantity, oi.status,
         CASE WHEN public.is_premium() THEN oi.unit_price END  -- no-premium: sabe QUÉ y CUÁNTO, no el precio
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = p_order
    AND (public.my_role() = 'admin'
         OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order
                     AND (o.store_id = ANY (public.my_store_ids())
                          OR o.distributor_id = public.my_distributor_id())));
$$;
-- GRANT EXECUTE get_order_items(bigint) TO authenticated, service_role — 0011:499.
-- Escritura: create_order / confirm_delivery (multi-entidad) ⇒ ver NEGOCIO.
-- El CHECK received_quantity <= quantity de arriba hace inalcanzable el guard
-- R1.5 custom de confirm_delivery (ver 0010:25-29, review #445-1).
