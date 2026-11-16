-- ============================================================================
-- FAROX — 0045: margen de ganancia y precio de venta sugerido.
--
-- PROBLEMA
--   Saber el costo no alcanza: el dueño quiere vender con una ganancia. Definir
--   el margen una vez evita calcular precio por precio para 100 productos.
--
-- DISEÑO
--   · users.default_margin_pct: porcentaje SOBRE EL COSTO (markup). 50 % sobre
--     10.000 ⇒ 15.000. No es margen sobre la venta (que daría 20.000).
--   · internal_sale_price_from_cost(costo, margen): redondea al peso.
--   · El margen se aplica SOLO cuando la tienda/distribuidor no tiene precio de
--     venta. Nunca pisa un precio existente (mismo principio que 0043/0044).
--   · Operador: una entrada con costo sugiere el precio de venta con SU margen.
--   · Distribuidor: una compra actualiza su costo y, si no tenía precio de
--     venta, lo sugiere con SU margen.
--   · Pedido: confirm_delivery aprende el costo de la tienda y usa el margen
--     del operador que hizo el pedido (orders.created_by). El actor debe ser
--     Premium, igual que el resto de las escrituras de precio (D7).
--
-- COMPATIBILIDAD
--   Se reemplazan register_entry (8 args, de 0044), confirm_delivery (0025) y
--   register_distributor_purchases (0037) conservando sus validaciones y su
--   firma. Las firmas viejas de register_entry siguen delegando.
-- ============================================================================

-- ============================================================================
-- 1. Columna del margen (por usuario; aplica a sus tiendas y a su distribuidora).
-- ============================================================================
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS default_margin_pct numeric(6,2) NULL;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_default_margin_pct_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_default_margin_pct_check
  CHECK (default_margin_pct IS NULL OR (default_margin_pct >= 0 AND default_margin_pct <= 1000));

