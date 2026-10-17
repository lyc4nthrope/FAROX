-- ============================================================================
-- FAROX — Sprint 1 hardening, batch 2/4: PERFORMANCE (0010)
-- Spec: sdd/sprint1-hardening — R7-R13 (delta sobre 0004/0009)
-- Design: D-2 (batch upsert de dashboard) · D-1 (autocontención)
--         · review batch1 #445 (dedup de p_items en confirm_delivery)
--
-- Reglas aplicadas:
--  · Append-only: NINGÚN archivo 0001-0009 se edita. Todo es CREATE OR
--    REPLACE completo o DROP ... IF EXISTS + CREATE / CREATE INDEX IF NOT
--    EXISTS (convención 0004/0009).
--  · Autocontención (D-1): confirm_delivery y create_order se reemplazan
--    ÍNTEGROS, CON los fixes de 0009 ya incluidos (guards de estado,
--    p_items no vacío, received_quantity <= quantity, cierre race-safe,
--    is_active de tienda/distribuidor/producto, unit_price congelado).
--  · Sin cambios de grants ni assert_admin (0011, batch 3); sin verify
--    (0012, batch 4).
--
-- NOTAS:
--  · R9 (idx_orders_expected_open): el spec pide "WHERE estado abierto" ("el
--    job no paga índice por cerrados") y el plan de batch pidió
--    "WHERE expected_at IS NOT NULL"; se reconcilian AMBOS predicados:
--    (expected_at IS NOT NULL AND status NOT IN ('delivered','cancelled')).
--    job_scan_order_late ya incluye las dos cláusulas ⇒ el planner reconoce
--    el índice como utilizable (implicación trivial por igualdad de cláusulas).
--  · Review batch1 #1 (obs #445): el guard v_rq > v_qty de confirm_delivery
--    es inalcanzable en la práctica (el CHECK received_quantity <= quantity
--    de order_items revienta el UPDATE antes del RETURNING), pero se
--    PRESERVA como defensa; 0012 debe assertEAR el error de constraint, no
--    el mensaje custom.
--  · Review batch1 #3 (obs #445): el comentario de create_credit ("el fiado
--    se calcula sobre lo ENTREGADO") contradice su propia fórmula
--    Σ unit_price × quantity, que usa quantity = LO PEDIDO. NO se redefine
--    create_credit acá: forzaría una redefinición completa de una función de
--    negocio por un comment dentro de un batch de performance (y el comment
--    de cabecera de 0009 quedaría igual — append-only). Corrección
--    documental pendiente en el batch docs (R20, §contratos RPC).
--
-- Convención INVERSE (batch 2): bloque al final del archivo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- D-2 / R7 + R1 / D-1 — confirm_delivery: batcheado, dedup, guards de 0009
--  · D-2: unit_price sale del MISMO RETURNING del UPDATE de líneas (0004
--    hacía 2 subconsultas por línea: una para internal_stock_entry y otra
--    para el dashboard; 0009 las preservó). Se acumulan v_entries/
--    v_entries_val y se hace UN SOLO internal_dashboard_upsert después del
--    loop ⇒ 1 upsert y 1 evento realtime por entrega en vez de 1 por línea
--    (M6/A1). unit_price es NOT NULL CHECK > 0 (0002) ⇒ sin NULL.
--  · Review batch1 #2: p_items con product_id repetido actualizaba DOS veces
--    la MISMA línea de order_items (uq_order_items_order_product impide la
--    fila doble, pero internal_stock_entry corría 2× ⇒ stock, movements y
--    dashboard duplicados EN SILENCIO). Pre-existente en 0004. Ahora:
--    RAISE explícito sobre duplicado.
--  · Guards de 0009 PRESERVADOS: rol IF/ELSIF/ELSE (NULL-safe, D-4), estado
--    IN ('delivered','cancelled'), p_items null/no-array/vacío, received<=
--    quantity vía RETURNING, cierre condicional race-safe + IF NOT FOUND.
-- ---------------------------------------------------------------------------
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
  v_price       numeric(12,2);  -- D-2: unit_price del propio RETURNING (0 subconsultas)
  v_entries     integer      := 0;  -- D-2: líneas con recepción > 0
  v_entries_val numeric(14,2) := 0; -- D-2: Σ received_quantity × unit_price
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
    -- D-2: 4 columnas en el RETURNING — quantity (R1.5) y unit_price (D-2)
    -- salen de la MISMA fila; cero subconsultas por línea.
    UPDATE public.order_items oi
    SET received_quantity = it.received_quantity,
        status = CASE
                   WHEN it.received_quantity = oi.quantity THEN 'received'::public.order_item_status
                   WHEN it.received_quantity > 0          THEN 'partial'::public.order_item_status
                   ELSE 'pending'::public.order_item_status
                 END
    WHERE oi.order_id = p_order AND oi.product_id = it.product_id
    RETURNING oi.received_quantity, oi.status, oi.quantity, oi.unit_price
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
      v_entries_val := v_entries_val + v_rq * v_price;
    END IF;
  END LOOP;
  -- D-2 / R7.1: UN SOLO upsert del agregado (delta total de la entrega),
  -- ANTES del cierre del pedido; 1 fila tocada y 1 evento realtime por
  -- entrega en lugar de 1 por línea (antes del upsert solo si hubo
  -- recepción > 0, igual que el upsert condicional por línea que reemplaza).
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

-- ---------------------------------------------------------------------------
-- R12 / D-1 — create_order: set-based + validaciones de 0009 preservadas
--  · R12: validaciones por PASS set-based (duplicados, quantity > 0,
--    producto activo, precio activo — primer infractor por pass) + UN SOLO
--    INSERT ... JOIN price_publications (antes: 1 INSERT...SELECT por línea
--    dentro del loop).
--  · Guards de 0009 PRESERVADOS: rol IF/ELSIF/ELSE (NULL-safe, D-4), items
--    no vacíos, tienda/distribuidor/producto activos (soft-delete no es
--    borrado), unit_price congelado = pp.price del catálogo ACTIVO de la
--    tienda (D40; uq_price_store_product_active garantiza ≤1 fila activa ⇒
--    exactamente 1 línea por producto).
--  · R12 nuevo: producto duplicado en p_items ⇒ RAISE (antes duplicaba la
--    línea — violaba uq_order_items_order_product y revienta la transacción
--    completa igual, pero con un error de constraint críptico).
--  · Orden de errores: se validan passes completos (todo quantity, luego todo
--    producto, luego todo precio) en vez de ítem por ítem; con UN defecto
--    por fixture el mensaje es idéntico al del loop original.
-- ---------------------------------------------------------------------------
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
  -- D40: precio activo de la tienda — primer infractor
  SELECT x.product_id INTO v_pid
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
  LEFT JOIN public.price_publications pp
    ON pp.product_id = x.product_id AND pp.store_id = p_store AND pp.is_active
  WHERE pp.product_id IS NULL
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'sin precio activo para producto % en tienda %; use set_price() primero', v_pid, p_store;
  END IF;
  INSERT INTO public.orders (distributor_id, store_id, created_by, expected_at, notes)
  VALUES (p_distributor, p_store, auth.uid(), p_expected_at, p_notes)
  RETURNING id INTO v_order;
  -- R12: UNA sola sentencia — unit_price congelado = pp.price del catálogo
  -- activo (≤1 fila por uq_price_store_product_active ⇒ 1 línea por item)
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
  SELECT v_order, x.product_id, x.quantity, pp.price
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
  JOIN public.price_publications pp
    ON pp.product_id = x.product_id AND pp.store_id = p_store AND pp.is_active;
  GET DIAGNOSTICS v_count = ROW_COUNT;  -- R12: validación de cantidad > 0
  IF v_count = 0 THEN
    RAISE EXCEPTION 'create_order: ningún item válido';
  END IF;
  RETURN v_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- R10 — audit_diff: to_jsonb(OLD) cacheado en v_old
-- Hot path (las 8 tablas D21): en UPDATE, to_jsonb(OLD) se re-evaluaba por
-- CADA clave de jsonb_each (WHERE n.value IS DISTINCT FROM to_jsonb(OLD) ->
-- n.key) y otra vez en v_row_id — N+1 serializaciones de la fila vieja por
-- UPDATE. Ahora: UNA serialización por trigger. Cuerpo idéntico al de 0004
-- en semántica (mismas ramas, mismo diff, mismo search_vector excluido,
-- mismo row_id COALESCE — en INSERT v_old es NULL y el COALESCE cae en NEW).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_diff() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_diff   jsonb;
  v_row_id text;
  v_old    jsonb;  -- R10: cache de to_jsonb(OLD); NULL en INSERT
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old := to_jsonb(OLD);  -- R10: evaluación única (antes: 1 + N claves + 1)
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(jsonb_object_agg(n.key, n.value), '{}'::jsonb)
      INTO v_diff
    FROM jsonb_each(to_jsonb(NEW)) AS n(key, value)
    WHERE n.value IS DISTINCT FROM v_old -> n.key;  -- R10: usa el cache
    IF v_diff = '{}'::jsonb THEN
      RETURN NEW;  -- update sin cambios reales: no auditar
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_diff := to_jsonb(NEW) - 'search_vector';  -- tsvector derivado: ruido + peso
  ELSE
    v_diff := v_old - 'search_vector';
  END IF;

  -- row_id text (no bigint): users.id es uuid — sin esto los cambios de
  -- rol/premium (los más críticos de SEC-01) quedaban con row_id NULL (B10)
  v_row_id := COALESCE(to_jsonb(NEW) ->> 'id', v_old ->> 'id');

  INSERT INTO public.audit_log (created_by, table_name, action, row_id, diff)
  VALUES (auth.uid(), TG_TABLE_NAME, lower(TG_OP)::public.audit_action, v_row_id, v_diff);
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- R11 — get_dashboard acotado a <= 366 días (AC 11.1-11.2)
-- Un rango abierto sobre dashboard_daily = scan y egress descontrolados
-- (D39: "nunca agregación en vivo"). RAISE explícito (spec R11; el clamp era
-- la alternativa). LANGUAGE sql → plpgsql: sql no puede RAISE; MISMA firma,
-- mismos OUT (RETURNS TABLE idéntico), mismo cuerpo de consulta, mismos
-- atributos STABLE/SECURITY DEFINER. El reemplazo conserva el OID ⇒ los
-- grants de 0006 siguen vigentes. COALESCE de defaults idéntico al WHERE
-- original (p_from/p_to NULL ⇒ 30 días / hoy). Rango invertido ⇒ BETWEEN
-- vacío, igual que antes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard(
  p_from date DEFAULT CURRENT_DATE - 30, p_to date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  day             date,
  distributor_id  bigint,
  entries_count   integer,
  exits_count     integer,
  entries_value   numeric(14,2),
  exits_value     numeric(14,2)
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_from date := COALESCE(p_from, CURRENT_DATE - 30);  -- R11: mismos defaults que el WHERE original
  v_to   date := COALESCE(p_to, CURRENT_DATE);
BEGIN
  IF v_to - v_from > 366 THEN  -- R11 / AC 11.2
    RAISE EXCEPTION 'get_dashboard: rango de % días excede el máximo de 366', v_to - v_from;
  END IF;
  RETURN QUERY
  SELECT d.day, d.distributor_id, d.entries_count, d.exits_count, d.entries_value, d.exits_value
  FROM public.dashboard_daily d
  WHERE d.day BETWEEN v_from AND v_to
    AND public.is_premium()  -- gate premium por fila-función (evalúa 1 vez)
    AND (public.my_role() = 'admin'
         OR public.my_role() = 'operador'            -- A3: agregado global en MVP
         OR d.distributor_id = public.my_distributor_id())
  ORDER BY d.day;
END;
$$;

-- ---------------------------------------------------------------------------
-- R8 / R9 / R13 — índices parciales sobre las tablas que escanean los jobs
--
-- R8: el job diario (job_scan_expiry_soon) escanea PUBLIC.STOCK
-- (s.expiry_date <= CURRENT_DATE + c), NO movements — el índice previo
-- idx_movements_expiry (0003) jamás lo alimentaba. Se elimina y se crea el
-- equivalente sobre stock.
DROP INDEX IF EXISTS public.idx_movements_expiry;
CREATE INDEX IF NOT EXISTS idx_stock_expiry
  ON public.stock (expiry_date) WHERE expiry_date IS NOT NULL;
--
-- R9: job_scan_order_late filtra expected_at < now() SOBRE PEDIDOS ABIERTOS
-- (delivered_at IS NULL y status NOT IN ('delivered','cancelled')). Predicado
-- combinado — ver NOTAS de cabecera: "estado abierto" (spec) +
-- "expected_at IS NOT NULL" (plan) — los pedidos cerrados no pagan el índice.
CREATE INDEX IF NOT EXISTS idx_orders_expected_open
  ON public.orders (expected_at)
  WHERE expected_at IS NOT NULL AND status NOT IN ('delivered', 'cancelled');
--
-- R13: la vista de alertas activas filtra por tienda con resolved_at IS NULL
-- (patrón idéntico a idx_movements_distributor_created); los resueltos no
-- ocupan índice.
CREATE INDEX IF NOT EXISTS idx_alerts_store_open
  ON public.alerts (store_id) WHERE resolved_at IS NULL;

-- Fin batch 2 (0010). Siguiente: 20261016000011_seguridad.sql (batch 3).
-- Smoke post-0010 (EXPLAIN + fixtures, solo con ref MCP confirmada, R19.2):
--  · EXPLAIN del SELECT de job_scan_expiry_soon ⇒ usa idx_stock_expiry
--    (seq scan sobre stock eliminado).
--  · Entrega de 3 líneas ⇒ exactamente 1 upsert / 1 fila tocada en
--    dashboard_daily (1 evento realtime).
--  · p_items con product_id repetido en confirm_delivery y create_order ⇒
--    RAISE 'producto repetido en items'.
--  · get_dashboard con p_from = CURRENT_DATE - 5000 ⇒ RAISE de rango.

-- ============================================================================
-- INVERSE (rollback de 0010) — ejecutar en UNA transacción, ASUMIENDO 0009
-- aplicado. El estado resultante = post-0009 (batch 1 intacto).
--
-- 1) Índices: quitar los 3 nuevos y restaurar el de 0003:
-- DROP INDEX IF EXISTS public.idx_stock_expiry;
-- DROP INDEX IF EXISTS public.idx_orders_expected_open;
-- DROP INDEX IF EXISTS public.idx_alerts_store_open;
-- CREATE INDEX IF NOT EXISTS idx_movements_expiry
--   ON public.movements (expiry_date) WHERE expiry_date IS NOT NULL;
--
-- 2) Funciones: audit_diff y get_dashboard vuelven a su estado de 0004
--    (incluido LANGUAGE sql en get_dashboard); confirm_delivery y create_order
--    vuelven a su estado de 0009. Re-ejecutar, EN ESTE ORDEN (ambos archivos
--    son idempotentes por convención):
--      a) 20261015000004_functions_triggers.sql COMPLETO
--      b) 20261016000009_negocio.sql COMPLETO
--    El ORDEN importa: re-ejecutar solo (a) revierte también confirm_delivery/
--    create_order a pre-0009; (b) restaura los fixes de negocio del batch 1
--    y NO redefine audit_diff/get_dashboard ⇒ no toca lo restaurado por (a).
--    Alternativa a nivel de archivo: git revert del commit del batch 2.
-- ============================================================================
