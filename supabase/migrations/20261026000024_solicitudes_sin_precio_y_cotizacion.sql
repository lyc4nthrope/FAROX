-- ============================================================================
-- FAROX — 0024: solicitudes sin precio y cotización del distribuidor.
--
-- Hasta 0023 un pedido exigía precio activo en la tienda para CADA producto
-- (D40). Eso obligaba al operador a “tener un movimiento/precio”, una acción
-- Premium, antes de poder solicitar. La regla nueva:
--
--   · el operador pide producto + cantidad SIN precio; la línea nace con
--     unit_price NULL;
--   · el distribuidor dueño del pedido fija después cuánto le cobra, en una
--     columna PROPIA (distributor_price) mientras el pedido sigue pendiente;
--   · unit_price sigue siendo el precio privado de la tienda (D40/D41) y
--     get_order_items no cambia: el distribuidor nunca ve ese precio;
--   · el fiado y el valor del movimiento usan COALESCE(distributor_price,
--     unit_price): la cotización manda cuando existe;
--   · el admin conserva el flujo anterior (create_order le sigue exigiendo
--     precio activo) y su catálogo global;
--   · set_stock_threshold permite editar/limpiar el umbral desde la vista de
--     inventario unificada (assign_product_to_store no borra umbrales).
--
-- Reglas del repo: SECURITY DEFINER + SET search_path; alcance desde el JWT,
-- nunca desde parámetros; GRANT explícito solo a authenticated/service_role.
-- ============================================================================

-- ============================================================================
-- 1. order_items: precio de tienda nullable + precio de cotización propio.
--    · unit_price NULL = la tienda todavía no tiene precio (solicitud).
--    · distributor_price NULL = el distribuidor todavía no cotizó.
-- ============================================================================
ALTER TABLE public.order_items ALTER COLUMN unit_price DROP NOT NULL;

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_unit_price_check;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_unit_price_check CHECK (unit_price IS NULL OR unit_price > 0);

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS distributor_price numeric(12,2) NULL;

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_distributor_price_check;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_distributor_price_check
  CHECK (distributor_price IS NULL OR distributor_price > 0);

-- ============================================================================
-- 2. create_order: el operador ya no necesita precio activo.
--    El admin mantiene D40 (sigue validando precio antes de insertar).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_order(
  p_distributor bigint, p_store bigint, p_items jsonb,
  p_expected_at timestamptz DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := public.my_role();
  v_order bigint;
  v_dup   boolean;
  v_pid   bigint;                -- product_id del primer infractor por pass
  v_qty   numeric(12,3);
  v_count integer := 0;
BEGIN
  -- D43: admin · operador con tienda en scope (sin premium)
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'operador' AND (p_store = ANY (public.my_store_ids())) THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'create_order: solo admin, u operador con la tienda en su alcance (D43)';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'create_order: items vacíos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND is_active) THEN  -- R5.3
    RAISE EXCEPTION 'tienda inactiva o inexistente: %', p_store;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.distributors WHERE id = p_distributor AND is_active) THEN  -- R5.2
    RAISE EXCEPTION 'distribuidor inactivo o inexistente: %', p_distributor;
  END IF;
  -- 0021: el operador solo pide a un distribuidor vinculado a su tienda.
  IF v_role = 'operador' AND NOT EXISTS (
    SELECT 1 FROM public.store_distributors sd
    WHERE sd.store_id = p_store AND sd.distributor_id = p_distributor
  ) THEN
    RAISE EXCEPTION 'create_order: el distribuidor % no está vinculado a la tienda %',
      p_distributor, p_store;
  END IF;
  -- R12: sin duplicados (1 sentencia). GROUP BY agrupa también los NULL ⇒
  -- un product_id NULL único pasa acá y lo captura el pass de producto.
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
    GROUP BY x.product_id
    HAVING count(*) > 1
  ) INTO v_dup;
  IF v_dup THEN
    RAISE EXCEPTION 'create_order: producto repetido en items';
  END IF;
  -- R12: quantity > 0 — primer infractor (set-based; paridad de mensaje con
  -- el loop de 0009)
  SELECT x.product_id, x.quantity INTO v_pid, v_qty
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
  WHERE x.quantity IS NULL OR x.quantity <= 0
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'create_order: quantity debe ser > 0 (producto %)', v_pid;
  END IF;
  -- R5.3: producto activo — primer infractor (soft-delete no es borrado)
  SELECT x.product_id INTO v_pid
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
  LEFT JOIN public.products p ON p.id = x.product_id AND p.is_active
  WHERE p.id IS NULL
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'producto inactivo o inexistente: %', v_pid;
  END IF;
  -- 0021: intersección de catálogos para el operador. El admin conserva el
  -- flujo global. Se valida set-based y se reporta el primer infractor.
  IF v_role = 'operador' THEN
    SELECT x.product_id INTO v_pid
    FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
    LEFT JOIN public.distributor_products dp
      ON dp.distributor_id = p_distributor AND dp.product_id = x.product_id
    WHERE dp.product_id IS NULL
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'create_order: producto % no está en el catálogo del distribuidor %',
        v_pid, p_distributor;
    END IF;

    SELECT x.product_id INTO v_pid
    FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
    LEFT JOIN public.stock s
      ON s.store_id = p_store AND s.product_id = x.product_id
    WHERE s.product_id IS NULL
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'create_order: producto % no está en el catálogo de la tienda %',
        v_pid, p_store;
    END IF;
  END IF;
  -- 0024: el admin sigue exigiendo precio activo (D40). El operador ya no:
  -- la solicitud nace sin precio y el distribuidor la cotiza después.
  IF v_role = 'admin' THEN
    SELECT x.product_id INTO v_pid
    FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
    LEFT JOIN public.price_publications pp
      ON pp.product_id = x.product_id AND pp.store_id = p_store AND pp.is_active
    WHERE pp.product_id IS NULL
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'sin precio activo para producto % en tienda %; use set_price() primero', v_pid, p_store;
    END IF;
  END IF;
  INSERT INTO public.orders (distributor_id, store_id, created_by, expected_at, notes)
  VALUES (p_distributor, p_store, auth.uid(), p_expected_at, p_notes)
  RETURNING id INTO v_order;
  -- R12: UNA sola sentencia. unit_price = precio activo si existe; NULL para
  -- una solicitud del operador sin precio (0024).
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
  SELECT v_order, x.product_id, x.quantity, pp.price
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
  LEFT JOIN public.price_publications pp
    ON pp.product_id = x.product_id AND pp.store_id = p_store AND pp.is_active;
  GET DIAGNOSTICS v_count = ROW_COUNT;  -- R12: validación de cantidad > 0
  IF v_count = 0 THEN
    RAISE EXCEPTION 'create_order: ningún item válido';
  END IF;
  RETURN v_order;
