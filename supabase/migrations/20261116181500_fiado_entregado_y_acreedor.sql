-- ============================================================================
-- FAROX — 20261116181500: fiado por lo entregado y visible para el acreedor (0054).
--
--   1. create_credit: el total sale de lo RECIBIDO (received_quantity), no de lo
--      pedido (quantity). Antes, una entrega parcial generaba una deuda por el
--      pedido completo. Además exige que el pedido esté 'delivered': la función
--      aceptaba cualquier estado y el único freno era la pantalla.
--   2. credits_select / credit_payments_select: el distribuidor del pedido (el
--      acreedor) puede LEER el fiado y sus pagos. Sigue sin poder escribir:
--      register_payment y create_credit no cambian su control de rol.
--
--   Re-ejecutable: CREATE OR REPLACE + DROP POLICY IF EXISTS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. create_credit: estado entregado y total por lo recibido.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_credit(
  p_order bigint, p_due_date date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role   text := COALESCE(public.my_role(), '');
  v_total  numeric(14,2);
  v_store  bigint;
  v_status public.order_status;
  v_id     bigint;
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'create_credit: solo admin/operador';
  END IF;
  -- FOR SHARE: el estado y las líneas no cambian entre la lectura y el INSERT.
  SELECT o.store_id, o.status INTO v_store, v_status
  FROM public.orders o WHERE o.id = p_order FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido inexistente: %', p_order; END IF;
  IF v_role = 'operador' AND NOT (v_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'create_credit: tienda fuera del alcance del operador';
  END IF;
  IF v_status <> 'delivered' THEN
    RAISE EXCEPTION 'create_credit: el pedido % no está entregado (estado "%")', p_order, v_status;
  END IF;
  -- Una línea sin received_quantity no se entregó: cuenta como 0.
  SELECT COALESCE(sum(COALESCE(oi.distributor_price, oi.unit_price)
                      * COALESCE(oi.received_quantity, 0)), 0)
  INTO v_total
  FROM public.order_items oi WHERE oi.order_id = p_order;
  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'pedido sin líneas entregadas con monto > 0';
  END IF;
  IF EXISTS (SELECT 1 FROM public.credits c WHERE c.order_id = p_order AND c.status <> 'cancelled') THEN
    RAISE EXCEPTION 'el pedido % ya tiene un crédito vigente (D15)', p_order;
  END IF;
  INSERT INTO public.credits (order_id, store_id, total_amount, balance, due_date, created_by)
  VALUES (p_order, v_store, v_total, v_total, p_due_date, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. El distribuidor acreedor lee el fiado de sus pedidos y sus pagos.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS credits_select ON public.credits;
CREATE POLICY credits_select ON public.credits
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids()))
         OR (public.my_role() = 'distribuidor'
             AND EXISTS (SELECT 1 FROM public.orders o
                         WHERE o.id = credits.order_id
                           AND o.distributor_id = public.my_distributor_id())));

DROP POLICY IF EXISTS credit_payments_select ON public.credit_payments;
CREATE POLICY credit_payments_select ON public.credit_payments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.credits c
                 WHERE c.id = credit_payments.credit_id
                   AND (public.my_role() = 'admin'
                        OR (public.my_role() = 'operador'
                            AND c.store_id = ANY (public.my_store_ids()))
                        OR (public.my_role() = 'distribuidor'
                            AND EXISTS (SELECT 1 FROM public.orders o
                                        WHERE o.id = c.order_id
                                          AND o.distributor_id = public.my_distributor_id())))));

-- ----------------------------------------------------------------------------
-- Rollback (manual): restaurar create_credit desde
-- 20261026000024_solicitudes_sin_precio_y_cotizacion.sql y las dos policies
-- desde 20261016000009_negocio.sql (líneas 517-533).
-- ----------------------------------------------------------------------------
