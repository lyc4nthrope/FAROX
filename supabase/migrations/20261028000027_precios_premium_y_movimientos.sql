-- ============================================================================
-- FAROX — 0027: precios del Premium, precio en movimientos y alta.
--
--   1. set_price deja de ser solo-admin: cualquier usuario Premium con la
--      tienda en su alcance puede publicar el precio de venta de esa tienda.
--   2. add_store_product gana un precio opcional y lo publica en la MISMA
--      transacción del alta (una sola llamada).
--   3. register_entry / register_exit ganan el precio de la operación
--      (compra en entradas, venta en salidas). Sin él conservan la derivación
--      anterior (pedido o precio activo de la tienda).
--
-- Compatibilidad: las firmas viejas de register_entry (6 args), register_exit
-- (5) y add_store_product (4) NO se tocan: se agregan overloads sin defaults
-- para no romper la whitelist de 0011/0012 ni llamadas existentes.
--
-- Reglas del repo: SECURITY DEFINER + SET search_path; alcance desde el JWT;
-- GRANT explícito. El precio sigue siendo privado por tienda (D41).
-- ============================================================================

-- ============================================================================
-- 1. set_price — admin o Premium con la tienda en su alcance.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_price(
  p_product bigint, p_store bigint, p_price numeric(12,2), p_currency char(3) DEFAULT 'COP'
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');
  v_prev bigint;
  v_id   bigint;
BEGIN
  IF NOT public.is_premium() THEN
    RAISE EXCEPTION 'set_price: publicar precios requiere Premium (D7)';
  END IF;
  IF v_role <> 'admin' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'set_price: tienda fuera del alcance del usuario';
  END IF;
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'set_price: price debe ser > 0 (D27)';
  END IF;
  SELECT id INTO v_prev
  FROM public.price_publications
  WHERE product_id = p_product AND store_id = p_store AND is_active
  FOR UPDATE;  -- lock de la fila activa previa
  IF FOUND THEN
    UPDATE public.price_publications SET is_active = false WHERE id = v_prev;
  END IF;
  INSERT INTO public.price_publications (product_id, store_id, created_by, price, currency)
  VALUES (p_product, p_store, auth.uid(), p_price, COALESCE(p_currency, 'COP'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ============================================================================
-- 2. register_entry — precio de compra opcional. Overload de 7 argumentos
--    (sin defaults) para conservar la firma de 6 de la whitelist.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_entry(
  p_product bigint, p_store bigint, p_qty numeric(12,3), p_motive_id bigint,
  p_order_id bigint, p_expiry_date date, p_unit_price numeric(12,2)
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role        text := COALESCE(public.my_role(), '');
  v_dist        bigint;
  v_order_store bigint;
  v_price       numeric(12,2);
  v_id          bigint;
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'register_entry: solo admin/operador';
  END IF;
  IF NOT public.is_premium() THEN
    RAISE EXCEPTION 'D39: registrar movimientos manuales requiere premium';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'register_entry: tienda fuera del alcance del operador';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'register_entry: quantity debe ser > 0';
  END IF;
  -- 0027: el pedido (si viene) siempre valida su tienda y atribuye el
  -- distribuidor; el precio informado solo pisa el unit_price al final.
  IF p_order_id IS NOT NULL THEN
    SELECT o.distributor_id, o.store_id INTO v_dist, v_order_store
    FROM public.orders o WHERE o.id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pedido inexistente: %', p_order_id;
    END IF;
    IF v_order_store IS DISTINCT FROM p_store THEN
      RAISE EXCEPTION 'register_entry: el pedido % pertenece a la tienda %, no a %',
        p_order_id, v_order_store, p_store;
    END IF;
    SELECT oi.unit_price INTO v_price FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.product_id = p_product;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'producto % no pertenece al pedido %', p_product, p_order_id;
    END IF;
  END IF;
  IF p_unit_price IS NOT NULL THEN
    IF p_unit_price <= 0 THEN
      RAISE EXCEPTION 'register_entry: el precio de compra debe ser > 0';
    END IF;
    v_price := p_unit_price;
  ELSIF p_order_id IS NULL THEN
    SELECT pp.price INTO v_price
    FROM public.price_publications pp
    WHERE pp.product_id = p_product AND pp.store_id = p_store AND pp.is_active;
  END IF;
  v_id := public.internal_stock_entry('entry', p_product, p_store, p_qty,
                                      p_motive_id, p_order_id, v_dist, v_price,
                                      p_expiry_date, auth.uid());
  PERFORM public.internal_dashboard_upsert(COALESCE(v_dist, 0), 1, 0,
    CASE WHEN v_price IS NULL THEN 0 ELSE p_qty * v_price END, 0);
  RETURN v_id;
END;
$$;

-- ============================================================================
-- 3. register_exit — precio de venta opcional. Overload de 6 argumentos.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_exit(
  p_product bigint, p_store bigint, p_qty numeric(12,3), p_motive_id bigint,
  p_order_id bigint, p_unit_price numeric(12,2)
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role        text := COALESCE(public.my_role(), '');
  v_dist        bigint;
  v_order_store bigint;
  v_price       numeric(12,2);
  v_id          bigint;
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'register_exit: solo admin/operador';
  END IF;
  IF NOT public.is_premium() THEN
    RAISE EXCEPTION 'D39: registrar movimientos manuales requiere premium';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'register_exit: tienda fuera del alcance del operador';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'register_exit: quantity debe ser > 0';
  END IF;
  -- 0027: el pedido (si viene) siempre valida su tienda y atribuye el
  -- distribuidor; el precio informado solo pisa el unit_price al final.
  IF p_order_id IS NOT NULL THEN
    SELECT o.distributor_id, o.store_id INTO v_dist, v_order_store
    FROM public.orders o WHERE o.id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pedido inexistente: %', p_order_id;
    END IF;
    IF v_order_store IS DISTINCT FROM p_store THEN
      RAISE EXCEPTION 'register_exit: el pedido % pertenece a la tienda %, no a %',
        p_order_id, v_order_store, p_store;
    END IF;
    SELECT oi.unit_price INTO v_price FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.product_id = p_product;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'producto % no pertenece al pedido %', p_product, p_order_id;
    END IF;
  END IF;
  IF p_unit_price IS NOT NULL THEN
    IF p_unit_price <= 0 THEN
      RAISE EXCEPTION 'register_exit: el precio de venta debe ser > 0';
    END IF;
    v_price := p_unit_price;
  ELSIF p_order_id IS NULL THEN
    SELECT pp.price INTO v_price
    FROM public.price_publications pp
    WHERE pp.product_id = p_product AND pp.store_id = p_store AND pp.is_active;
  END IF;
  v_id := public.internal_stock_entry('exit', p_product, p_store, p_qty,
                                      p_motive_id, p_order_id, v_dist, v_price,
                                      NULL, auth.uid());
  PERFORM public.internal_dashboard_upsert(COALESCE(v_dist, 0), 0, 1, 0,
    CASE WHEN v_price IS NULL THEN 0 ELSE p_qty * v_price END);
  RETURN v_id;
END;
$$;

-- ============================================================================
-- 4. add_store_product — alta con cantidad inicial y precio opcional. Overload
--    de 5 argumentos; la firma de 4 de 0026 queda intacta.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.add_store_product(
  p_product bigint,
  p_store bigint,
  p_quantity numeric(12,3),
  p_threshold numeric(12,3),
  p_price numeric(12,2)
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');
  v_prev bigint;
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'add_store_product: solo admin/operador';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'add_store_product: tienda fuera del alcance del operador';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'add_store_product: la cantidad no puede ser negativa';
  END IF;
  IF p_threshold IS NOT NULL AND p_threshold < 0 THEN
    RAISE EXCEPTION 'add_store_product: el umbral no puede ser negativo';
  END IF;
  -- 0027: precio de venta opcional en la MISMA transacción del alta.
  IF p_price IS NOT NULL THEN
    IF NOT public.is_premium() THEN
      RAISE EXCEPTION 'add_store_product: publicar precios requiere Premium (D7)';
    END IF;
    IF p_price <= 0 THEN
      RAISE EXCEPTION 'add_store_product: el precio debe ser > 0';
    END IF;
    SELECT id INTO v_prev
    FROM public.price_publications
    WHERE product_id = p_product AND store_id = p_store AND is_active
    FOR UPDATE;
    IF FOUND THEN
      UPDATE public.price_publications SET is_active = false WHERE id = v_prev;
    END IF;
    INSERT INTO public.price_publications (product_id, store_id, created_by, price, currency)
    VALUES (p_product, p_store, auth.uid(), p_price, 'COP');
  END IF;
  INSERT INTO public.stock (product_id, store_id, quantity, threshold)
  VALUES (p_product, p_store, p_quantity, p_threshold)
  ON CONFLICT (product_id, store_id) DO NOTHING;
  PERFORM public.internal_eval_stock_alert(p_store, p_product);
END;
$$;

-- ============================================================================
-- 5. Grants de las firmas nuevas (las viejas conservan sus grants)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.set_price(bigint, bigint, numeric(12,2), char(3)),
  public.register_entry(bigint, bigint, numeric, bigint, bigint, date, numeric),
  public.register_exit(bigint, bigint, numeric, bigint, bigint, numeric),
  public.add_store_product(bigint, bigint, numeric, numeric, numeric)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.set_price(bigint, bigint, numeric(12,2), char(3)),
  public.register_entry(bigint, bigint, numeric, bigint, bigint, date, numeric),
  public.register_exit(bigint, bigint, numeric, bigint, bigint, numeric),
  public.add_store_product(bigint, bigint, numeric, numeric, numeric)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · Un operador Premium con la tienda en alcance ejecuta set_price ⇒ OK.
--   · Un operador sin premium ejecuta set_price ⇒ excepción.
--   · add_store_product con p_price ⇒ price_publications activa con ese precio.
--   · register_entry con p_unit_price ⇒ movements.unit_price = precio informado.
--   · register_exit con p_unit_price ⇒ ídem; sin precio conserva la derivación.
--   · Las firmas viejas siguen existiendo (whitelist 0011/0012 intacta).
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   Restaurar set_price desde 0011. Las firmas viejas nunca se tocaron.
--   DROP FUNCTION IF EXISTS public.register_entry(bigint, bigint, numeric, bigint, bigint, date, numeric);
--   DROP FUNCTION IF EXISTS public.register_exit(bigint, bigint, numeric, bigint, bigint, numeric);
--   DROP FUNCTION IF EXISTS public.add_store_product(bigint, bigint, numeric, numeric, numeric);
