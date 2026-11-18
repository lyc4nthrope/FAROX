-- ============================================================================
-- Prueba 0058: el distribuidor acreedor crea el fiado de su pedido y la
-- entrega parcial queda marcada en orders.has_shortage.
-- Correr con scripts/db-test.sh. Todo se revierte.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;
\ir _fixtures.sql

-- Pedido 1: entregado parcialmente, distribuidor 990001 / tienda 990001.
INSERT INTO public.orders (id, distributor_id, store_id, created_by, status, delivered_at)
OVERRIDING SYSTEM VALUE
VALUES (990001, 990001, 990001, '00000000-0000-0000-0000-000000990002',
        'delivered', now());

INSERT INTO public.order_items
  (order_id, product_id, quantity, received_quantity, unit_price, distributor_price, status)
VALUES (990001, 990001, 10, 4, 100, 100, 'partial');

-- Pedido 2: mismo escenario para el otro distribuidor.
INSERT INTO public.orders (id, distributor_id, store_id, created_by, status, delivered_at)
OVERRIDING SYSTEM VALUE
VALUES (990002, 990002, 990002, '00000000-0000-0000-0000-000000990005',
        'delivered', now());

INSERT INTO public.order_items
  (order_id, product_id, quantity, received_quantity, unit_price, distributor_price, status)
VALUES (990002, 990001, 5, 2, 100, 100, 'partial');

-- T1. El trigger marca la entrega parcial.
DO $$
BEGIN
  ASSERT (SELECT has_shortage FROM public.orders WHERE id = 990001),
         'T1: pedido 990001 sin has_shortage';
  ASSERT (SELECT has_shortage FROM public.orders WHERE id = 990002),
         'T1: pedido 990002 sin has_shortage';
  RAISE NOTICE 'PASS T1 entrega parcial marcada';
END $$;

-- T2. El distribuidor acreedor crea el fiado por lo recibido.
DO $$
DECLARE v_credit bigint; v_total numeric(14,2);
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  v_credit := public.create_credit(990001, NULL);
  RESET ROLE;
  SELECT total_amount INTO v_total FROM public.credits WHERE id = v_credit;
  ASSERT v_total = 400, format('T2: total esperado 400, quedó %s', v_total);
  RAISE NOTICE 'PASS T2 distribuidor crea el fiado';
END $$;

-- T3. Un distribuidor ajeno no puede crear el fiado del pedido.
DO $$
DECLARE v_denied boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990004'), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.create_credit(990001, NULL);
  EXCEPTION WHEN raise_exception THEN v_denied := true;
  END;
  RESET ROLE;
  ASSERT v_denied, 'T3: el distribuidor ajeno pudo crear el fiado';
  RAISE NOTICE 'PASS T3 alcance del distribuidor';
END $$;

-- T4. El segundo distribuidor crea el fiado de su propio pedido.
DO $$
DECLARE v_credit bigint; v_total numeric(14,2);
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990004'), true);
  SET LOCAL ROLE authenticated;
  v_credit := public.create_credit(990002, DATE '2026-12-31');
  RESET ROLE;
  SELECT total_amount INTO v_total FROM public.credits WHERE id = v_credit;
  ASSERT v_total = 200, format('T4: total esperado 200, quedó %s', v_total);
  RAISE NOTICE 'PASS T4 segundo distribuidor crea su fiado';
END $$;

ROLLBACK;
