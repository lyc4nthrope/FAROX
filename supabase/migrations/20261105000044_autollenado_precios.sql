-- ============================================================================
-- FAROX — 0044: autollenado de precios desde los movimientos.
--
-- PROBLEMA
--   Un producto sin precio obliga a cargarlo a mano. La primera compra o venta
--   ya trae un precio real: si el producto no tiene precio, ese movimiento lo
--   deja cargado y con el tiempo la tienda se llena sola.
--
-- REGLAS (conservadoras: solo se escribe cuando el dato es seguro)
--   · Entrada con motivo 'reabastecimiento': si el producto NO tiene precio de
--     compra, se guarda el precio informado (o el del pedido) en
--     store_product_prices. Nunca se pisa un precio existente.
--   · Salida con motivo 'venta': si la tienda NO tiene publicación activa, se
--     publica el precio informado. Nunca se pisa un precio activo.
--   · El precio de venta de un ticket con descuento es NETO (0037): se publica
--     el precio de LISTA (neto / (1 - descuento)), no el neto. Si no, el
--     precio se degradaría con cada descuento.
--   · El fallback de entrada al precio de venta activo NO es un costo: solo se
--     autollena con un precio informado o de pedido.
--   · Motivos como merma, ajuste o devolución no tocan precios.
--   · No se autollenan entregas de pedidos (confirm_delivery) ni ventas del
--     distribuidor: esos flujos usan internal_stock_entry directamente.
--
-- COMPATIBILIDAD
--   Las firmas de 7 args (register_entry) y 6 args (register_exit) siguen
--   existiendo y delegan en overloads nuevos con p_fill_price. Sin defaults,
--   igual que 0027, para no romper la whitelist de 0011/0012. La
--   implementación se crea ANTES del overload que delega: with
--   check_function_bodies ON, el cuerpo se valida al crear la función.
-- ============================================================================

