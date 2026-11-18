-- ============================================================================
-- Prueba 0054: el fiado se cobra por lo entregado y el distribuidor acreedor lo ve.
-- Correr con scripts/db-test.sh (Supabase local). Todo se revierte al final.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;
\ir _fixtures.sql

-- Pedido 990001 entregado en parte: 4 de 10 arroces (1000 c/u) y 0 de 5
-- aceites (2000 c/u, línea sin received_quantity). Lo pedido suma 20000;
-- lo entregado, 4000.
INSERT INTO public.orders (id, distributor_id, store_id, created_by, status, delivered_at)
OVERRIDING SYSTEM VALUE
VALUES (990001, 990001, 990001, '00000000-0000-0000-0000-000000990002', 'delivered', now()),
       (990002, 990001, 990001, '00000000-0000-0000-0000-000000990002', 'pending', NULL),
       (990003, 990002, 990002, '00000000-0000-0000-0000-000000990005', 'delivered', now());
INSERT INTO public.order_items (order_id, product_id, quantity, received_quantity, status, unit_price)
VALUES (990001, 990001, 10, 4, 'partial', 1000),
       (990001, 990002, 5, NULL, 'pending', 2000),
       (990002, 990001, 3, NULL, 'pending', 1000),
       (990003, 990001, 2, 2, 'delivered', 1000);

-- T1. El operador crea el fiado: el total es lo entregado (4000), no lo pedido.
DO $$
DECLARE v_total numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990002'), true);
  SET LOCAL ROLE authenticated;
  PERFORM public.create_credit(990001, NULL);
  SELECT total_amount INTO v_total FROM public.credits WHERE order_id = 990001;
  RESET ROLE;
  ASSERT v_total = 4000, format('T1: total esperado 4000, obtenido %s', v_total);
  RAISE NOTICE 'PASS T1 fiado por lo entregado (4000)';
END $$;

-- T2. Un pedido sin entregar no genera fiado.
DO $$
DECLARE v_ok boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990002'), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.create_credit(990002, NULL);
  EXCEPTION WHEN raise_exception THEN
    v_ok := SQLERRM LIKE '%no está entregado%';
  END;
  RESET ROLE;
  ASSERT v_ok, 'T2: create_credit aceptó un pedido pendiente';
  RAISE NOTICE 'PASS T2 pedido pendiente rechazado';
END $$;

-- El operador registra un abono de 1000 (flujo normal).
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990002'), true);
  SET LOCAL ROLE authenticated;
  PERFORM public.register_payment((SELECT id FROM public.credits WHERE order_id = 990001), 1000, 'cash');
  RESET ROLE;
END $$;

-- T3. El distribuidor del pedido (acreedor) ve el fiado y su pago.
DO $$
DECLARE v_c int; v_p int; v_bal numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), max(balance) INTO v_c, v_bal FROM public.credits WHERE order_id = 990001;
  SELECT count(*) INTO v_p FROM public.credit_payments;
  RESET ROLE;
  ASSERT v_c = 1, format('T3: el acreedor ve %s créditos, esperado 1', v_c);
  ASSERT v_bal = 3000, format('T3: saldo esperado 3000, obtenido %s', v_bal);
  ASSERT v_p = 1, format('T3: el acreedor ve %s pagos, esperado 1', v_p);
  RAISE NOTICE 'PASS T3 el acreedor ve su fiado (saldo 3000) y el pago';
END $$;

-- T4. Otro distribuidor y el operador de otra tienda no ven nada.
DO $$
DECLARE v_c int; v_p int; u uuid;
BEGIN
  FOREACH u IN ARRAY ARRAY['00000000-0000-0000-0000-000000990004',
                           '00000000-0000-0000-0000-000000990005']::uuid[] LOOP
    PERFORM set_config('request.jwt.claims', pg_temp.claims(u), true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_c FROM public.credits;
    SELECT count(*) INTO v_p FROM public.credit_payments;
    RESET ROLE;
    ASSERT v_c = 0 AND v_p = 0, format('T4: %s ve %s créditos y %s pagos ajenos', u, v_c, v_p);
  END LOOP;
  RAISE NOTICE 'PASS T4 terceros no ven el fiado';
END $$;

-- T5. El acreedor no escribe: no puede registrar pagos ni crear el fiado de
-- un pedido ajeno. Desde 0058 sí puede crear el de su propio pedido.
DO $$
DECLARE v_pay boolean := false; v_new boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.register_payment((SELECT id FROM public.credits WHERE order_id = 990001), 500, 'cash');
  EXCEPTION WHEN raise_exception THEN v_pay := true;
  END;
  BEGIN
    PERFORM public.create_credit(990003, NULL);
  EXCEPTION WHEN raise_exception THEN
    v_new := SQLERRM LIKE '%fuera del alcance del distribuidor%';
  END;
  RESET ROLE;
  ASSERT v_pay AND v_new, 'T5: el distribuidor pudo escribir en el fiado ajeno';
  RAISE NOTICE 'PASS T5 el acreedor no registra pagos ni fía pedidos ajenos';
END $$;

ROLLBACK;
