-- ============================================================================
-- Prueba 0059: cantidades enteras para productos por unidad y decimales para
-- productos a granel. Correr con scripts/db-test.sh. Todo se revierte.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;
\ir _fixtures.sql

-- El fixture crea dos productos con la unidad mínima (Unidad). El segundo se
-- marca a granel para probar la excepción.
UPDATE public.products SET is_bulk = false WHERE id = 990001;
UPDATE public.products SET is_bulk = true  WHERE id = 990002;

INSERT INTO public.orders (id, distributor_id, store_id, created_by, status, delivered_at)
OVERRIDING SYSTEM VALUE
VALUES (990001, 990001, 990001, '00000000-0000-0000-0000-000000990002', 'delivered', now());

-- T1. Por defecto un producto no es a granel.
DO $$
BEGIN
  ASSERT NOT (SELECT is_bulk FROM public.products WHERE id = 990001),
         'T1: el producto 990001 quedó a granel';
  ASSERT (SELECT is_bulk FROM public.products WHERE id = 990002),
         'T1: el producto 990002 no quedó a granel';
  RAISE NOTICE 'PASS T1 modo de venta';
END $$;

-- T2. order_items rechaza una cantidad fraccionaria por unidad.
DO $$
DECLARE v_denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.order_items (order_id, product_id, quantity, status)
    VALUES (990001, 990001, 2.5, 'pending');
  EXCEPTION WHEN raise_exception THEN
    v_denied := SQLERRM LIKE '%cantidad debe ser entera%';
  END;
  ASSERT v_denied, 'T2: order_items aceptó 2.5 unidades';
  RAISE NOTICE 'PASS T2 pedido fraccionario rechazado';
END $$;

-- T3. order_items acepta 2 y rechaza un recibido fraccionario.
DO $$
DECLARE v_denied boolean := false;
BEGIN
  INSERT INTO public.order_items (order_id, product_id, quantity, status)
  VALUES (990001, 990001, 2, 'pending');
  BEGIN
    UPDATE public.order_items SET received_quantity = 1.5
    WHERE order_id = 990001 AND product_id = 990001;
  EXCEPTION WHEN raise_exception THEN
    v_denied := SQLERRM LIKE '%cantidad debe ser entera%';
  END;
  ASSERT v_denied, 'T3: order_items aceptó 1.5 recibidas';
  UPDATE public.order_items SET received_quantity = 2
  WHERE order_id = 990001 AND product_id = 990001;
  RAISE NOTICE 'PASS T3 recibido fraccionario rechazado';
END $$;

-- T4. movements rechaza fracciones por unidad y acepta enteros.
DO $$
DECLARE v_denied boolean := false; v_motive bigint;
BEGIN
  SELECT id INTO v_motive FROM public.motives ORDER BY id LIMIT 1;
  BEGIN
    INSERT INTO public.movements (type, product_id, store_id, motive_id, created_by, quantity)
    VALUES ('exit', 990001, 990001, v_motive,
            '00000000-0000-0000-0000-000000990002', 1.5);
  EXCEPTION WHEN raise_exception THEN
    v_denied := SQLERRM LIKE '%cantidad debe ser entera%';
  END;
  ASSERT v_denied, 'T4: movements aceptó 1.5 unidades';
  INSERT INTO public.movements (type, product_id, store_id, motive_id, created_by, quantity)
  VALUES ('exit', 990001, 990001, v_motive,
          '00000000-0000-0000-0000-000000990002', 2);
  RAISE NOTICE 'PASS T4 movimiento fraccionario rechazado';
END $$;

-- T5. stock rechaza fracciones por unidad y acepta enteros.
DO $$
DECLARE v_denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.stock (product_id, store_id, quantity) VALUES (990001, 990001, 1.5);
  EXCEPTION WHEN raise_exception THEN
    v_denied := SQLERRM LIKE '%cantidad debe ser entera%';
  END;
  ASSERT v_denied, 'T5: stock aceptó 1.5 unidades';
  INSERT INTO public.stock (product_id, store_id, quantity) VALUES (990001, 990001, 3);
  RAISE NOTICE 'PASS T5 stock fraccionario rechazado';
END $$;

-- T6. distributor_products rechaza fracciones por unidad.
DO $$
DECLARE v_denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.distributor_products (distributor_id, product_id, created_by, quantity)
    VALUES (990001, 990001, '00000000-0000-0000-0000-000000990003', 1.5);
  EXCEPTION WHEN raise_exception THEN
    v_denied := SQLERRM LIKE '%cantidad debe ser entera%';
  END;
  ASSERT v_denied, 'T6: distributor_products aceptó 1.5 unidades';
  INSERT INTO public.distributor_products (distributor_id, product_id, created_by, quantity)
  VALUES (990001, 990001, '00000000-0000-0000-0000-000000990003', 4);
  RAISE NOTICE 'PASS T6 catálogo del distribuidor fraccionario rechazado';
END $$;

-- T7. distributor_purchases rechaza fracciones por unidad.
DO $$
DECLARE v_denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.distributor_purchases
      (distributor_id, product_id, quantity, unit_cost, created_by)
    VALUES (990001, 990001, 1.5, 1000, '00000000-0000-0000-0000-000000990003');
  EXCEPTION WHEN raise_exception THEN
    v_denied := SQLERRM LIKE '%cantidad debe ser entera%';
  END;
  ASSERT v_denied, 'T7: distributor_purchases aceptó 1.5 unidades';
  RAISE NOTICE 'PASS T7 compra fraccionaria rechazada';
END $$;

-- T8. Un producto a granel sí acepta decimales.
DO $$
DECLARE v_motive bigint;
BEGIN
  SELECT id INTO v_motive FROM public.motives ORDER BY id LIMIT 1;
  INSERT INTO public.movements (type, product_id, store_id, motive_id, created_by, quantity)
  VALUES ('exit', 990002, 990001, v_motive,
          '00000000-0000-0000-0000-000000990002', 1.5);
  INSERT INTO public.stock (product_id, store_id, quantity) VALUES (990002, 990001, 2.75);
  RAISE NOTICE 'PASS T8 granel acepta decimales';
END $$;

-- T9. get_order_items expone el modo de venta y la unidad.
DO $$
DECLARE v_bulk boolean; v_unit text; v_qty numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990002'), true);
  SET LOCAL ROLE authenticated;
  SELECT is_bulk, unit, quantity INTO v_bulk, v_unit, v_qty
  FROM public.get_order_items(990001) WHERE product_id = 990001;
  RESET ROLE;
  ASSERT v_bulk IS FALSE, 'T9: is_bulk esperado false';
  ASSERT v_unit IS NOT NULL, 'T9: unidad no expuesta';
  ASSERT v_qty = 2, format('T9: cantidad esperada 2, obtenida %s', v_qty);
  RAISE NOTICE 'PASS T9 get_order_items expone modo y unidad';
END $$;

ROLLBACK;
