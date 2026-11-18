-- ============================================================================
-- FAROX — 20261118120000: fiado del distribuidor y entrega parcial (0058).
--
--   1. orders.has_shortage: marca persistente de que la entrega fue parcial
--      (alguna línea recibida < pedida). La mantiene un trigger sobre
--      order_items; el front la usa para mostrar “Parcial” en la lista y el
--      detalle, sin recalcular items en cada pedido.
--   2. create_credit: además de admin/operador, el distribuidor dueño del
--      pedido (acreedor) puede crear el fiado. El total sigue saliendo de
--      received_quantity (0054); las policies de lectura ya incluyen al
--      distribuidor desde 0054.
--
--   Re-ejecutable: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE +
--   DROP TRIGGER IF EXISTS + backfill idempotente.
--   Rollback: restaurar create_credit desde 0054, quitar el trigger y la columna.
-- ============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS has_shortage boolean NOT NULL DEFAULT false;

UPDATE public.orders o
SET has_shortage = EXISTS (
  SELECT 1
  FROM public.order_items oi
  WHERE oi.order_id = o.id
    AND oi.received_quantity IS NOT NULL
    AND oi.received_quantity < oi.quantity
)
WHERE o.status = 'delivered';

CREATE OR REPLACE FUNCTION public.internal_set_order_shortage()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.orders o
  SET has_shortage = EXISTS (
    SELECT 1
    FROM public.order_items oi
    WHERE oi.order_id = NEW.order_id
      AND oi.received_quantity IS NOT NULL
      AND oi.received_quantity < oi.quantity
  )
  WHERE o.id = NEW.order_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_items_shortage ON public.order_items;
CREATE TRIGGER trg_order_items_shortage
AFTER INSERT OR UPDATE OF received_quantity ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.internal_set_order_shortage();

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
  IF v_role NOT IN ('admin', 'operador', 'distribuidor') THEN
    RAISE EXCEPTION 'create_credit: solo admin/operador/distribuidor';
  END IF;
  -- FOR SHARE: el estado y las líneas no cambian entre la lectura y el INSERT.
  SELECT o.store_id, o.status INTO v_store, v_status
  FROM public.orders o WHERE o.id = p_order FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido inexistente: %', p_order; END IF;
  IF v_role = 'operador' AND NOT (v_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'create_credit: tienda fuera del alcance del operador';
  ELSIF v_role = 'distribuidor' AND NOT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = p_order AND o.distributor_id = public.my_distributor_id()
  ) THEN
    RAISE EXCEPTION 'create_credit: pedido fuera del alcance del distribuidor';
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
