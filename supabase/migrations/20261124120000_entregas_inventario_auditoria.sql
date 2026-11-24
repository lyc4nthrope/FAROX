-- ============================================================================
-- FAROX — 20261124120000: integridad de entregas e inventario (0060).
--
--   Lote 2 de la auditoría funcional 2026-11-18.
--
--   1. confirm_delivery descuenta distributor_products con guard FOR UPDATE,
--      rechaza la entrega si el distribuidor no tiene stock suficiente y marca
--      el movimiento (decrements_distributor_stock) para un futuro reverso de
--      pedido. La tienda sigue recibiendo su entrada como antes.
--   2. has_shortage cuenta NULL como 0 y se recalcula al confirmar la entrega:
--      una línea omitida en p_items ya no se muestra como entrega completa.
--   3. create_credit usa el precio activo de la tienda como último fallback y
--      falla con mensaje claro si una línea recibida no tiene ningún precio,
--      en vez de subfacturar en silencio.
--   4. update_order_status bloquea cambios sobre pedidos delivered/cancelled.
--   5. register_reverse bloquea revertir movimientos de un pedido: un reverso
--      de fila desincroniza pedido, stock y fiado; se corregirá desde el pedido.
--
--   Re-ejecutable: CREATE OR REPLACE + backfill idempotente.
--   Rollback: restaurar las 5 funciones desde 0058/0046/0028/0011.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. has_shortage: NULL cuenta como no entregado (solo en pedidos delivered)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.internal_set_order_shortage()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.orders o
  SET has_shortage = CASE
    WHEN o.status = 'delivered' THEN EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id = NEW.order_id
        AND COALESCE(oi.received_quantity, 0) < oi.quantity
    )
    ELSE false
  END
  WHERE o.id = NEW.order_id;
  RETURN NEW;
END;
$$;

UPDATE public.orders o
SET has_shortage = EXISTS (
  SELECT 1
  FROM public.order_items oi
  WHERE oi.order_id = o.id
    AND COALESCE(oi.received_quantity, 0) < oi.quantity
)
WHERE o.status = 'delivered';

-- ----------------------------------------------------------------------------
-- 2. confirm_delivery: descuenta el stock del distribuidor
-- ----------------------------------------------------------------------------
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
  v_dist_qty    numeric(12,3);
  v_movement    bigint;
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
      -- El stock del distribuidor se descuenta antes de sumar a la tienda.
      -- Si la fila no existe o no alcanza, la entrega no se registra.
      IF o.distributor_id IS NOT NULL THEN
        SELECT dp.quantity INTO v_dist_qty
        FROM public.distributor_products dp
        WHERE dp.distributor_id = o.distributor_id AND dp.product_id = it.product_id
        FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'confirm_delivery: el producto % no está en el catálogo del distribuidor para la entrega',
            it.product_id;
        END IF;
        IF v_dist_qty < v_rq THEN
          RAISE EXCEPTION 'confirm_delivery: stock insuficiente del distribuidor para el producto % (hay %, se entregan %)',
            it.product_id, v_dist_qty, v_rq;
        END IF;
        UPDATE public.distributor_products
        SET quantity = quantity - v_rq, updated_at = now()
        WHERE distributor_id = o.distributor_id AND product_id = it.product_id;
      END IF;

      v_movement := public.internal_stock_entry('entry', it.product_id, o.store_id, v_rq,
                                                v_motive, p_order, o.distributor_id,
                                                v_price, NULL, auth.uid());
      IF o.distributor_id IS NOT NULL THEN
        UPDATE public.movements
        SET decrements_distributor_stock = true
        WHERE id = v_movement;
      END IF;

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
  UPDATE public.orders
  SET status = 'delivered',
      delivered_at = now(),
      has_shortage = EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.order_id = p_order
          AND COALESCE(oi.received_quantity, 0) < oi.quantity
      )
  WHERE id = p_order AND status <> 'delivered';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_delivery: el pedido % ya confirmado', p_order;
  END IF;
  PERFORM public.internal_alert_resolve('order_late', NULL, NULL, p_order);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. create_credit: precio activo de la tienda como fallback + error claro
