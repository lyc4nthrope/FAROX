-- ============================================================================
-- FAROX — 0046: margen por producto y costo manual.
--
-- PROBLEMA
--   Un solo margen por usuario no alcanza: cada producto gana distinto. Y un
--   costo aprendido de una compra no debe pisar el que el dueño cargó a mano.
--
-- DISEÑO
--   · Margen GENERAL en users.default_margin_pct (0045) + EXCEPCIÓN por
--     producto: store_product_margins (tienda) y distributor_products.margin_pct
--     (distribuidora). La excepción manda; 0 = no sugerir para ese producto.
--   · Origen del costo en store_product_prices.source (manual/movement/delivery)
--     y distributor_products.purchase_price_source (manual/movement).
--     Manual NUNCA se pisa. Aprendido se refresca con la última compra/entrega.
--   · Las escrituras manuales (update_store_product_full, set_store_prices_bulk,
--     update_distributor_product_relation) marcan 'manual'.
--   · La sugerencia de venta usa la excepción del producto si existe, si no el
--     margen general del actor (misma regla que 0045).
--
-- COMPATIBILIDAD
--   Se reemplazan register_entry, confirm_delivery, register_distributor_purchases,
--   update_store_product_full, set_store_prices_bulk y
--   update_distributor_product_relation conservando firmas y validaciones.
--   Columnas nuevas con default seguro: las filas existentes quedan 'manual'.
-- ============================================================================

-- ============================================================================
-- 1. Tabla del margen por tienda×producto (privada: el distribuidor no la lee).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.store_product_margins (
  store_id    bigint NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  product_id  bigint NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  margin_pct  numeric(6,2) NOT NULL CHECK (margin_pct >= 0 AND margin_pct <= 1000),
  created_by  uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, product_id)
);

ALTER TABLE public.store_product_margins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_product_margins_select ON public.store_product_margins;
CREATE POLICY store_product_margins_select ON public.store_product_margins
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids())));

REVOKE ALL ON public.store_product_margins FROM authenticated, anon;
GRANT SELECT ON public.store_product_margins TO authenticated;

DROP TRIGGER IF EXISTS trg_store_product_margins_updated_at ON public.store_product_margins;
CREATE TRIGGER trg_store_product_margins_updated_at
BEFORE UPDATE ON public.store_product_margins FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- 2. Columnas nuevas.
-- ============================================================================
ALTER TABLE public.distributor_products ADD COLUMN IF NOT EXISTS margin_pct numeric(6,2) NULL;
ALTER TABLE public.distributor_products ADD COLUMN IF NOT EXISTS purchase_price_source text NULL;
ALTER TABLE public.store_product_prices ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.distributor_products
  DROP CONSTRAINT IF EXISTS distributor_products_margin_pct_check;
ALTER TABLE public.distributor_products
  ADD CONSTRAINT distributor_products_margin_pct_check
  CHECK (margin_pct IS NULL OR (margin_pct >= 0 AND margin_pct <= 1000));

ALTER TABLE public.distributor_products
  DROP CONSTRAINT IF EXISTS distributor_products_purchase_price_source_check;
ALTER TABLE public.distributor_products
  ADD CONSTRAINT distributor_products_purchase_price_source_check
  CHECK (purchase_price_source IS NULL OR purchase_price_source IN ('manual', 'movement'));

ALTER TABLE public.store_product_prices
  DROP CONSTRAINT IF EXISTS store_product_prices_source_check;
ALTER TABLE public.store_product_prices
  ADD CONSTRAINT store_product_prices_source_check
  CHECK (source IN ('manual', 'movement', 'delivery'));

