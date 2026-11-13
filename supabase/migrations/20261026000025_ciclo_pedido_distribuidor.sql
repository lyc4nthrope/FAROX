-- ============================================================================
-- FAROX — 0025: el ciclo operativo del pedido lo lleva el distribuidor.
--
-- Regla nueva: quien SOLICITA el pedido no puede marcarlo en ruta ni confirmar
-- su entrega. Eso es responsabilidad del distribuidor al que se le solicitó
-- (el admin conserva el override para destrabar). Además, la fecha prometida
-- es opcional y editable por el distribuidor como parte de la comunicación con
-- el operador.
--
--   1. update_order_status: admin o distribuidor dueño del pedido. El operador
--      de la tienda deja de poder pasar un pedido a in_route.
--   2. confirm_delivery: admin o distribuidor dueño del pedido. El operador de
--      la tienda deja de poder confirmar la entrega.
--   3. set_order_expected_at: nueva RPC para fijar/limpiar la fecha prometida
--      mientras el pedido siga abierto.
--
-- Reglas del repo: SECURITY DEFINER + SET search_path; alcance desde el JWT,
-- nunca desde parámetros; GRANT explícito solo a authenticated/service_role.
-- ============================================================================

-- ============================================================================
-- 1. update_order_status — base 0004, alcance del distribuidor del pedido.
-- ============================================================================
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
    NULL;  -- 0025: el ciclo lo lleva el distribuidor al que se le pidió
  ELSE
    RAISE EXCEPTION 'update_order_status: sin alcance sobre el pedido %', p_order;
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
    PERFORM public.internal_alert_resolve('order_late', NULL, NULL, p_order);  -- A6
  ELSIF o.status = 'pending' AND p_status = 'in_route' THEN
    UPDATE public.orders SET status = p_status WHERE id = p_order;
  ELSE
    RAISE EXCEPTION 'transición inválida: % → %', o.status, p_status;
  END IF;
END;
$$;

-- ============================================================================
-- 2. confirm_delivery — base 0024 (batched), alcance del distribuidor.
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
-- 3. set_order_expected_at — fecha prometida opcional y editable mientras el
--    pedido sigue abierto. NULL la limpia.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_order_expected_at(
  p_order bigint, p_expected_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role   text := COALESCE(public.my_role(), '');
  v_status public.order_status;
BEGIN
  IF p_order IS NULL THEN
    RAISE EXCEPTION 'set_order_expected_at: pedido requerido';
  END IF;
  SELECT o.status INTO v_status FROM public.orders o WHERE o.id = p_order FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_order_expected_at: pedido inexistente: %', p_order;
  END IF;
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor' AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = p_order AND o.distributor_id = public.my_distributor_id()
  ) THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'set_order_expected_at: solo el admin o el distribuidor del pedido %', p_order;
  END IF;
  IF v_status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'set_order_expected_at: el pedido % ya está cerrado (estado %)',
      p_order, v_status;
  END IF;
  UPDATE public.orders SET expected_at = p_expected_at WHERE id = p_order;
END;
$$;

-- ============================================================================
-- 4. Grants (deny-by-default: solo las firmas reemplazadas/nuevas)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.update_order_status(bigint, public.order_status, text),
  public.confirm_delivery(bigint, jsonb),
  public.set_order_expected_at(bigint, timestamptz)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.update_order_status(bigint, public.order_status, text),
  public.confirm_delivery(bigint, jsonb),
  public.set_order_expected_at(bigint, timestamptz)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · Un operador (no admin) ejecuta update_order_status(pedido, 'in_route')
--     sobre un pedido de su tienda ⇒ excepción "sin alcance".
--   · El distribuidor del pedido lo ejecuta ⇒ pasa a in_route.
--   · Un operador ejecuta confirm_delivery ⇒ excepción "sin alcance".
--   · El distribuidor del pedido ejecuta confirm_delivery ⇒ stock actualizado.
--   · set_order_expected_at(NULL) limpia la fecha; con fecha la guarda.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   Restaurar update_order_status y confirm_delivery desde 0024 (que a su vez
--   conserva la rama del operador de 0004/0010).
--   DROP FUNCTION IF EXISTS public.set_order_expected_at(bigint, timestamptz);