-- ----------------------------------------------------------------------------
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
  IF EXISTS (
    SELECT 1
    FROM public.order_items oi
    LEFT JOIN public.price_publications pp
      ON pp.store_id = v_store AND pp.product_id = oi.product_id AND pp.is_active
    WHERE oi.order_id = p_order
      AND COALESCE(oi.received_quantity, 0) > 0
      AND COALESCE(oi.distributor_price, oi.unit_price, pp.price) IS NULL
  ) THEN
    RAISE EXCEPTION 'create_credit: hay líneas entregadas sin precio; asigná un precio a la tienda o cotizá el pedido antes de fiar';
  END IF;
  SELECT COALESCE(sum(COALESCE(oi.distributor_price, oi.unit_price, pp.price)
                      * COALESCE(oi.received_quantity, 0)), 0)
  INTO v_total
  FROM public.order_items oi
  LEFT JOIN public.price_publications pp
    ON pp.store_id = v_store AND pp.product_id = oi.product_id AND pp.is_active
  WHERE oi.order_id = p_order;
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

-- ----------------------------------------------------------------------------
-- 4. update_order_status: pedidos cerrados no admiten cambios
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order bigint, p_status public.order_status, p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := public.my_role();
  o      public.orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido inexistente: %', p_order; END IF;
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor' AND o.distributor_id = public.my_distributor_id() THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'update_order_status: sin alcance sobre el pedido %', p_order;
  END IF;
  IF o.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'update_order_status: el pedido % ya está %; no admite cambios', p_order, o.status;
  END IF;
  IF p_status = 'delivered' THEN
    RAISE EXCEPTION 'delivered solo se registra con confirm_delivery()';
  END IF;
  IF p_status = 'cancelled' THEN
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'A7: cancelar pedido es solo admin';
    END IF;
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
      RAISE EXCEPTION 'cancelar exige reason';
    END IF;
    UPDATE public.orders
    SET status = 'cancelled', cancelled_at = now(), cancelled_reason = p_reason
    WHERE id = p_order;
    PERFORM public.internal_alert_resolve('order_late', NULL, NULL, p_order);
  ELSIF o.status = 'pending' AND p_status = 'in_route' THEN
    UPDATE public.orders SET status = p_status WHERE id = p_order;
  ELSIF o.status = 'in_route' AND p_status = 'pending' THEN
    UPDATE public.orders SET status = 'pending' WHERE id = p_order;
  ELSE
    RAISE EXCEPTION 'transición inválida: % → %', o.status, p_status;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. register_reverse: los movimientos de pedido no se revierten por fila
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_reverse(
  p_movement_id bigint, p_reason text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  m     public.movements%ROWTYPE;
  v_opp public.movement_type;
  v_id  bigint;
BEGIN
  PERFORM public.assert_admin();
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'register_reverse: reason requerido';
  END IF;
  SELECT * INTO m FROM public.movements WHERE id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'movimiento inexistente: %', p_movement_id; END IF;
  IF m.reverso_of_id IS NOT NULL THEN
    RAISE EXCEPTION 'D31: reverso-de-reverso prohibido (movimiento % ya es un reverso)', p_movement_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.movements mv WHERE mv.reverso_of_id = p_movement_id) THEN
    RAISE EXCEPTION 'D31: el movimiento % ya tiene reverso', p_movement_id;
  END IF;
  IF m.order_id IS NOT NULL THEN
    RAISE EXCEPTION 'register_reverse: el movimiento % pertenece al pedido %; corregilo desde el pedido',
      p_movement_id, m.order_id;
  END IF;
  v_opp := CASE m.type WHEN 'entry' THEN 'exit'::public.movement_type ELSE 'entry'::public.movement_type END;
  v_id := public.internal_stock_entry(v_opp, m.product_id, m.store_id, m.quantity,
                                      m.motive_id, m.order_id, m.distributor_id,
                                      m.unit_price, NULL, auth.uid(), p_movement_id);
  IF m.type = 'entry' THEN
    PERFORM public.internal_dashboard_upsert(COALESCE(m.distributor_id, 0), -1, 0,
      CASE WHEN m.unit_price IS NULL THEN 0 ELSE m.quantity * m.unit_price END, 0);
  ELSE
    PERFORM public.internal_dashboard_upsert(COALESCE(m.distributor_id, 0), 0, -1, 0,
      CASE WHEN m.unit_price IS NULL THEN 0 ELSE m.quantity * m.unit_price END);
  END IF;
  INSERT INTO public.audit_log (created_by, table_name, action, row_id, diff)
  VALUES (auth.uid(), 'movements', 'update', p_movement_id::text,
          jsonb_build_object('reverso_of_id', v_id, 'reason', p_reason));
  RETURN v_id;
END;
$$;
