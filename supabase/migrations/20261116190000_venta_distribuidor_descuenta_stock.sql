-- ============================================================================
-- FAROX — 20261116190000: la venta del distribuidor descuenta su inventario (0055).
--
--   register_distributor_sale sumaba el stock a la tienda pero nunca restaba
--   de distributor_products; las compras (register_distributor_purchases) sí
--   sumaban, así que el inventario del distribuidor solo podía crecer.
--   Ahora:
--     · bloquea la fila del producto (FOR UPDATE) y rechaza la venta si no hay
--       stock suficiente, con el disponible en el mensaje;
--     · descuenta la cantidad y re-evalúa la alerta de stock bajo.
--   register_distributor_sales_bulk llama a esta función por línea, así que un
--   ticket que no alcanza se revierte completo (una sola transacción).
--
--   Cada venta queda marcada (movements.decrements_distributor_stock) para que
--   register_reverse devuelva las unidades al distribuidor. Las ventas previas a
--   0055 nunca descontaron: su reverso no toca distributor_products.
--
--   Re-ejecutable: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE (conserva los
--   GRANT de 0029 y 0011).
--   Rollback: restaurar register_distributor_sale desde
--   20261029000029_entregas_ventas_y_contacto.sql, register_reverse desde
--   20261016000011_seguridad.sql y quitar la columna.
-- ============================================================================

ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS decrements_distributor_stock boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.movements.decrements_distributor_stock IS
  '0055: la venta descontó distributor_products; su reverso devuelve las unidades.';

CREATE OR REPLACE FUNCTION public.register_distributor_sale(
  p_product bigint, p_store bigint, p_qty numeric(12,3),
  p_unit_price numeric(12,2), p_expiry_date date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role   text := COALESCE(public.my_role(), '');
  v_dist   bigint;
  v_motive bigint;
  v_id     bigint;
  v_avail  numeric(12,3);
BEGIN
  IF v_role <> 'distribuidor' THEN
    RAISE EXCEPTION 'register_distributor_sale: solo distribuidor';
  END IF;
  IF NOT public.is_premium() THEN
    RAISE EXCEPTION 'register_distributor_sale: requiere Premium';
  END IF;
  v_dist := public.my_distributor_id();
  IF v_dist IS NULL THEN
    RAISE EXCEPTION 'register_distributor_sale: distribuidora no identificada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.store_distributors sd
    WHERE sd.store_id = p_store AND sd.distributor_id = v_dist
  ) THEN
    RAISE EXCEPTION 'register_distributor_sale: la tienda % no está vinculada', p_store;
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'register_distributor_sale: quantity debe ser > 0';
  END IF;
  -- 0055: FOR UPDATE serializa ventas simultáneas del mismo producto; sin el
  -- lock, dos ventas podían leer el mismo saldo y vender de más.
  SELECT dp.quantity INTO v_avail
  FROM public.distributor_products dp
  JOIN public.products p ON p.id = dp.product_id AND p.is_active
  WHERE dp.distributor_id = v_dist AND dp.product_id = p_product
  FOR UPDATE OF dp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_distributor_sale: el producto % no está en tu catálogo', p_product;
  END IF;
  IF v_avail < p_qty THEN
    RAISE EXCEPTION 'register_distributor_sale: stock insuficiente: hay % disponibles y se intentó vender %',
      trim_scale(v_avail), trim_scale(p_qty);
  END IF;
  IF p_unit_price IS NULL OR p_unit_price <= 0 THEN
    RAISE EXCEPTION 'register_distributor_sale: el precio de venta debe ser > 0';
  END IF;
  SELECT id INTO v_motive FROM public.motives WHERE name = 'venta';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_distributor_sale: motivo "venta" sin sembrado';
  END IF;
  v_id := public.internal_stock_entry('entry', p_product, p_store, p_qty,
                                      v_motive, NULL, v_dist, p_unit_price,
                                      p_expiry_date, auth.uid());
  UPDATE public.distributor_products dp
  SET quantity = dp.quantity - p_qty, updated_at = now()
  WHERE dp.distributor_id = v_dist AND dp.product_id = p_product;
  UPDATE public.movements SET decrements_distributor_stock = true WHERE id = v_id;
  PERFORM public.internal_eval_distributor_alert(v_dist, p_product);
  PERFORM public.internal_dashboard_upsert(v_dist, 1, 0, p_qty * p_unit_price, 0);
  RETURN v_id;
END;
$$;

-- register_reverse (0011) + devolución al distribuidor.
CREATE OR REPLACE FUNCTION public.register_reverse(
  p_movement_id bigint, p_reason text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  m     public.movements%ROWTYPE;
  v_opp public.movement_type;
  v_id  bigint;
BEGIN
  PERFORM public.assert_admin();  -- D-4
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
  v_opp := CASE m.type WHEN 'entry' THEN 'exit'::public.movement_type ELSE 'entry'::public.movement_type END;
  -- stock opuesto + alertas, atómico (entry ⇒ decrementa con guard; exit ⇒ suma)
  v_id := public.internal_stock_entry(v_opp, m.product_id, m.store_id, m.quantity,
                                      m.motive_id, m.order_id, m.distributor_id,
                                      m.unit_price, NULL, auth.uid(), p_movement_id);
  -- 0055: la venta descontó al distribuidor; el reverso le devuelve las unidades.
  IF m.decrements_distributor_stock THEN
    UPDATE public.distributor_products dp
    SET quantity = dp.quantity + m.quantity, updated_at = now()
    WHERE dp.distributor_id = m.distributor_id AND dp.product_id = m.product_id;
    PERFORM public.internal_eval_distributor_alert(m.distributor_id, m.product_id);
  END IF;
  -- dashboard: re-evalúa restando la contribución original (clampa en 0)
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