-- ============================================================================
-- 1. register_entry — 8 args (implementación) y 7 args (delega).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_entry(
  p_product bigint, p_store bigint, p_qty numeric(12,3), p_motive_id bigint,
  p_order_id bigint, p_expiry_date date, p_unit_price numeric(12,2),
  p_fill_price numeric(12,2)
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role        text := COALESCE(public.my_role(), '');
  v_dist        bigint;
  v_order_store bigint;
  v_price       numeric(12,2);
  v_fill        numeric(12,2);
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
    SELECT COALESCE(
             (SELECT spp.purchase_price FROM public.store_product_prices spp
              WHERE spp.store_id = p_store AND spp.product_id = p_product),
             (SELECT pp.price FROM public.price_publications pp
              WHERE pp.product_id = p_product AND pp.store_id = p_store AND pp.is_active
              LIMIT 1)
           )
      INTO v_price;
  END IF;

  -- 0044: qué precio se aprende. Solo un costo real (informado o del pedido);
  -- el fallback al precio de venta activo no es un costo y no se publica.
  v_fill := p_fill_price;
  IF v_fill IS NULL AND (p_unit_price IS NOT NULL OR p_order_id IS NOT NULL) THEN
    v_fill := v_price;
  END IF;
  IF v_fill IS NOT NULL AND v_fill <= 0 THEN
    RAISE EXCEPTION 'register_entry: el precio a publicar debe ser > 0';
  END IF;

  v_id := public.internal_stock_entry('entry', p_product, p_store, p_qty,
                                      p_motive_id, p_order_id, v_dist, v_price,
                                      p_expiry_date, auth.uid());
  PERFORM public.internal_dashboard_upsert(COALESCE(v_dist, 0), 1, 0,
    CASE WHEN v_price IS NULL THEN 0 ELSE p_qty * v_price END, 0);

  -- 0044: reponer stock con un costo conocido deja cargado el precio de compra
  -- si la tienda todavía no lo tenía. ON CONFLICT evita pisar uno existente.
  IF v_fill IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.motives m
                 WHERE m.id = p_motive_id AND m.name = 'reabastecimiento')
  THEN
    INSERT INTO public.store_product_prices (store_id, product_id, purchase_price, created_by)
    VALUES (p_store, p_product, v_fill, auth.uid())
    ON CONFLICT (store_id, product_id) DO NOTHING;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_entry(
  p_product bigint, p_store bigint, p_qty numeric(12,3), p_motive_id bigint,
  p_order_id bigint, p_expiry_date date, p_unit_price numeric(12,2)
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN public.register_entry(p_product, p_store, p_qty, p_motive_id, p_order_id,
                               p_expiry_date, p_unit_price, NULL);
END;
$$;

-- ============================================================================
-- 2. register_exit — 7 args (implementación) y 6 args (delega).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_exit(
  p_product bigint, p_store bigint, p_qty numeric(12,3), p_motive_id bigint,
  p_order_id bigint, p_unit_price numeric(12,2), p_fill_price numeric(12,2)
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role        text := COALESCE(public.my_role(), '');
  v_dist        bigint;
  v_order_store bigint;
  v_price       numeric(12,2);
  v_fill        numeric(12,2);
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

  -- 0044: p_fill_price trae el precio de LISTA cuando el ticket tiene
  -- descuento (el unit_price guardado es el neto). Sin él, se usa el informado.
  v_fill := p_fill_price;
  IF v_fill IS NULL AND p_unit_price IS NOT NULL THEN
    v_fill := v_price;
  END IF;
  IF v_fill IS NOT NULL AND v_fill <= 0 THEN
    RAISE EXCEPTION 'register_exit: el precio a publicar debe ser > 0';
  END IF;

  v_id := public.internal_stock_entry('exit', p_product, p_store, p_qty,
                                      p_motive_id, p_order_id, v_dist, v_price,
                                      NULL, auth.uid());
  PERFORM public.internal_dashboard_upsert(COALESCE(v_dist, 0), 0, 1, 0,
    CASE WHEN v_price IS NULL THEN 0 ELSE p_qty * v_price END);

  -- 0044: una venta deja publicado el precio si la tienda no tenía uno. El
  -- ON CONFLICT sobre el índice parcial evita pisar la publicación activa.
  IF v_fill IS NOT NULL AND p_order_id IS NULL
     AND EXISTS (SELECT 1 FROM public.motives m
                 WHERE m.id = p_motive_id AND m.name = 'venta')
  THEN
    INSERT INTO public.price_publications (product_id, store_id, created_by, price, currency)
    VALUES (p_product, p_store, auth.uid(), v_fill, 'COP')
    ON CONFLICT (store_id, product_id) WHERE is_active DO NOTHING;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_exit(
  p_product bigint, p_store bigint, p_qty numeric(12,3), p_motive_id bigint,
  p_order_id bigint, p_unit_price numeric(12,2)
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN public.register_exit(p_product, p_store, p_qty, p_motive_id, p_order_id,
                              p_unit_price, NULL);
END;
$$;

-- ============================================================================
-- 3. register_movements_bulk — el ticket de la UI pasa el precio de LISTA en
--    salidas con descuento (el unit_price sigue siendo el neto).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_movements_bulk(
  p_store    bigint,
  p_type     public.movement_type,
  p_motive_id bigint,
  p_lines    jsonb,
  p_discount numeric(5,2) DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_line  record;
  v_id    bigint;
  v_count integer := 0;
  v_fill  numeric(12,2);
BEGIN
  IF p_store IS NULL THEN
    RAISE EXCEPTION 'register_movements_bulk: tienda requerida';
  END IF;
  IF p_type IS NULL THEN
    RAISE EXCEPTION 'register_movements_bulk: tipo requerido';
  END IF;
  IF p_motive_id IS NULL THEN
    RAISE EXCEPTION 'register_movements_bulk: motivo requerido';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.motives m WHERE m.id = p_motive_id AND m.is_active
  ) THEN
    RAISE EXCEPTION 'register_movements_bulk: motivo % inválido', p_motive_id;
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'register_movements_bulk: agregá al menos un producto';
  END IF;
  IF jsonb_array_length(p_lines) > 100 THEN
    RAISE EXCEPTION 'register_movements_bulk: máximo 100 líneas por ticket';
  END IF;
  IF p_discount IS NOT NULL THEN
    IF p_type <> 'exit' THEN
      RAISE EXCEPTION 'register_movements_bulk: el descuento solo aplica a salidas';
    END IF;
    IF p_discount < 0 OR p_discount > 100 THEN
      RAISE EXCEPTION 'register_movements_bulk: el descuento debe estar entre 0 y 100';
    END IF;
  END IF;

  FOR v_line IN
    SELECT * FROM jsonb_to_recordset(p_lines)
      AS x(product_id bigint, quantity numeric(12,3), unit_price numeric(12,2), expiry_date date)
    ORDER BY x.product_id
  LOOP
    v_fill := NULL;
    IF p_type = 'entry' THEN
      v_id := public.register_entry(
        p_product     => v_line.product_id,
        p_store       => p_store,
        p_qty         => v_line.quantity,
        p_motive_id   => p_motive_id,
        p_order_id    => NULL,
        p_expiry_date => v_line.expiry_date,
        p_unit_price  => v_line.unit_price,
        p_fill_price  => NULL
      );
    ELSE
      IF p_discount IS NOT NULL AND p_discount > 0 AND p_discount < 100 THEN
        v_fill := round(v_line.unit_price / (1 - p_discount / 100.0), 2);
      END IF;
      v_id := public.register_exit(
        p_product    => v_line.product_id,
        p_store      => p_store,
        p_qty        => v_line.quantity,
        p_motive_id  => p_motive_id,
        p_order_id   => NULL,
        p_unit_price => v_line.unit_price,
        p_fill_price => v_fill
      );
      IF p_discount IS NOT NULL THEN
        UPDATE public.movements SET discount_pct = p_discount WHERE id = v_id;
      END IF;
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 4. Grants de las firmas nuevas (las viejas conservan los suyos).
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.register_entry(bigint, bigint, numeric, bigint, bigint, date, numeric, numeric),
  public.register_exit(bigint, bigint, numeric, bigint, bigint, numeric, numeric)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.register_entry(bigint, bigint, numeric, bigint, bigint, date, numeric, numeric),
  public.register_exit(bigint, bigint, numeric, bigint, bigint, numeric, numeric)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · Entrada 'reabastecimiento' con precio sobre un producto sin precio de
--     compra ⇒ store_product_prices queda con ese precio.
--   · La misma entrada sobre un producto con precio ⇒ el precio NO cambia.
--   · Entrada 'devolución' o 'ajuste' ⇒ no toca precios.
--   · Salida 'venta' con precio y sin publicación activa ⇒ queda una
--     publicación activa con ese precio.
--   · La misma salida con publicación activa ⇒ no se crea otra.
--   · Salida 'merma' ⇒ no toca precios.
--   · Ticket de venta con 10% de descuento: el movimiento guarda el neto y la
--     publicación queda con el precio de lista (neto / 0.9).
--   · Una entrada sin precio propio ni de pedido que cae al precio de venta
--     activo ⇒ NO se publica como costo.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   Restaurar register_entry desde 0030, register_exit desde 0027 y
--   register_movements_bulk desde 0037.
--   DROP FUNCTION IF EXISTS public.register_entry(bigint, bigint, numeric, bigint, bigint, date, numeric, numeric);
--   DROP FUNCTION IF EXISTS public.register_exit(bigint, bigint, numeric, bigint, bigint, numeric, numeric);