END;
$$;

-- ============================================================================
-- 3. get_order_quotes: lectura de la cotización para quien la define (admin y
--    distribuidor del pedido) y para el operador Premium de la tienda. NUNCA
--    expone unit_price (D40/D41): solo distributor_price.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_order_quotes(p_order bigint)
RETURNS TABLE (product_id bigint, distributor_price numeric(12,2))
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT oi.product_id, oi.distributor_price
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.order_id = p_order
    AND (public.my_role() = 'admin'
         OR o.distributor_id = public.my_distributor_id()
         OR (public.is_premium() AND o.store_id = ANY (public.my_store_ids())));
$$;

-- ============================================================================
-- 4. set_order_prices: el distribuidor (o el admin) cotiza las líneas de un
--    pedido pendiente. p_items = [{"product_id":1,"distributor_price":2500}]
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_order_prices(
  p_order bigint, p_items jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role   text := COALESCE(public.my_role(), '');
  v_status public.order_status;
  v_dup    boolean;
  v_pid    bigint;
  v_price  numeric(12,2);
  v_count  integer := 0;
BEGIN
  IF p_order IS NULL THEN
    RAISE EXCEPTION 'set_order_prices: pedido requerido';
  END IF;
  SELECT o.status INTO v_status FROM public.orders o WHERE o.id = p_order FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_order_prices: pedido inexistente: %', p_order;
  END IF;
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor' AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = p_order AND o.distributor_id = public.my_distributor_id()
  ) THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'set_order_prices: solo el admin o el distribuidor del pedido %', p_order;
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'set_order_prices: el pedido % no está pendiente (estado %)', p_order, v_status;
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'set_order_prices: items vacíos';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS x(product_id bigint, distributor_price numeric(12,2))
    GROUP BY x.product_id
    HAVING count(*) > 1
  ) INTO v_dup;
  IF v_dup THEN
    RAISE EXCEPTION 'set_order_prices: producto repetido en items';
  END IF;
  SELECT x.product_id, x.distributor_price INTO v_pid, v_price
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, distributor_price numeric(12,2))
  WHERE x.distributor_price IS NULL OR x.distributor_price <= 0
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'set_order_prices: distributor_price debe ser > 0 (producto %)', v_pid;
  END IF;
  -- Toda línea cotizada debe pertenecer al pedido: un producto ajeno no se
  -- puede inyectar en la cotización.
  SELECT x.product_id INTO v_pid
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, distributor_price numeric(12,2))
  LEFT JOIN public.order_items oi
    ON oi.order_id = p_order AND oi.product_id = x.product_id
  WHERE oi.product_id IS NULL
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'set_order_prices: el producto % no pertenece al pedido %', v_pid, p_order;
  END IF;
  UPDATE public.order_items oi
  SET distributor_price = x.distributor_price,
      updated_at = now()
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, distributor_price numeric(12,2))
  WHERE oi.order_id = p_order AND oi.product_id = x.product_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'set_order_prices: ningún item actualizado';
  END IF;
