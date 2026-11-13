-- ============================================================================
-- FAROX — 0031: alertas notificables del distribuidor (stock y caducidad).
--
--   · El distribuidor tiene su propia cantidad/umbral/vencimiento en
--     distributor_products (0030). Esta migración los materializa en `alerts`
--     con distributor_id y store_id NULL, para que /alertas y el badge del nav
--     los muestren igual que las alertas de tienda.
--   · stock_low del distribuidor es OPT-IN: solo alerta si configuró umbral.
--     (La cantidad arranca en 0; alertar sin umbral inundaría el catálogo.)
--   · expiry_soon se evalúa al guardar la relación y en un job diario.
--   · El índice de episodios abiertos incluye distributor_id para que dos
--     distribuidores con el mismo producto no colisionen.
-- ============================================================================

-- ============================================================================
-- 1. Dedup por episodio: incluir distributor_id.
-- ============================================================================
DROP INDEX IF EXISTS public.uq_alert_open;
CREATE UNIQUE INDEX uq_alert_open
  ON public.alerts (
    type,
    coalesce(store_id, 0),
    coalesce(product_id, 0),
    coalesce(order_id, 0),
    coalesce(distributor_id, 0)
  )
  WHERE resolved_at IS NULL;

-- ============================================================================
-- 2. internal_alert_open — mismo target que el índice nuevo.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.internal_alert_open(
  p_type        public.alert_type,
  p_store_id    bigint,
  p_product_id  bigint,
  p_order_id    bigint,
  p_distributor_id bigint,
  p_message     text,
  p_context     jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.alerts (type, store_id, product_id, order_id, distributor_id, message, context)
  VALUES (p_type, p_store_id, p_product_id, p_order_id, p_distributor_id, p_message, p_context)
  ON CONFLICT (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0),
               coalesce(distributor_id,0))
  WHERE resolved_at IS NULL
  DO NOTHING;
END;
$$;

-- ============================================================================
-- 3. Resolver y evaluador de alertas del distribuidor.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.internal_alert_resolve_distributor(
  p_type public.alert_type,
  p_distributor bigint,
  p_product bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.alerts
  SET resolved_at = now()
  WHERE type = p_type
    AND resolved_at IS NULL
    AND distributor_id = p_distributor
    AND product_id = p_product
    AND store_id IS NULL
    AND order_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.internal_eval_distributor_alert(
  p_distributor bigint,
  p_product     bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_qty  numeric(12,3);
  v_thr  numeric(12,3);
  v_exp  date;
  v_name text;
  v_msg  text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.distributors d
    WHERE d.id = p_distributor AND d.is_active
  ) THEN
    PERFORM public.internal_alert_resolve_distributor('stock_low', p_distributor, p_product);
    PERFORM public.internal_alert_resolve_distributor('expiry_soon', p_distributor, p_product);
    RETURN;
  END IF;

  SELECT dp.quantity, dp.threshold, dp.expiry_date, p.name
    INTO v_qty, v_thr, v_exp, v_name
  FROM public.distributor_products dp
  JOIN public.products p ON p.id = dp.product_id
  WHERE dp.distributor_id = p_distributor AND dp.product_id = p_product;

  IF NOT FOUND THEN
    PERFORM public.internal_alert_resolve_distributor('stock_low', p_distributor, p_product);
    PERFORM public.internal_alert_resolve_distributor('expiry_soon', p_distributor, p_product);
    RETURN;
  END IF;

  -- stock_low: solo si hay umbral configurado (opt-in).
  IF v_thr IS NOT NULL AND v_qty <= v_thr THEN
    v_msg := v_name || ' en tu catálogo: ' ||
             CASE WHEN v_qty = 0
                  THEN 'sin stock'
                  ELSE v_qty::text || ' <= umbral ' || v_thr::text
             END;
    PERFORM public.internal_alert_open('stock_low', NULL, p_product, NULL, p_distributor,
      v_msg, jsonb_build_object('quantity', v_qty, 'threshold', v_thr));
  ELSE
    PERFORM public.internal_alert_resolve_distributor('stock_low', p_distributor, p_product);
  END IF;

  -- expiry_soon: mismo horizonte de 15 días que la tienda.
  IF v_exp IS NOT NULL AND v_qty > 0 AND v_exp <= CURRENT_DATE + 15 THEN
    v_msg := v_name || ' en tu catálogo: caduca el ' || v_exp ||
             ' (' || (v_exp - CURRENT_DATE) || ' días)';
    PERFORM public.internal_alert_open('expiry_soon', NULL, p_product, NULL, p_distributor,
      v_msg, jsonb_build_object('quantity', v_qty, 'dias_restantes', v_exp - CURRENT_DATE));
  ELSE
    PERFORM public.internal_alert_resolve_distributor('expiry_soon', p_distributor, p_product);
  END IF;
END;
$$;

-- ============================================================================
-- 4. Job diario de caducidad del distribuidor.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.job_scan_distributor_expiry() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  c CONSTANT integer := 15;
BEGIN
  INSERT INTO public.alerts (type, product_id, distributor_id, message, context)
  SELECT 'expiry_soon', dp.product_id, dp.distributor_id,
         p.name || ' en tu catálogo: caduca el ' || dp.expiry_date ||
         ' (' || (dp.expiry_date - CURRENT_DATE) || ' días)',
         jsonb_build_object('quantity', dp.quantity,
                            'dias_restantes', dp.expiry_date - CURRENT_DATE)
  FROM public.distributor_products dp
  JOIN public.distributors d ON d.id = dp.distributor_id AND d.is_active
  JOIN public.products p ON p.id = dp.product_id
  WHERE dp.expiry_date <= CURRENT_DATE + c AND dp.quantity > 0
  ON CONFLICT (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0),
               coalesce(distributor_id,0))
  WHERE resolved_at IS NULL
  DO NOTHING;

  UPDATE public.alerts a
  SET resolved_at = now()
  WHERE a.type = 'expiry_soon'
    AND a.resolved_at IS NULL
    AND a.store_id IS NULL
    AND a.distributor_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.distributor_products dp
      WHERE dp.distributor_id = a.distributor_id
        AND dp.product_id = a.product_id
        AND dp.expiry_date <= CURRENT_DATE + c
        AND dp.quantity > 0);

  -- Un distribuidor inactivo no conserva alertas abiertas (stock o caducidad).
  UPDATE public.alerts a
  SET resolved_at = now()
  WHERE a.resolved_at IS NULL
    AND a.store_id IS NULL
    AND a.distributor_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.distributors d
      WHERE d.id = a.distributor_id AND d.is_active);
