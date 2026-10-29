-- ============================================================================
-- FAROX — 0028: ciclo de pedido reversible y cotización visible al operador.
--
--   1. update_order_status: además de pending → in_route, permite volver de
--      in_route → pending (revertir el despacho). No toca delivered/cancelled:
--      delivered sigue siendo responsabilidad de confirm_delivery (stock).
--   2. get_order_quotes: el operador de la tienda del pedido puede leer la
--      cotización del distribuidor aunque NO sea Premium. Es el precio que va a
--      pagar, no el precio privado de la tienda (D41); unit_price sigue oculto
--      en get_order_items para no-premium.
--
-- Reglas del repo: SECURITY DEFINER + SET search_path; alcance desde el JWT.
-- ============================================================================

-- ============================================================================
-- 1. update_order_status — base 0025 + reverso in_route → pending.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order bigint, p_status public.order_status, p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := public.my_role();
  o      public.orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido inexistente: %', p_order; END IF;
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor' AND o.distributor_id = public.my_distributor_id() THEN
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
    PERFORM public.internal_alert_resolve('order_late', NULL, NULL, p_order);
  ELSIF o.status = 'pending' AND p_status = 'in_route' THEN
    UPDATE public.orders SET status = p_status WHERE id = p_order;
  ELSIF o.status = 'in_route' AND p_status = 'pending' THEN
    -- 0028: revertir el despacho; el pedido vuelve a la cola del distribuidor.
    UPDATE public.orders SET status = 'pending' WHERE id = p_order;
  ELSE
    RAISE EXCEPTION 'transición inválida: % → %', o.status, p_status;
  END IF;
END;
$$;

-- ============================================================================
-- 2. get_order_quotes — operador de la tienda incluido, sin premium.
--    unit_price (precio privado de la tienda) NO se expone acá.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_order_quotes(p_order bigint)
RETURNS TABLE (product_id bigint, distributor_price numeric(12,2))
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT oi.product_id, oi.distributor_price
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.order_id = p_order
    AND (public.my_role() = 'admin'
         OR o.distributor_id = public.my_distributor_id()
         OR o.store_id = ANY (public.my_store_ids()));
$$;

-- ============================================================================
-- 3. Grants (mismas firmas; CREATE OR REPLACE conserva los previos)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.update_order_status(bigint, public.order_status, text),
  public.get_order_quotes(bigint)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.update_order_status(bigint, public.order_status, text),
  public.get_order_quotes(bigint)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · El distribuidor marca pending → in_route y luego in_route → pending.
--   · Un operador NO puede llamar update_order_status.
--   · Un operador no-premium de la tienda lee get_order_quotes con el precio
--     cotizado; sigue sin ver unit_price en get_order_items.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   Restaurar update_order_status desde 0025 y get_order_quotes desde 0024.