-- ============================================================================
-- 2. Helpers.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.internal_user_margin_pct(p_user uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.default_margin_pct FROM public.users u WHERE u.id = p_user;
$$;

-- Redondeo al peso: precios de tienda en COP sin centavos.
CREATE OR REPLACE FUNCTION public.internal_sale_price_from_cost(
  p_cost numeric, p_margin numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_cost IS NULL OR p_cost <= 0 THEN NULL
    WHEN p_margin IS NULL OR p_margin <= 0 THEN NULL
    ELSE round(p_cost * (1 + p_margin / 100.0), 0)
  END;
$$;

-- ============================================================================
-- 3. set_my_margin — el usuario cambia SOLO su propio margen.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_my_margin(p_margin numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'set_my_margin: sesión requerida';
  END IF;
  IF p_margin IS NOT NULL AND (p_margin < 0 OR p_margin > 1000) THEN
    RAISE EXCEPTION 'set_my_margin: el margen debe estar entre 0 y 1000';
  END IF;
  UPDATE public.users SET default_margin_pct = p_margin WHERE id = auth.uid();
END;
$$;

-- ============================================================================
-- 4. register_entry (8 args) — conserva 0044 y agrega el precio de venta
--    sugerido con el margen del usuario.
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
  v_cost        numeric(12,2);
  v_sale        numeric(12,2);
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

  -- 0045: con costo conocido y sin precio de venta, se sugiere el precio con el
  -- margen del usuario. El ON CONFLICT sobre el índice parcial nunca pisa uno.
  SELECT spp.purchase_price INTO v_cost
  FROM public.store_product_prices spp
  WHERE spp.store_id = p_store AND spp.product_id = p_product;

  v_sale := public.internal_sale_price_from_cost(v_cost, public.internal_user_margin_pct(auth.uid()));
  IF v_sale IS NOT NULL THEN
    INSERT INTO public.price_publications (product_id, store_id, created_by, price, currency)
    VALUES (p_product, p_store, auth.uid(), v_sale, 'COP')
    ON CONFLICT (store_id, product_id) WHERE is_active DO NOTHING;
  END IF;

  RETURN v_id;
END;
$$;

-- ============================================================================
-- 5. confirm_delivery — aprende el costo de la tienda y sugiere la venta con el
--    margen del operador que hizo el pedido.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirm_delivery(
  p_order bigint, p_items jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role        text := public.my_role();
  o             public.orders%ROWTYPE;
  v_motive      bigint;
  it            record;
  v_rq          numeric(12,3);
  v_qty         numeric(12,3);  -- R1.5: cantidad pedida para el upper bound
  v_st          public.order_item_status;
  v_price       numeric(12,2);  -- D-2 + 0024: cotización o precio de tienda
  v_cost        numeric(12,2);  -- 0045: costo aprendido de la tienda
  v_sale        numeric(12,2);  -- 0045: precio de venta sugerido
  v_entries     integer      := 0;  -- D-2: líneas con recepción > 0
  v_entries_val numeric(14,2) := 0; -- D-2: Σ received_quantity × precio
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido inexistente: %', p_order; END IF;
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor' AND o.distributor_id = public.my_distributor_id() THEN
    NULL;  -- 0025: entrega el distribuidor al que se le pidió
  ELSE
    RAISE EXCEPTION 'confirm_delivery: sin alcance sobre el pedido %', p_order;
  END IF;
  -- R1.2/R1.3: estados cerrados no admiten recepción (idempotencia)
  IF o.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'confirm_delivery: el pedido % ya confirmado; estado "%" no admite recepción',
      p_order, o.status;
  END IF;
  -- R1.4: array no vacío (2 IF: el OR no garantiza evaluación en orden y
  -- jsonb_array_length sobre un no-array levantaría error de tipo)
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'confirm_delivery: items requeridos (array no vacío)';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'confirm_delivery: items requeridos (array no vacío)';
  END IF;
  -- Review batch1 #2: sin duplicados (1 sentencia set-based). Dos elementos
  -- con el mismo product_id apuntan a la MISMA línea (uq_order_items_order_
  -- product) ⇒ el stock/movements/dashboard se duplicaría en silencio.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS x(product_id bigint, received_quantity numeric(12,3))
    GROUP BY x.product_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'confirm_delivery: producto repetido en items';
  END IF;
  SELECT id INTO v_motive FROM public.motives WHERE name = 'reabastecimiento';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'motivo "reabastecimiento" sin sembrado (correr 0005_seeds.sql)';
  END IF;
  -- orden por product_id ⇒ locks en mismo orden (anti-deadlock, §4)
  FOR it IN
    SELECT x.product_id, x.received_quantity
    FROM jsonb_to_recordset(p_items) AS x(product_id bigint, received_quantity numeric(12,3))
    ORDER BY x.product_id
  LOOP
    IF it.received_quantity IS NULL OR it.received_quantity < 0 THEN
      RAISE EXCEPTION 'received_quantity inválida (producto %)', it.product_id;
    END IF;
    -- D-2: 4 columnas en el RETURNING — quantity (R1.5) y precio (D-2 + 0024)
    -- salen de la MISMA fila; cero subconsultas por línea.
    UPDATE public.order_items oi
    SET received_quantity = it.received_quantity,
        status = CASE
                   WHEN it.received_quantity = oi.quantity THEN 'received'::public.order_item_status
                   WHEN it.received_quantity > 0          THEN 'partial'::public.order_item_status
                   ELSE 'pending'::public.order_item_status
                 END
    WHERE oi.order_id = p_order AND oi.product_id = it.product_id
    RETURNING oi.received_quantity, oi.status, oi.quantity,
              COALESCE(oi.distributor_price, oi.unit_price)
    INTO v_rq, v_st, v_qty, v_price;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'producto % no pertenece al pedido %', it.product_id, p_order;
    END IF;
    IF v_rq > v_qty THEN  -- R1.5: defensa (ver NOTAS; el CHECK revienta antes)
      RAISE EXCEPTION 'confirm_delivery: received_quantity (%) excede la cantidad pedida (%) del producto %',
        v_rq, v_qty, it.product_id;
    END IF;
    IF v_rq > 0 THEN
      -- entrada (no exit): la entrega suma stock a la tienda destino (C3)
      PERFORM public.internal_stock_entry('entry', it.product_id, o.store_id, v_rq,
                                          v_motive, p_order, o.distributor_id,
                                          v_price, NULL, auth.uid());

      -- 0045: la entrega deja el costo de la tienda y, si no tenía precio de
      -- venta, lo sugiere con el margen del operador que hizo el pedido.
      IF public.is_premium() AND v_price IS NOT NULL AND v_price > 0 THEN
        INSERT INTO public.store_product_prices (store_id, product_id, purchase_price, created_by)
        VALUES (o.store_id, it.product_id, v_price, auth.uid())
        ON CONFLICT (store_id, product_id) DO NOTHING;
        SELECT spp.purchase_price INTO v_cost
        FROM public.store_product_prices spp
        WHERE spp.store_id = o.store_id AND spp.product_id = it.product_id;
        v_sale := public.internal_sale_price_from_cost(v_cost, public.internal_user_margin_pct(o.created_by));
        IF v_sale IS NOT NULL THEN
          INSERT INTO public.price_publications (product_id, store_id, created_by, price, currency)
          VALUES (it.product_id, o.store_id, auth.uid(), v_sale, 'COP')
          ON CONFLICT (store_id, product_id) WHERE is_active DO NOTHING;
        END IF;
      END IF;

      -- D-2: acumula en vez de upsertear por línea
      v_entries     := v_entries + 1;
      v_entries_val := v_entries_val + COALESCE(v_rq * v_price, 0);
    END IF;
  END LOOP;
  -- D-2 / R7.1: UN SOLO upsert del agregado (delta total de la entrega),
  -- ANTES del cierre del pedido; 1 fila tocada y 1 evento realtime por
  -- entrega en lugar de 1 por línea.
  IF v_entries > 0 THEN
    PERFORM public.internal_dashboard_upsert(COALESCE(o.distributor_id, 0),
      v_entries, 0, v_entries_val, 0);
  END IF;
  -- R1.6: cierre condicional race-safe — exactamente UNA llamada gana
  UPDATE public.orders SET status = 'delivered', delivered_at = now()
  WHERE id = p_order AND status <> 'delivered';  -- CHECK lo exige
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_delivery: el pedido % ya confirmado', p_order;
  END IF;
  PERFORM public.internal_alert_resolve('order_late', NULL, NULL, p_order);  -- A6
END;
$$;

-- ============================================================================
-- 6. register_distributor_purchases — el distribuidor también recibe el precio
--    de venta sugerido, sin pisar el que ya haya definido.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_distributor_purchases(
  p_lines jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := COALESCE(public.my_role(), '');
  v_dist  bigint;
  v_line  record;
  v_count integer := 0;
BEGIN
  IF v_role <> 'distribuidor' THEN
    RAISE EXCEPTION 'register_distributor_purchases: solo distribuidor';
  END IF;
  IF NOT public.is_premium() THEN
    RAISE EXCEPTION 'register_distributor_purchases: requiere Premium';
  END IF;
  v_dist := public.my_distributor_id();
  IF v_dist IS NULL THEN
    RAISE EXCEPTION 'register_distributor_purchases: distribuidora no identificada';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'register_distributor_purchases: agregá al menos un producto';
  END IF;
  IF jsonb_array_length(p_lines) > 100 THEN
    RAISE EXCEPTION 'register_distributor_purchases: máximo 100 líneas por ticket';
  END IF;

  FOR v_line IN
    SELECT * FROM jsonb_to_recordset(p_lines)
      AS x(product_id bigint, quantity numeric(12,3), unit_price numeric(12,2), expiry_date date)
  LOOP
    IF v_line.product_id IS NULL THEN
      RAISE EXCEPTION 'register_distributor_purchases: producto requerido en cada línea';
    END IF;
    IF v_line.quantity IS NULL OR v_line.quantity <= 0 THEN
      RAISE EXCEPTION 'register_distributor_purchases: la cantidad debe ser > 0';
    END IF;
    IF v_line.unit_price IS NULL OR v_line.unit_price <= 0 THEN
      RAISE EXCEPTION 'register_distributor_purchases: el costo unitario debe ser > 0';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.distributor_products dp
      JOIN public.products p ON p.id = dp.product_id AND p.is_active
      WHERE dp.distributor_id = v_dist AND dp.product_id = v_line.product_id
    ) THEN
      RAISE EXCEPTION 'register_distributor_purchases: el producto % no está en tu catálogo',
        v_line.product_id;
    END IF;

    UPDATE public.distributor_products dp
    SET quantity = dp.quantity + v_line.quantity,
        purchase_price = v_line.unit_price,
        sale_price = CASE WHEN dp.sale_price IS NULL THEN internal_sale_price_from_cost(v_line.unit_price, public.internal_user_margin_pct(auth.uid())) ELSE dp.sale_price END,
        expiry_date = COALESCE(v_line.expiry_date, dp.expiry_date),
        updated_at = now()
    WHERE dp.distributor_id = v_dist AND dp.product_id = v_line.product_id;

    INSERT INTO public.distributor_purchases
      (distributor_id, product_id, quantity, unit_cost, expiry_date, created_by)
    VALUES
      (v_dist, v_line.product_id, v_line.quantity, v_line.unit_price,
       v_line.expiry_date, auth.uid());

    PERFORM public.internal_eval_distributor_alert(v_dist, v_line.product_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 7. Grants.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.set_my_margin(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_margin(numeric)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · set_my_margin(50) ⇒ users.default_margin_pct = 50 para auth.uid().
--   · Un margen de -1 o 1001 ⇒ excepción.
--   · Entrada 'reabastecimiento' a 10.000 con margen 50 % y sin precio de venta
--     ⇒ price_publications activa en 15.000.
--   · La misma entrada con precio de venta activo ⇒ no cambia nada.
--   · Entrega de pedido a 10.000: aprende el costo y sugiere 15.000 si el
--     operador que pidió tiene 50 % y la tienda no tenía precio.
--   · Compra del distribuidor a 10.000 con margen 50 % ⇒ sale_price 15.000 en
--     distributor_products; si ya tenía sale_price, no cambia.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   Restaurar register_entry desde 0044, confirm_delivery desde 0025 y
--   register_distributor_purchases desde 0037.
--   DROP FUNCTION IF EXISTS public.set_my_margin(numeric);
--   DROP FUNCTION IF EXISTS public.internal_sale_price_from_cost(numeric, numeric);
--   DROP FUNCTION IF EXISTS public.internal_user_margin_pct(uuid);
--   ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_default_margin_pct_check;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS default_margin_pct;