END;
$$;

-- ============================================================================
-- 5. Los jobs existentes deben usar el target nuevo. Además, el cierre de
--    caducidad de tienda NO debe resolver alertas de distribuidor (store NULL).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.job_scan_expiry_soon() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  c CONSTANT integer := 15;
BEGIN
  INSERT INTO public.alerts (type, store_id, product_id, message, context)
  SELECT 'expiry_soon', s.store_id, s.product_id,
         p.name || ' en ' || st.name || ': caduca el ' || s.expiry_date ||
         ' (' || (s.expiry_date - CURRENT_DATE) || ' días)',
         jsonb_build_object('quantity', s.quantity, 'dias_restantes', s.expiry_date - CURRENT_DATE)
  FROM public.stock s
  JOIN public.products p ON p.id = s.product_id
  JOIN public.stores  st ON st.id = s.store_id
  WHERE s.expiry_date <= CURRENT_DATE + c AND s.quantity > 0
  ON CONFLICT (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0),
               coalesce(distributor_id,0))
  WHERE resolved_at IS NULL
  DO NOTHING;

  UPDATE public.alerts a
  SET resolved_at = now()
  WHERE a.type = 'expiry_soon'
    AND a.resolved_at IS NULL
    AND a.store_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.stock s
      WHERE s.store_id = a.store_id AND s.product_id = a.product_id
        AND s.expiry_date <= CURRENT_DATE + c AND s.quantity > 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.job_scan_order_late() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.alerts (type, store_id, order_id, distributor_id, message, context)
  SELECT 'order_late', o.store_id, o.id, o.distributor_id,
         'Pedido #' || o.id || ' atrasado (esperado ' || o.expected_at || ')',
         jsonb_build_object('esperado', o.expected_at)
  FROM public.orders o
  WHERE o.expected_at < now() AND o.delivered_at IS NULL
    AND o.status NOT IN ('delivered', 'cancelled')
  ON CONFLICT (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0),
               coalesce(distributor_id,0))
  WHERE resolved_at IS NULL
  DO NOTHING;

  UPDATE public.alerts a
  SET resolved_at = now()
  WHERE a.type = 'order_late' AND a.resolved_at IS NULL
    AND EXISTS (SELECT 1 FROM public.orders o
                 WHERE o.id = a.order_id
                   AND (o.delivered_at IS NOT NULL OR o.status IN ('delivered', 'cancelled')));