END;
$$;

-- ============================================================================
-- 5. create_credit: el monto sale de la cotización; si no hay, del precio de
--    tienda (comportamiento previo). Antes una solicitud sin precio daba
--    "sin líneas con monto > 0" aun con cotización.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_credit(
  p_order bigint, p_due_date date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := COALESCE(public.my_role(), '');
  v_total numeric(14,2);
  v_store bigint;
  v_id    bigint;
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'create_credit: solo admin/operador';
  END IF;
  SELECT o.store_id INTO v_store FROM public.orders o WHERE o.id = p_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido inexistente: %', p_order; END IF;
  IF v_role = 'operador' AND NOT (v_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'create_credit: tienda fuera del alcance del operador';
  END IF;
  SELECT COALESCE(sum(COALESCE(oi.distributor_price, oi.unit_price) * oi.quantity), 0)
  INTO v_total
  FROM public.order_items oi WHERE oi.order_id = p_order;
  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'pedido sin líneas con monto > 0';
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

-- ============================================================================
-- 6. confirm_delivery (base 0010, batched): el valor de la entrada usa la
--    cotización cuando existe. Con unit_price NULL (solicitud sin precio) el
--    dashboard debe recibir 0, nunca NULL (entries_value es NOT NULL).
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
  ELSIF v_role = 'operador' AND (o.store_id = ANY (public.my_store_ids())) THEN
    NULL;
  ELSIF v_role = 'distribuidor' AND o.distributor_id = public.my_distributor_id() THEN
    NULL;  -- M6: los suyos
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
-- 7. set_stock_threshold: editar/limpiar el umbral desde el inventario
--    unificado. assign_product_to_store conserva el umbral previo con NULL,
--    así que hacía falta una mutación explícita.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_stock_threshold(
  p_product bigint, p_store bigint, p_threshold numeric(12,3)
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'set_stock_threshold: solo admin/operador';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'set_stock_threshold: tienda fuera del alcance del operador';
  END IF;
  IF p_threshold IS NOT NULL AND p_threshold < 0 THEN
    RAISE EXCEPTION 'set_stock_threshold: threshold debe ser >= 0';
  END IF;
  UPDATE public.stock s
  SET threshold = p_threshold,
      updated_at = now()
  WHERE s.store_id = p_store AND s.product_id = p_product;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_stock_threshold: producto % no está asignado a la tienda %',
      p_product, p_store;
  END IF;
  PERFORM public.internal_eval_stock_alert(p_store, p_product);
END;
$$;

-- ============================================================================
-- 8. Grants (deny-by-default: solo las firmas nuevas/reemplazadas)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.create_order(bigint, bigint, jsonb, timestamptz, text),
  public.create_credit(bigint, date),
  public.confirm_delivery(bigint, jsonb),
  public.get_order_quotes(bigint),
  public.set_order_prices(bigint, jsonb),
  public.set_stock_threshold(bigint, bigint, numeric)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.create_order(bigint, bigint, jsonb, timestamptz, text),
  public.create_credit(bigint, date),
  public.confirm_delivery(bigint, jsonb),
  public.get_order_quotes(bigint),
  public.set_order_prices(bigint, jsonb),
  public.set_stock_threshold(bigint, bigint, numeric)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · \d+ public.order_items ⇒ unit_price nullable; distributor_price nullable
--     con CHECK (> 0); ambos CHECK vigentes.
--   · Un operador sin price_publications crea un pedido ⇒ unit_price IS NULL y
--     distributor_price IS NULL.
--   · Su distribuidor ejecuta set_order_prices ⇒ distributor_price > 0;
--     get_order_items sigue sin exponer unit_price.
--   · create_credit de ese pedido usa la cotización como total.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   Restaurar create_order desde 0021; create_credit desde 0023;
--   confirm_delivery desde 0009.
--   DROP FUNCTION IF EXISTS public.get_order_quotes(bigint);
--   DROP FUNCTION IF EXISTS public.set_order_prices(bigint, jsonb);
--   DROP FUNCTION IF EXISTS public.set_stock_threshold(bigint, bigint, numeric);
--   DELETE FROM public.order_items WHERE unit_price IS NULL;  -- decidir antes
--   ALTER TABLE public.order_items DROP COLUMN IF EXISTS distributor_price;
--   ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_unit_price_check;
--   ALTER TABLE public.order_items
--     ADD CONSTRAINT order_items_unit_price_check CHECK (unit_price > 0);
--   ALTER TABLE public.order_items ALTER COLUMN unit_price SET NOT NULL;
