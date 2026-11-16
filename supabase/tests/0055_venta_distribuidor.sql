-- ============================================================================
-- Prueba 0055: la venta directa del distribuidor descuenta su inventario y se
-- rechaza si no alcanza. Correr con scripts/db-test.sh. Todo se revierte.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;
\ir _fixtures.sql

-- El distribuidor 990001 es Premium (la venta directa lo exige) y tiene 10
-- arroces en su catálogo, con umbral 3 para la alerta de stock bajo.
UPDATE public.users SET premium = true WHERE id = '00000000-0000-0000-0000-000000990003';
INSERT INTO public.distributor_products (distributor_id, product_id, created_by, quantity, threshold)
VALUES (990001, 990001, '00000000-0000-0000-0000-000000990003', 10, 3);

-- T1. Vender 4 deja 6 en el inventario del distribuidor y suma 4 a la tienda.
DO $$
DECLARE v_dist numeric; v_store numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  PERFORM public.register_distributor_sale(990001, 990001, 4, 1500, NULL);
  RESET ROLE;
  SELECT quantity INTO v_dist FROM public.distributor_products
  WHERE distributor_id = 990001 AND product_id = 990001;
  SELECT quantity INTO v_store FROM public.stock WHERE store_id = 990001 AND product_id = 990001;
  ASSERT v_dist = 6, format('T1: inventario del distribuidor esperado 6, obtenido %s', v_dist);
  ASSERT v_store = 4, format('T1: stock de la tienda esperado 4, obtenido %s', v_store);
  RAISE NOTICE 'PASS T1 la venta descuenta el inventario del distribuidor (10 → 6)';
END $$;

-- T2. Vender más de lo disponible se rechaza y no mueve nada.
DO $$
DECLARE v_msg text; v_dist numeric; v_store numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.register_distributor_sale(990001, 990001, 7, 1500, NULL);
  EXCEPTION WHEN raise_exception THEN v_msg := SQLERRM;
  END;
  RESET ROLE;
  SELECT quantity INTO v_dist FROM public.distributor_products
  WHERE distributor_id = 990001 AND product_id = 990001;
  SELECT quantity INTO v_store FROM public.stock WHERE store_id = 990001 AND product_id = 990001;
  ASSERT v_msg LIKE '%stock insuficiente: hay 6 disponibles%', format('T2: mensaje inesperado: %s', v_msg);
  ASSERT v_dist = 6 AND v_store = 4, format('T2: se movió stock (dist %s, tienda %s)', v_dist, v_store);
  RAISE NOTICE 'PASS T2 venta sin stock suficiente rechazada: %', v_msg;
END $$;

-- T3. Un ticket con varias líneas que no alcanza se revierte entero.
DO $$
DECLARE v_failed boolean := false; v_dist numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.register_distributor_sales_bulk(990001,
      '[{"product_id":990001,"quantity":5,"unit_price":1500},
        {"product_id":990001,"quantity":5,"unit_price":1500}]'::jsonb);
  EXCEPTION WHEN raise_exception THEN v_failed := true;
  END;
  RESET ROLE;
  SELECT quantity INTO v_dist FROM public.distributor_products
  WHERE distributor_id = 990001 AND product_id = 990001;
  ASSERT v_failed, 'T3: el ticket de 10 con 6 disponibles se aceptó';
  ASSERT v_dist = 6, format('T3: el ticket fallido dejó %s (esperado 6)', v_dist);
  RAISE NOTICE 'PASS T3 ticket sin stock suficiente se revierte completo';
END $$;

-- T4. Bajar del umbral abre la alerta de stock bajo del distribuidor.
DO $$
DECLARE v_alerts int;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  PERFORM public.register_distributor_sale(990001, 990001, 4, 1500, NULL);  -- 6 → 2 (umbral 3)
  RESET ROLE;
  SELECT count(*) INTO v_alerts FROM public.alerts
  WHERE type = 'stock_low' AND distributor_id = 990001 AND product_id = 990001 AND resolved_at IS NULL;
  ASSERT v_alerts = 1, format('T4: alertas de stock bajo abiertas: %s (esperado 1)', v_alerts);
  RAISE NOTICE 'PASS T4 alerta de stock bajo al quedar en 2';
END $$;

-- T5. Vender exactamente lo que queda está permitido y deja 0.
DO $$
DECLARE v_dist numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  PERFORM public.register_distributor_sale(990001, 990001, 2, 1500, NULL);  -- 2 → 0
  RESET ROLE;
  SELECT quantity INTO v_dist FROM public.distributor_products
  WHERE distributor_id = 990001 AND product_id = 990001;
  ASSERT v_dist = 0, format('T5: esperado 0, obtenido %s', v_dist);
  RAISE NOTICE 'PASS T5 vender todo el stock deja 0';
END $$;

-- T6. Revertir una venta (admin) devuelve las unidades al distribuidor.
DO $$
DECLARE v_mov bigint; v_dist numeric;
BEGIN
  SELECT min(id) INTO v_mov FROM public.movements
  WHERE distributor_id = 990001 AND product_id = 990001 AND reverso_of_id IS NULL;
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990001'), true);
  SET LOCAL ROLE authenticated;
  PERFORM public.register_reverse(v_mov, 'prueba de reverso');  -- la venta de 4 (T1)
  RESET ROLE;
  SELECT quantity INTO v_dist FROM public.distributor_products
  WHERE distributor_id = 990001 AND product_id = 990001;
  ASSERT v_dist = 4, format('T6: inventario tras el reverso %s (esperado 4)', v_dist);
  RAISE NOTICE 'PASS T6 el reverso de una venta devuelve el stock al distribuidor (0 → 4)';
END $$;

-- T7. Una venta anterior a 0055 (nunca descontó) se revierte sin crear stock.
INSERT INTO public.movements (type, product_id, store_id, distributor_id, motive_id, created_by, quantity, unit_price)
SELECT 'entry', 990001, 990001, 990001, mo.id, '00000000-0000-0000-0000-000000990003', 3, 1500
FROM public.motives mo WHERE mo.name = 'venta';
UPDATE public.stock SET quantity = quantity + 3 WHERE store_id = 990001 AND product_id = 990001;
DO $$
DECLARE v_mov bigint; v_dist numeric;
BEGIN
  SELECT max(id) INTO v_mov FROM public.movements
  WHERE distributor_id = 990001 AND product_id = 990001 AND reverso_of_id IS NULL;
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990001'), true);
  SET LOCAL ROLE authenticated;
  PERFORM public.register_reverse(v_mov, 'venta vieja');
  RESET ROLE;
  SELECT quantity INTO v_dist FROM public.distributor_products
  WHERE distributor_id = 990001 AND product_id = 990001;
  ASSERT v_dist = 4, format('T7: el reverso de una venta vieja dejó %s (esperado 4)', v_dist);
  RAISE NOTICE 'PASS T7 venta anterior a 0055: el reverso no inventa stock';
END $$;

ROLLBACK;