-- 0048: los costos del distribuidor que ya existían se cargaron a mano O los
-- aprendió `register_distributor_purchases` (0037:249 los escribía con
-- `purchase_price = unit_cost`). El backfill original los marcaba TODOS
-- 'manual' y congelaba para siempre un costo que venía de una compra. Se
-- distingue por evidencia: si existe una compra con ese mismo `unit_cost`, el
-- valor es aprendido y debe seguir refrescándose.
UPDATE public.distributor_products dp
SET purchase_price_source = CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.distributor_purchases x
        WHERE x.distributor_id = dp.distributor_id
          AND x.product_id = dp.product_id
          AND x.unit_cost = dp.purchase_price
      ) THEN 'movement'
      ELSE 'manual'
    END
WHERE dp.purchase_price IS NOT NULL
  AND dp.purchase_price_source IS NULL;

-- ============================================================================
-- 3. RPC del margen por producto.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_store_product_margin(
  p_product bigint, p_store bigint, p_margin numeric(6,2)
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'set_store_product_margin: solo admin/operador';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'set_store_product_margin: tienda fuera del alcance del operador';
  END IF;
  IF NOT public.is_premium() THEN
    RAISE EXCEPTION 'set_store_product_margin: los precios requieren Premium (D7)';
  END IF;
  IF p_margin IS NOT NULL AND (p_margin < 0 OR p_margin > 1000) THEN
    RAISE EXCEPTION 'set_store_product_margin: el margen debe estar entre 0 y 1000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stock s
    WHERE s.store_id = p_store AND s.product_id = p_product
  ) THEN
    RAISE EXCEPTION 'set_store_product_margin: el producto % no está asignado a la tienda %',
      p_product, p_store;
  END IF;
  IF p_margin IS NULL THEN
    DELETE FROM public.store_product_margins
    WHERE store_id = p_store AND product_id = p_product;
    RETURN;
  END IF;
  INSERT INTO public.store_product_margins (store_id, product_id, margin_pct, created_by)
  VALUES (p_store, p_product, p_margin, auth.uid())
  ON CONFLICT (store_id, product_id) DO UPDATE
  SET margin_pct = EXCLUDED.margin_pct,
      updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.set_distributor_product_margin(
  p_product bigint, p_margin numeric(6,2)
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');
  v_dist bigint;
BEGIN
  IF v_role <> 'distribuidor' THEN
    RAISE EXCEPTION 'set_distributor_product_margin: solo distribuidor';
  END IF;
  IF NOT public.is_premium() THEN
    RAISE EXCEPTION 'set_distributor_product_margin: los precios requieren Premium (D7)';
  END IF;
  v_dist := public.my_distributor_id();
  IF v_dist IS NULL THEN
    RAISE EXCEPTION 'set_distributor_product_margin: distribuidora no identificada';
  END IF;
  IF p_margin IS NOT NULL AND (p_margin < 0 OR p_margin > 1000) THEN
    RAISE EXCEPTION 'set_distributor_product_margin: el margen debe estar entre 0 y 1000';
  END IF;
  UPDATE public.distributor_products dp
  SET margin_pct = p_margin,
      updated_at = now()
  WHERE dp.distributor_id = v_dist AND dp.product_id = p_product;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_distributor_product_margin: el producto % no está en tu catálogo',
      p_product;
  END IF;
END;
$$;

-- ============================================================================
-- 4. register_entry — costo aprendido (se refresca si no es manual) + margen
--    del producto o general.
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
  v_margin      numeric(6,2);
  v_sale        numeric(12,2);
  v_restock     boolean;
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

  -- 0044: solo un costo real se aprende; el fallback de venta no es costo.
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

  -- 0046: un costo aprendido se refresca con el último movimiento; uno manual
  -- NO se toca (el WHERE del DO UPDATE lo salta).
  -- 0048: el motivo se evalúa UNA vez y gobierna también la sugerencia de venta.
  v_restock := EXISTS (
    SELECT 1 FROM public.motives m
    WHERE m.id = p_motive_id AND m.name = 'reabastecimiento'
  );

  IF v_fill IS NOT NULL AND v_restock THEN
    INSERT INTO public.store_product_prices (store_id, product_id, purchase_price, created_by, source)
    VALUES (p_store, p_product, v_fill, auth.uid(), 'movement')
    ON CONFLICT (store_id, product_id) DO UPDATE
    SET purchase_price = EXCLUDED.purchase_price,
        source = EXCLUDED.source,
        updated_at = now()
    WHERE public.store_product_prices.source <> 'manual';
  END IF;

  -- 0045/0046: sugerir venta con el margen del producto o el general.
  -- 0048: SOLO en reabastecimiento. 0044:20 promete que merma, ajuste y
  -- devolución no tocan precios; antes esta bloque se ejecutaba para cualquier
  -- motivo y publicaba un precio de venta en un movimiento que no era compra.
  IF v_restock THEN
    SELECT spp.purchase_price INTO v_cost
    FROM public.store_product_prices spp
    WHERE spp.store_id = p_store AND spp.product_id = p_product;

    v_margin := COALESCE(
      (SELECT spm.margin_pct FROM public.store_product_margins spm
       WHERE spm.store_id = p_store AND spm.product_id = p_product),
      public.internal_user_margin_pct(auth.uid()));
    v_sale := public.internal_sale_price_from_cost(v_cost, v_margin);
    IF v_sale IS NOT NULL THEN
      INSERT INTO public.price_publications (product_id, store_id, created_by, price, currency)
      VALUES (p_product, p_store, auth.uid(), v_sale, 'COP')
      ON CONFLICT (store_id, product_id) WHERE is_active DO NOTHING;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- ============================================================================
-- 4-bis. Premium del DUEÑO de la tienda (0048).
--    Escribir el precio de una tienda es un beneficio de esa tienda (D7/S25),
--    no de quien ejecuta la acción. Antes `confirm_delivery` miraba el Premium
--    del distribuidor que entrega: a una tienda que paga le quitaba el
--    autollenado si el distribuidor era free, y a una tienda free le publicaba
--    precios si el distribuidor era Premium.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.internal_store_owner_is_premium(p_store bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.stores s
    JOIN public.users u ON u.id = s.created_by
    JOIN public.roles r ON r.id = u.role_id
    WHERE s.id = p_store
      AND u.is_active
      AND (r.name = 'admin'
           OR (u.premium AND (u.premium_until IS NULL OR u.premium_until > now())))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.internal_store_owner_is_premium(bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_store_owner_is_premium(bigint)
  TO service_role;

-- ============================================================================
-- 5. confirm_delivery — aprende el costo (refresca si no es manual) y sugiere
--    la venta con el margen del producto o el del operador que pidió.
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
  v_qty         numeric(12,3);
  v_st          public.order_item_status;
  v_price       numeric(12,2);
  v_cost        numeric(12,2);
  v_margin      numeric(6,2);
  v_sale        numeric(12,2);
  v_entries     integer      := 0;
  v_entries_val numeric(14,2) := 0;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido inexistente: %', p_order; END IF;
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor' AND o.distributor_id = public.my_distributor_id() THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'confirm_delivery: sin alcance sobre el pedido %', p_order;
  END IF;
  IF o.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'confirm_delivery: el pedido % ya confirmado; estado "%" no admite recepción',
      p_order, o.status;
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'confirm_delivery: items requeridos (array no vacío)';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'confirm_delivery: items requeridos (array no vacío)';
  END IF;
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
  FOR it IN
    SELECT x.product_id, x.received_quantity
    FROM jsonb_to_recordset(p_items) AS x(product_id bigint, received_quantity numeric(12,3))
    ORDER BY x.product_id
  LOOP
    IF it.received_quantity IS NULL OR it.received_quantity < 0 THEN
      RAISE EXCEPTION 'received_quantity inválida (producto %)', it.product_id;
    END IF;
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
    IF v_rq > v_qty THEN
      RAISE EXCEPTION 'confirm_delivery: received_quantity (%) excede la cantidad pedida (%) del producto %',
        v_rq, v_qty, it.product_id;
    END IF;
    IF v_rq > 0 THEN
      PERFORM public.internal_stock_entry('entry', it.product_id, o.store_id, v_rq,
                                          v_motive, p_order, o.distributor_id,
                                          v_price, NULL, auth.uid());

      -- 0048: el Premium que habilita escribir precios es el del dueño de la
      -- tienda (beneficiaria del dato), no el del distribuidor que entrega.
      IF public.internal_store_owner_is_premium(o.store_id)
         AND v_price IS NOT NULL AND v_price > 0 THEN
        INSERT INTO public.store_product_prices (store_id, product_id, purchase_price, created_by, source)
        VALUES (o.store_id, it.product_id, v_price, auth.uid(), 'delivery')
        ON CONFLICT (store_id, product_id) DO UPDATE
        SET purchase_price = EXCLUDED.purchase_price,
            source = EXCLUDED.source,
            updated_at = now()
        WHERE public.store_product_prices.source <> 'manual';

        SELECT spp.purchase_price INTO v_cost
        FROM public.store_product_prices spp
        WHERE spp.store_id = o.store_id AND spp.product_id = it.product_id;

        v_margin := COALESCE(
          (SELECT spm.margin_pct FROM public.store_product_margins spm
           WHERE spm.store_id = o.store_id AND spm.product_id = it.product_id),
          public.internal_user_margin_pct(o.created_by));
        v_sale := public.internal_sale_price_from_cost(v_cost, v_margin);
        IF v_sale IS NOT NULL THEN
          INSERT INTO public.price_publications (product_id, store_id, created_by, price, currency)
          VALUES (it.product_id, o.store_id, auth.uid(), v_sale, 'COP')
          ON CONFLICT (store_id, product_id) WHERE is_active DO NOTHING;
        END IF;
      END IF;

      v_entries     := v_entries + 1;
      v_entries_val := v_entries_val + COALESCE(v_rq * v_price, 0);
    END IF;
  END LOOP;
  IF v_entries > 0 THEN
    PERFORM public.internal_dashboard_upsert(COALESCE(o.distributor_id, 0),
      v_entries, 0, v_entries_val, 0);
  END IF;
  UPDATE public.orders SET status = 'delivered', delivered_at = now()
  WHERE id = p_order AND status <> 'delivered';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_delivery: el pedido % ya confirmado', p_order;
  END IF;
  PERFORM public.internal_alert_resolve('order_late', NULL, NULL, p_order);
END;
$$;

-- ============================================================================
-- 6. register_distributor_purchases — costo manual no se pisa; aprendido se
--    refresca; la venta se sugiere con el margen del producto o el general.
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
        purchase_price = CASE WHEN dp.purchase_price_source = 'manual' THEN dp.purchase_price ELSE v_line.unit_price END,
        purchase_price_source = CASE WHEN dp.purchase_price_source = 'manual' THEN 'manual' ELSE 'movement' END,
        sale_price = CASE WHEN dp.sale_price IS NULL THEN internal_sale_price_from_cost(
          CASE WHEN dp.purchase_price_source = 'manual' THEN dp.purchase_price ELSE v_line.unit_price END,
          COALESCE(dp.margin_pct, public.internal_user_margin_pct(auth.uid()))) ELSE dp.sale_price END,
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
-- 7. update_store_product_full — una edición manual marca el costo 'manual'.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_store_product_full(
  p_product        bigint,
  p_store          bigint,
  p_quantity       numeric(12,3),
  p_threshold      numeric(12,3),
  p_shortage       boolean,
  p_expiry_date    date,
  p_purchase_price numeric(12,2),
  p_sale_price     numeric(12,2)
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role     text := COALESCE(public.my_role(), '');
  v_premium  boolean := public.is_premium();
  v_prev     bigint;
  v_prev_pr  numeric(12,2);
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'update_store_product_full: solo admin/operador';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'update_store_product_full: tienda fuera del alcance del operador';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'update_store_product_full: la cantidad no puede ser negativa';
  END IF;
  IF p_threshold IS NOT NULL AND p_threshold < 0 THEN
    RAISE EXCEPTION 'update_store_product_full: el umbral no puede ser negativo';
  END IF;
  IF p_purchase_price IS NOT NULL AND p_purchase_price <= 0 THEN
    RAISE EXCEPTION 'update_store_product_full: el precio de compra debe ser > 0';
  END IF;
  IF p_sale_price IS NOT NULL AND p_sale_price <= 0 THEN
    RAISE EXCEPTION 'update_store_product_full: el precio de venta debe ser > 0';
  END IF;
  IF NOT v_premium AND (p_purchase_price IS NOT NULL OR p_sale_price IS NOT NULL) THEN
    RAISE EXCEPTION 'update_store_product_full: los precios requieren Premium';
  END IF;

  UPDATE public.stock s
  SET quantity = p_quantity,
      threshold = p_threshold,
      is_shortage = COALESCE(p_shortage, s.is_shortage),
      expiry_date = p_expiry_date,
      updated_at = now()
  WHERE s.store_id = p_store AND s.product_id = p_product;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_store_product_full: el producto % no está asignado a la tienda %',
      p_product, p_store;
  END IF;

  IF v_premium THEN
    IF p_purchase_price IS NULL THEN
      DELETE FROM public.store_product_prices
      WHERE store_id = p_store AND product_id = p_product;
    ELSE
      INSERT INTO public.store_product_prices
        (store_id, product_id, purchase_price, created_by, source)
      VALUES (p_store, p_product, p_purchase_price, auth.uid(), 'manual')
      ON CONFLICT (store_id, product_id) DO UPDATE
      SET purchase_price = EXCLUDED.purchase_price,
          source = CASE
                     WHEN public.store_product_prices.purchase_price IS DISTINCT FROM EXCLUDED.purchase_price
                     THEN 'manual'
                     ELSE public.store_product_prices.source
                   END,
          updated_at = now();
    END IF;

    SELECT id, price INTO v_prev, v_prev_pr
    FROM public.price_publications
    WHERE product_id = p_product AND store_id = p_store AND is_active
    FOR UPDATE;

    IF p_sale_price IS NULL THEN
      IF FOUND THEN
        UPDATE public.price_publications SET is_active = false WHERE id = v_prev;
      END IF;
    ELSIF NOT FOUND OR v_prev_pr IS DISTINCT FROM p_sale_price THEN
      IF FOUND THEN
        UPDATE public.price_publications SET is_active = false WHERE id = v_prev;
      END IF;
      INSERT INTO public.price_publications (product_id, store_id, created_by, price, currency)
      VALUES (p_product, p_store, auth.uid(), p_sale_price, 'COP');
    END IF;
  END IF;

  PERFORM public.internal_eval_stock_alert(p_store, p_product);
END;
$$;

-- ============================================================================
-- 8. set_store_prices_bulk — la carga masiva es una edición manual del costo.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_store_prices_bulk(
  p_store bigint,
  p_lines jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role    text := COALESCE(public.my_role(), '');
  v_line    record;
  v_missing bigint;
  v_prev    bigint;
  v_prev_pr numeric(12,2);
  v_count   integer := 0;
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'set_store_prices_bulk: solo admin/operador';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'set_store_prices_bulk: tienda fuera del alcance del operador';
  END IF;
  IF NOT public.is_premium() THEN
    RAISE EXCEPTION 'set_store_prices_bulk: publicar precios requiere Premium (D7)';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'set_store_prices_bulk: no hay cambios para guardar';
  END IF;
  IF jsonb_array_length(p_lines) > 500 THEN
    RAISE EXCEPTION 'set_store_prices_bulk: máximo 500 productos por guardado';
  END IF;
  -- 0048: product_id ausente no es "producto repetido" (mismo criterio que 0043).
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) AS item
    WHERE COALESCE(item->>'product_id', '') !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'set_store_prices_bulk: cada línea necesita product_id';
  END IF;
  IF (
    SELECT count(DISTINCT (item->>'product_id'))
    FROM jsonb_array_elements(p_lines) AS item
  ) <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'set_store_prices_bulk: producto repetido en el lote';
  END IF;

  -- 0048: una sola consulta para el lote y orden de lock estable.
  SELECT x.product_id INTO v_missing
  FROM jsonb_to_recordset(p_lines) AS x(product_id bigint)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.stock s
    WHERE s.store_id = p_store AND s.product_id = x.product_id
  )
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'set_store_prices_bulk: el producto % no está asignado a la tienda %',
      v_missing, p_store;
  END IF;

  FOR v_line IN
    SELECT * FROM jsonb_to_recordset(p_lines)
      AS x(product_id bigint, purchase_price numeric(12,2), sale_price numeric(12,2),
           set_purchase boolean, set_sale boolean)
    ORDER BY x.product_id
  LOOP
    IF v_line.product_id IS NULL THEN
      RAISE EXCEPTION 'set_store_prices_bulk: producto requerido';
    END IF;
    IF COALESCE(v_line.set_purchase, false) = false
       AND COALESCE(v_line.set_sale, false) = false THEN
      RAISE EXCEPTION 'set_store_prices_bulk: la fila del producto % no indica qué precio escribir',
        v_line.product_id;
    END IF;
    IF v_line.set_purchase
       AND v_line.purchase_price IS NOT NULL AND v_line.purchase_price <= 0 THEN
      RAISE EXCEPTION 'set_store_prices_bulk: el precio de compra debe ser > 0';
    END IF;
    IF v_line.set_sale
       AND v_line.sale_price IS NOT NULL AND v_line.sale_price <= 0 THEN
      RAISE EXCEPTION 'set_store_prices_bulk: el precio de venta debe ser > 0';
    END IF;

    IF COALESCE(v_line.set_purchase, false) THEN
      IF v_line.purchase_price IS NULL THEN
        DELETE FROM public.store_product_prices
        WHERE store_id = p_store AND product_id = v_line.product_id;
      ELSE
        INSERT INTO public.store_product_prices
          (store_id, product_id, purchase_price, created_by, source)
        VALUES (p_store, v_line.product_id, v_line.purchase_price, auth.uid(), 'manual')
        ON CONFLICT (store_id, product_id) DO UPDATE
        SET purchase_price = EXCLUDED.purchase_price,
            source = CASE
                       WHEN public.store_product_prices.purchase_price IS DISTINCT FROM EXCLUDED.purchase_price
                       THEN 'manual'
                       ELSE public.store_product_prices.source
                     END,
            updated_at = now();
      END IF;
    END IF;

    IF COALESCE(v_line.set_sale, false) THEN
      SELECT id, price INTO v_prev, v_prev_pr
      FROM public.price_publications
      WHERE product_id = v_line.product_id AND store_id = p_store AND is_active
      FOR UPDATE;

      IF v_line.sale_price IS NULL THEN
        IF FOUND THEN
          UPDATE public.price_publications SET is_active = false WHERE id = v_prev;
        END IF;
      ELSIF NOT FOUND OR v_prev_pr IS DISTINCT FROM v_line.sale_price THEN
        IF FOUND THEN
          UPDATE public.price_publications SET is_active = false WHERE id = v_prev;
        END IF;
        INSERT INTO public.price_publications (product_id, store_id, created_by, price, currency)
        VALUES (v_line.product_id, p_store, auth.uid(), v_line.sale_price, 'COP');
      END IF;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 9. update_distributor_product_relation — una edición manual marca 'manual'.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_distributor_product_relation(
  p_product        bigint,
  p_quantity       numeric(12,3),
  p_threshold      numeric(12,3),
  p_expiry_date    date,
  p_purchase_price numeric(12,2),
  p_sale_price     numeric(12,2)
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role    text := COALESCE(public.my_role(), '');
  v_premium boolean := public.is_premium();
  v_dist    bigint;
BEGIN
  IF v_role <> 'distribuidor' THEN
    RAISE EXCEPTION 'update_distributor_product_relation: solo distribuidor';
  END IF;
  v_dist := public.my_distributor_id();
  IF v_dist IS NULL THEN
    RAISE EXCEPTION 'update_distributor_product_relation: distribuidora no identificada';
  END IF;
  IF p_product IS NULL THEN
    RAISE EXCEPTION 'update_distributor_product_relation: producto requerido';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'update_distributor_product_relation: la cantidad no puede ser negativa';
  END IF;
  IF p_threshold IS NOT NULL AND p_threshold < 0 THEN
    RAISE EXCEPTION 'update_distributor_product_relation: el umbral no puede ser negativo';
  END IF;
  IF p_purchase_price IS NOT NULL AND p_purchase_price <= 0 THEN
    RAISE EXCEPTION 'update_distributor_product_relation: el precio de compra debe ser > 0';
  END IF;
  IF p_sale_price IS NOT NULL AND p_sale_price <= 0 THEN
    RAISE EXCEPTION 'update_distributor_product_relation: el precio de venta debe ser > 0';
  END IF;
  IF NOT v_premium AND (p_purchase_price IS NOT NULL OR p_sale_price IS NOT NULL) THEN
    RAISE EXCEPTION 'update_distributor_product_relation: los precios requieren Premium';
  END IF;

  UPDATE public.distributor_products dp
  SET quantity = p_quantity,
      threshold = p_threshold,
      expiry_date = p_expiry_date,
      purchase_price = CASE WHEN v_premium THEN p_purchase_price ELSE dp.purchase_price END,
      purchase_price_source = CASE WHEN NOT v_premium THEN dp.purchase_price_source WHEN p_purchase_price IS NULL THEN NULL WHEN dp.purchase_price IS DISTINCT FROM p_purchase_price THEN 'manual' ELSE dp.purchase_price_source END,
      sale_price = CASE WHEN v_premium THEN p_sale_price ELSE dp.sale_price END,
      updated_at = now()
  WHERE dp.distributor_id = v_dist AND dp.product_id = p_product;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_distributor_product_relation: el producto % no está en tu catálogo',
      p_product;
  END IF;

  PERFORM public.internal_eval_distributor_alert(v_dist, p_product);
END;
$$;

-- ============================================================================
-- 10. Grants de las firmas nuevas.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.set_store_product_margin(bigint, bigint, numeric),
  public.set_distributor_product_margin(bigint, numeric)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.set_store_product_margin(bigint, bigint, numeric),
  public.set_distributor_product_margin(bigint, numeric)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · set_store_product_margin(50) ⇒ la excepción manda sobre el margen general.
--   · Margen 0 en un producto ⇒ no se sugiere venta para ese producto.
--   · Una entrada con costo aprendido y luego otra con otro costo ⇒ el costo
--     se actualiza (no era manual).
--   · Editar el costo en la ficha (manual) y luego registrar una entrada con
--     otro costo ⇒ el costo manual NO cambia.
--   · Una entrega de pedido refresca el costo aprendido y respeta el manual.
--   · Compra del distribuidor con costo manual ⇒ el costo no cambia.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   Restaurar las 6 funciones desde 0045/0043/0030.
--   DROP FUNCTION IF EXISTS public.set_store_product_margin(bigint, bigint, numeric);
--   DROP FUNCTION IF EXISTS public.set_distributor_product_margin(bigint, numeric);
--   DROP TABLE IF EXISTS public.store_product_margins;
--   ALTER TABLE public.distributor_products DROP COLUMN IF EXISTS margin_pct;
--   ALTER TABLE public.distributor_products DROP COLUMN IF EXISTS purchase_price_source;
--   ALTER TABLE public.store_product_prices DROP COLUMN IF EXISTS source;