END;
$$;

CREATE OR REPLACE FUNCTION public.job_scan_credit_overdue() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.alerts (type, store_id, order_id, distributor_id, message, context)
  SELECT 'credit_overdue', c.store_id, c.order_id, o.distributor_id,
         'Crédito del pedido #' || c.order_id || ' vencido desde ' || c.due_date ||
         ' (saldo ' || c.balance || ')',
         jsonb_build_object('monto', c.balance, 'vence', c.due_date)
  FROM public.credits c
  LEFT JOIN public.orders o ON o.id = c.order_id
  WHERE c.due_date < CURRENT_DATE AND c.balance > 0 AND c.status <> 'cancelled'
  ON CONFLICT (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0),
               coalesce(distributor_id,0))
  WHERE resolved_at IS NULL
  DO NOTHING;

  UPDATE public.alerts a
  SET resolved_at = now()
  WHERE a.type = 'credit_overdue' AND a.resolved_at IS NULL
    AND EXISTS (SELECT 1 FROM public.credits c
                 WHERE c.order_id = a.order_id
                   AND (c.balance = 0 OR c.status = 'cancelled'));
END;
$$;

-- ============================================================================
-- 6. Guardar la relación evalúa ambas alertas; quitarla las cierra.
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

CREATE OR REPLACE FUNCTION public.remove_distributor_product(p_product bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_dist bigint := public.my_distributor_id();
BEGIN
  IF public.my_role() IS DISTINCT FROM 'distribuidor' OR v_dist IS NULL THEN
    RAISE EXCEPTION 'catalogo: solo un distribuidor activo puede quitar productos';
  END IF;
  PERFORM public.internal_alert_resolve_distributor('stock_low', v_dist, p_product);
  PERFORM public.internal_alert_resolve_distributor('expiry_soon', v_dist, p_product);
  DELETE FROM public.distributor_products
  WHERE distributor_id = v_dist AND product_id = p_product;
END;
$$;

-- ============================================================================
-- 7. Grants y cron.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.internal_alert_resolve_distributor(public.alert_type, bigint, bigint),
  public.internal_eval_distributor_alert(bigint, bigint),
  public.job_scan_distributor_expiry()
FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'farox_distributor_expiry') THEN
    PERFORM cron.unschedule('farox_distributor_expiry');
  END IF;
END $$;
SELECT cron.schedule('farox_distributor_expiry', '0 11 * * *',
  $$SELECT public.job_scan_distributor_expiry();$$);

-- ============================================================================
-- Verificación manual (SQL editor):
--   · Distribuidor con cantidad 4 y umbral 5 ⇒ alerta stock_low en /alertas;
--     subir la cantidad a 10 ⇒ la alerta se resuelve.
--   · Vencimiento dentro de 15 días con cantidad > 0 ⇒ expiry_soon; moverlo
--     lejos o dejar cantidad 0 ⇒ se resuelve. El job diario cubre el paso del
--     tiempo. Dos distribuidores con el mismo producto no colisionan.
--   · Quitar el producto del catálogo ⇒ sus alertas de distribuidor se cierran.
--   · Las alertas de tienda siguen abriéndose/cerrándose igual que antes.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   SELECT cron.unschedule('farox_distributor_expiry');
--   DROP FUNCTION IF EXISTS public.job_scan_distributor_expiry();
--   DROP FUNCTION IF EXISTS public.internal_eval_distributor_alert(bigint, bigint);
--   DROP FUNCTION IF EXISTS public.internal_alert_resolve_distributor(public.alert_type, bigint, bigint);
--   Restaurar internal_alert_open y los 3 job_scan_* desde 0004 (target sin distributor_id).
--   Restaurar update_distributor_product_relation desde 0030 y remove_distributor_product desde 0019.
--   DROP INDEX IF EXISTS public.uq_alert_open;
--   CREATE UNIQUE INDEX uq_alert_open
--     ON public.alerts (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0))
--     WHERE resolved_at IS NULL;
