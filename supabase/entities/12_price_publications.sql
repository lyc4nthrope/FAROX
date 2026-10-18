-- Entity: price_publications | Source: 0002_tables_reused.sql:L144-166 (tabla+índices), 0004_functions_triggers.sql:L253-259 (touch_updated_at), L298-306 (prevent_price_update), L266-294 (audit_diff), L443-451 (trg_updated_at+trg_prevent_price), L519-522 (trg_audit), 0006_rls_grants.sql:L35 (RLS), L182-189 (policies), L351-357 (REVOKE), 0016000011_seguridad.sql:L163-187 (set_price final) | Order: after stores, products, users, roles (helpers), audit_log (audit_diff escribe)

-- ============================================================================
-- price_publications — catálogo de precios PRIVADO por tienda (D41/D27).
-- 1 fila activa por Producto↔Tienda (uq_price_store_product_active). Histórico
-- de precios: precio solo cambia vía set_price() (M2). Actor = created_by (D4).
-- ============================================================================

-- CREATE TABLE — 0002_tables_reused.sql:145-157 (VERBATIM)
CREATE TABLE public.price_publications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  bigint NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  store_id    bigint NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,   -- mod: era uuid; RESTRICT en vez de CASCADE (D14)
  created_by  uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,      -- mod: era user_id; actor = created_by (D4); solo escribe set_price()
  price       numeric(12,2) NOT NULL CHECK (price > 0),    -- 0 prohibido (D27); NØSEE ya tenía el CHECK
  currency    char(3) NOT NULL DEFAULT 'COP',              -- FAROX: divisa explícita (D26)
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),          -- mod: era timestamp sin TZ; es el effective_at (D3)
  updated_at  timestamptz NOT NULL DEFAULT now()
  -- Eliminadas de NØSEE: photo_url, description, confidence_score, validated_count,
  -- downvoted_count, active_reports_count, comments_count, is_admin_hidden + 6 hidden_*
);

-- Índices — 0002_tables_reused.sql:159-166 (VERBATIM)
-- Impone en BD "1 fila activa por Producto↔Tienda" (D17). El ON CONFLICT de
-- set_price() debe usar carácter a carácter el mismo target/predicado.
CREATE UNIQUE INDEX uq_price_store_product_active
  ON public.price_publications (store_id, product_id) WHERE is_active;

-- Histórico de precios de un producto
CREATE INDEX idx_price_product_created
  ON public.price_publications (product_id, created_at DESC);

-- Triggers — 0004_functions_triggers.sql:443-451, 519-522 (VERBATIM)
-- (a) updated_at automático (touch_updated_at, definida 0004:253-259)
DROP TRIGGER IF EXISTS trg_price_publications_updated_at ON public.price_publications;
CREATE TRIGGER trg_price_publications_updated_at
BEFORE UPDATE ON public.price_publications FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- (b) precio solo vía set_price(): rechaza UPDATE de price sobre fila activa (M2/D27)
DROP TRIGGER IF EXISTS trg_prevent_price_update ON public.price_publications;
CREATE TRIGGER trg_prevent_price_update
BEFORE UPDATE OF price ON public.price_publications FOR EACH ROW
EXECUTE FUNCTION public.prevent_price_update();

-- (c) auditoría (audit_diff, alcance D21 de 8 tablas; audit_diff definida 0004:266-294)
DROP TRIGGER IF EXISTS trg_audit_price_publications ON public.price_publications;
CREATE TRIGGER trg_audit_price_publications
AFTER INSERT OR UPDATE OR DELETE ON public.price_publications FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();

-- ============================================================================
-- RLS — 0006_rls_grants.sql
-- ENABLE (L35): ALTER TABLE ... ENABLE ROW LEVEL SECURITY
-- Policies (L182-189, VERBATIM): SELECT con scope; DELETE admin soft. Sin policy
-- INSERT/UPDATE ⇒ solo set_price() (REVOKE abajo, D27).
ALTER TABLE public.price_publications ENABLE ROW LEVEL SECURITY;

CREATE POLICY price_publications_select ON public.price_publications
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids())));
CREATE POLICY price_publications_delete ON public.price_publications
  FOR DELETE TO authenticated
  USING (public.my_role() = 'admin' AND is_active = false);

-- GRANTs — 0006_rls_grants.sql:351-357 (REVOKE DML mutables por RPC/trigger, VERBATIM
-- parcial a price_publications): INSERT/UPDATE/DELETE revocados a authenticated.
REVOKE INSERT, UPDATE, DELETE ON
  public.stock, public.movements, public.order_items, public.orders,
  public.credits, public.credit_payments, public.price_publications,
  public.alerts, public.routes, public.route_stops, public.user_stores,
  public.dashboard_daily, public.audit_log,
  public.chat_conversations, public.chat_messages
FROM authenticated;
-- SELECT no se revoca (queda la policy price_publications_select). Sin GRANT por
-- columna en esta tabla. 0011 (D-5/L545) revoca ALL a anon sobre todas las tablas.

-- ============================================================================
-- RPC final sobre esta tabla (estado = última migración que la define)
-- set_price — ÚNICA mutación (D17/D27). Versión FINAL en 0011_seguridad.sql:163-187
-- (guard = assert_admin(); supera a 0004:697-723). Lectura del precio activo también
-- en register_entry/exit y create_order — ver NEGOCIO (multi-entidad, NO acá).
CREATE OR REPLACE FUNCTION public.set_price(
  p_product bigint, p_store bigint, p_price numeric(12,2), p_currency char(3) DEFAULT 'COP'
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public $$
DECLARE
  v_prev bigint;
  v_id   bigint;
BEGIN
  PERFORM public.assert_admin();  -- D-4
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'set_price: price debe ser > 0 (D27)';
  END IF;
  SELECT id INTO v_prev
  FROM public.price_publications
  WHERE product_id = p_product AND store_id = p_store AND is_active
  FOR UPDATE;  -- lock de la fila activa previa
  IF FOUND THEN
    UPDATE public.price_publications SET is_active = false WHERE id = v_prev;  -- permitido: solo apagar is_active
  END IF;
  INSERT INTO public.price_publications (product_id, store_id, created_by, price, currency)
  VALUES (p_product, p_store, auth.uid(), p_price, COALESCE(p_currency, 'COP'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
-- GRANT EXECUTE set_price(bigint, bigint, numeric(12,2), char(3)) TO authenticated, service_role — 0011:492.
