-- ============================================================================
-- Prueba 0060: integridad de entregas e inventario.
-- Correr con scripts/db-test.sh. Todo se revierte.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;
\ir _fixtures.sql

-- Catálogo del distribuidor 990001 con stock inicial.
INSERT INTO public.distributor_products
  (distributor_id, product_id, created_by, quantity)
VALUES
  (990001, 990001, '00000000-0000-0000-0000-000000990003', 10),
  (990001, 990002, '00000000-0000-0000-0000-000000990003', 10);

-- Pedido 1: entrega completa de 5 arroces.
INSERT INTO public.orders (id, distributor_id, store_id, created_by, status)
OVERRIDING SYSTEM VALUE
VALUES (990001, 990001, 990001, '00000000-0000-0000-0000-000000990002', 'in_route');
INSERT INTO public.order_items (order_id, product_id, quantity, status, unit_price)
VALUES (990001, 990001, 5, 'pending', 1000);

DO $$
DECLARE v_movement bigint; v_dist numeric; v_store numeric; v_short boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirm_delivery(990001, '[{"product_id":990001,"received_quantity":5}]'::jsonb);
  RESET ROLE;

  SELECT quantity INTO v_dist FROM public.distributor_products
  WHERE distributor_id = 990001 AND product_id = 990001;
  SELECT quantity INTO v_store FROM public.stock
  WHERE store_id = 990001 AND product_id = 990001;
  SELECT has_shortage INTO v_short FROM public.orders WHERE id = 990001;
  SELECT id INTO v_movement FROM public.movements
  WHERE order_id = 990001 AND product_id = 990001 LIMIT 1;

  ASSERT v_dist = 5, format('T1: stock distribuidor esperado 5, quedó %s', v_dist);
  ASSERT v_store = 5, format('T1: stock tienda esperado 5, quedó %s', v_store);
  ASSERT v_short IS FALSE, 'T1: pedido completo marcado como parcial';
  ASSERT v_movement IS NOT NULL, 'T1: no se creó el movimiento de entrada';
  ASSERT (SELECT decrements_distributor_stock FROM public.movements WHERE id = v_movement),
         'T1: movimiento sin marca de descuento del distribuidor';
  RAISE NOTICE 'PASS T1 la entrega descuenta el stock del distribuidor';
END $$;

-- Pedido 2: se omite una línea del payload; debe quedar como parcial.
INSERT INTO public.orders (id, distributor_id, store_id, created_by, status)
OVERRIDING SYSTEM VALUE
VALUES (990002, 990001, 990001, '00000000-0000-0000-0000-000000990002', 'in_route');
INSERT INTO public.order_items (order_id, product_id, quantity, status, unit_price)
VALUES (990002, 990001, 2, 'pending', 1000),
       (990002, 990002, 3, 'pending', 2000);

DO $$
DECLARE v_short boolean; v_rq numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirm_delivery(990002, '[{"product_id":990001,"received_quantity":2}]'::jsonb);
  RESET ROLE;

  SELECT has_shortage INTO v_short FROM public.orders WHERE id = 990002;
  SELECT received_quantity INTO v_rq FROM public.order_items
  WHERE order_id = 990002 AND product_id = 990002;
  ASSERT v_short IS TRUE, 'T2: una línea omitida no marcó la entrega como parcial';
  ASSERT v_rq IS NULL, 'T2: la línea omitida no quedó NULL';
  RAISE NOTICE 'PASS T2 una línea omitida cuenta como no entregada';
END $$;

-- Pedido 3: sin stock suficiente en el distribuidor.
INSERT INTO public.orders (id, distributor_id, store_id, created_by, status)
OVERRIDING SYSTEM VALUE
VALUES (990003, 990001, 990001, '00000000-0000-0000-0000-000000990002', 'in_route');
INSERT INTO public.order_items (order_id, product_id, quantity, status, unit_price)
VALUES (990003, 990001, 10, 'pending', 1000);

DO $$
DECLARE v_denied boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.confirm_delivery(990003, '[{"product_id":990001,"received_quantity":10}]'::jsonb);
  EXCEPTION WHEN raise_exception THEN
    v_denied := SQLERRM LIKE '%stock insuficiente del distribuidor%';
  END;
  RESET ROLE;
  ASSERT v_denied, 'T3: la entrega sin stock del distribuidor no fue rechazada';
  RAISE NOTICE 'PASS T3 entrega sin stock del distribuidor rechazada';
END $$;

-- Pedido 4: entregado con una línea sin precio; el fiado debe fallar claro y
-- luego usar el precio activo de la tienda cuando exista.
INSERT INTO public.orders (id, distributor_id, store_id, created_by, status, delivered_at)
OVERRIDING SYSTEM VALUE
VALUES (990004, 990001, 990001, '00000000-0000-0000-0000-000000990002', 'delivered', now());
INSERT INTO public.order_items
  (order_id, product_id, quantity, received_quantity, status, unit_price, distributor_price)
VALUES (990004, 990002, 1, 1, 'received', NULL, NULL);

DO $$
DECLARE v_denied boolean := false; v_credit bigint; v_total numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990001'), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.create_credit(990004, NULL);
  EXCEPTION WHEN raise_exception THEN
    v_denied := SQLERRM LIKE '%sin precio%';
  END;
  RESET ROLE;
  ASSERT v_denied, 'T4: el fiado sin precio no fue rechazado';
  RAISE NOTICE 'PASS T4 fiado sin precio rechazado';
END $$;

INSERT INTO public.price_publications (product_id, store_id, created_by, price)
VALUES (990002, 990001, '00000000-0000-0000-0000-000000990001', 2000);

DO $$
DECLARE v_credit bigint; v_total numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990001'), true);
  SET LOCAL ROLE authenticated;
  v_credit := public.create_credit(990004, NULL);
  RESET ROLE;
  SELECT total_amount INTO v_total FROM public.credits WHERE id = v_credit;
  ASSERT v_total = 2000, format('T4b: total esperado 2000, quedó %s', v_total);
  RAISE NOTICE 'PASS T4b el fiado usa el precio activo de la tienda';
END $$;

-- Pedido 1: no se puede revertir su movimiento ni cancelar el pedido entregado.
DO $$
DECLARE v_movement bigint; v_rev boolean := false; v_cancel boolean := false;
BEGIN
  SELECT id INTO v_movement FROM public.movements
  WHERE order_id = 990001 AND product_id = 990001 LIMIT 1;
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990001'), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.register_reverse(v_movement, 'prueba');
  EXCEPTION WHEN raise_exception THEN
    v_rev := SQLERRM LIKE '%pertenece al pedido%';
  END;
  BEGIN
    PERFORM public.update_order_status(990001, 'cancelled', 'prueba');
  EXCEPTION WHEN raise_exception THEN
    v_cancel := SQLERRM LIKE '%ya está delivered%';
  END;
  RESET ROLE;
  ASSERT v_rev, 'T5: se pudo revertir un movimiento de pedido';
  ASSERT v_cancel, 'T5: se pudo cancelar un pedido entregado';
  RAISE NOTICE 'PASS T5 movimientos y pedidos cerrados protegidos';
END $$;

ROLLBACK;
