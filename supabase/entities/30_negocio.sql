-- Entity: NEGOCIO (RPC multi-entidad) | Source: 0004_functions_triggers.sql:L185-244 (internal_stock_entry), L635-666 (create_store) · 20261016000009_negocio.sql:L91-210 (register_entry/register_exit, versión FINAL) · 20261016000010_perf.sql:L41-272 (confirm_delivery/create_order, versión FINAL) · 20261016000011_seguridad.sql:L84-139 (update_user_role/set_user_premium/set_user_active) + L189-231 (register_reverse, versión FINAL) | Order: AFTER 01..25 (necesita stores, user_stores, orders, order_items, stock, movements, price_publications, products, distributors, motives, credits + los helpers de 00_foundation)
-- ════════════════════════════════════════════════════════════════════════════
-- RPCs multi-entidad: cada una toca 3+ tablas o codifica un flujo de negocio
-- transversal. Cuerpos VERBATIM de la MIGRACIÓN que define la VERSIÓN FINAL
-- de cada función (la de número más alto que la re-definie — ver cita en cada
-- bloque). Ningún cuerpo resume ni parafrasea el original.
--
-- Qué vive ACÁ (multi-entidad) y qué NO (ya cubierto en 01..25):
--   · internal_stock_entry  → stock + movements + alerts (helper transversal)
--   · create_store          → stores + user_stores (+ valida store_types;
--                             el tope D34 lo hace enforce_store_cap, en 09)
--   · update_user_role      → users + roles (+ distributor_id)
--   · set_user_premium      → users (columna privilegiada D47; NO está en 07)
--   · set_user_active       → users (idem D47; NO está en 07)
--   · register_entry        → orders, order_items, price_publications, stock,
--                             movements, dashboard_daily
--   · register_exit         → idem entry (sin expiry)
--   · confirm_delivery      → orders, order_items, stock, movements,
--                             dashboard_daily, motives, alerts
--   · create_order          → orders, order_items, price_publications,
--                             products, stores, distributors
--   · register_reverse      → movements, stock, dashboard_daily, alerts,
--                             audit_log
-- NO incluidos (ya cubiertos por una entidad, versión final):
--   · my_role/is_premium/my_store_ids/my_distributor_id/has_scope/assert_admin
--     → 00_foundation.sql (§3, versiones finales 0009/0011)
--   · enforce_store_cap + trg_stores_cap_reactivate → 09_stores.sql (§3-4)
--   · create_credit/cancel_credit/register_payment  → 19_credits.sql
--   · register_payment_reverse → 20_credit_payments.sql
--   · set_price → 12_price_publications.sql · assign_user_stores → 11
--   · assign_product_to_store/get_stock → 15_stock.sql · mark_stop → 18
--   · mark_alert_read + internal_alert_* → 21_alerts.sql
--   · internal_dashboard_upsert/get_dashboard → 24_dashboard_daily.sql
--   · job_scan_* → 60_jobs.sql (no es RPC de clientes)
-- ════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 1. internal_stock_entry — VERBATIM 20261015000004_functions_triggers.sql:185-244
--    (única definición en toda supabase/migrations/: sin overrides en
--    0009/0010/0011 — grep "CREATE OR REPLACE FUNCTION public.internal_stock_entry"
--    → 1 sola ocurrencia). Toca stock, movements y alerts (vía
--    internal_eval_stock_alert, definida en 21_alerts.sql).
-- ---------------------------------------------------------------------------

-- Núcleo atómico de movimiento: stock + movements + re-evaluación de alertas.
-- Lo comparten register_entry/exit, confirm_delivery y register_reverse.
-- El dashboard lo upsertea cada caller con su propia semántica de delta.
CREATE OR REPLACE FUNCTION public.internal_stock_entry(
  p_type          public.movement_type,
  p_product_id    bigint,
  p_store_id      bigint,
  p_qty           numeric(12,3),
  p_motive_id     bigint,
  p_order_id      bigint,
  p_distributor_id bigint,
  p_unit_price    numeric(12,2),
  p_expiry_date   date,
  p_created_by    uuid,
  p_reverso_of_id bigint DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_type = 'entry' THEN
    -- Entrada: SIN guard de suficiencia; la entrega suma. El guard contra
    -- read-then-write vive en el WHERE del UPDATE (lock implícito, 1 sentencia).
    INSERT INTO public.stock AS st (product_id, store_id, quantity, expiry_date)
    VALUES (p_product_id, p_store_id, p_qty, p_expiry_date)
    ON CONFLICT (product_id, store_id) DO UPDATE SET
      quantity    = st.quantity + EXCLUDED.quantity,
      -- entrada ⇒ LEAST(actual, nueva); NULL no pisa lo existente (D30)
      expiry_date = CASE
                      WHEN EXCLUDED.expiry_date IS NULL THEN st.expiry_date
                      WHEN st.expiry_date IS NULL      THEN EXCLUDED.expiry_date
                      ELSE LEAST(st.expiry_date, EXCLUDED.expiry_date)
                    END,
      updated_at  = now();
  ELSE
    -- Salida: el guard de suficiencia va en el WHERE (nunca leer-then-escribir).
    UPDATE public.stock AS st
    SET quantity = st.quantity - p_qty,
        -- salida ⇒ NULL al llegar a 0 (D30)
        expiry_date = CASE WHEN st.quantity - p_qty = 0 THEN NULL ELSE st.expiry_date END,
        updated_at = now()
    WHERE st.product_id = p_product_id AND st.store_id = p_store_id
      AND st.quantity >= p_qty
    RETURNING st.quantity INTO v_id;  -- reuse: FOUND es lo que importa
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stock insuficiente o fila inexistente (producto %, tienda %)', p_product_id, p_store_id;
    END IF;
  END IF;

  INSERT INTO public.movements
    (type, product_id, store_id, distributor_id, motive_id, order_id,
     created_by, quantity, unit_price, expiry_date, reverso_of_id)
  VALUES
    (p_type, p_product_id, p_store_id, p_distributor_id, p_motive_id, p_order_id,
     p_created_by, p_qty, p_unit_price,
     CASE WHEN p_type = 'entry' THEN p_expiry_date ELSE NULL END,  -- CHECK: expiry solo en entradas
     p_reverso_of_id)
  RETURNING id INTO v_id;

  PERFORM public.internal_eval_stock_alert(p_store_id, p_product_id);
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. create_store — VERBATIM 20261015000004_functions_triggers.sql:635-666
--    (única definición; grep → 1 sola ocurrencia). Multi-entidad: INSERT en
--    stores + auto-asociación en user_stores (D35) + valida store_types.
--    El tope de tiendas (D34) lo aplican los TRIGGERS trg_stores_cap /
--    trg_stores_cap_reactivate con enforce_store_cap() — ambos en 09_stores.sql.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_store(
  p_name          text,
  p_store_type_id integer,
  p_address       text DEFAULT NULL,
  p_city          text DEFAULT NULL,
  p_phone         text DEFAULT NULL,
  p_location      public.geography(Point,4326) DEFAULT NULL,
  p_website_url   text DEFAULT NULL,
  p_country       char(2) DEFAULT 'CO'
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'create_store: requiere sesión';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'create_store: nombre requerido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.store_types WHERE id = p_store_type_id) THEN
    RAISE EXCEPTION 'store_type inexistente: %', p_store_type_id;
  END IF;
  INSERT INTO public.stores (name, store_type_id, address, city, phone, location, website_url, country, created_by)
  VALUES (p_name, p_store_type_id, p_address, p_city, p_phone, p_location, p_website_url, COALESCE(p_country, 'CO'), auth.uid())
  RETURNING id INTO v_id;
  -- D35: el dueño obtiene alcance con el mecanismo RLS existente (user_stores)
  INSERT INTO public.user_stores (user_id, store_id) VALUES (auth.uid(), v_id)
  ON CONFLICT DO NOTHING;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. update_user_role — VERBATIM 20261016000011_seguridad.sql:85-108
--    (versión FINAL: 0011 re-definió el guard de 0004:544 a assert_admin()).
--    Multi-entidad: lee roles, escribe users (+ distributor_id). Sin esta
--    definición en la vista entities el RPC quedaría PERDIDO: 07_users.sql
--    solo lleva los triggers (handle_new_user/sync_email/sanitize).
-- ---------------------------------------------------------------------------

-- Única vía de asignar rol y alcance de distribuidor (C2/M11/D29).
CREATE OR REPLACE FUNCTION public.update_user_role(
  p_user uuid, p_role text, p_distributor bigint DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role_id integer;
BEGIN
  PERFORM public.assert_admin();  -- D-4: uniformidad + is_active (0004 ya era NULL-safe)
  IF p_role = 'distribuidor' AND p_distributor IS NULL THEN
    RAISE EXCEPTION 'M11: rol distribuidor requiere distributor_id';
  END IF;
  SELECT id INTO v_role_id FROM public.roles WHERE name = p_role;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rol inexistente: %', p_role;
  END IF;
  UPDATE public.users
  SET role_id = v_role_id,
      distributor_id = CASE WHEN p_role = 'distribuidor' THEN p_distributor ELSE NULL END
  WHERE id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'usuario inexistente: %', p_user;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. set_user_premium — VERBATIM 20261016000011_seguridad.sql:111-124
--    (versión FINAL: 0011 re-definió el guard de 0004:575 a assert_admin()).
--    Toca solo users, PERO no está en 07_users.sql (grep: 07 solo defines
--    triggers) — se coloca acá para no perderla en la vista entities.
-- ---------------------------------------------------------------------------

-- D47: ruta RPC de columnas privilegiadas (premium/is_active) — D45.
CREATE OR REPLACE FUNCTION public.set_user_premium(
  p_user_id uuid, p_value boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.assert_admin();  -- D-4
  UPDATE public.users
  SET premium = p_value, updated_at = now()
  WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'usuario inexistente: %', p_user_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. set_user_active — VERBATIM 20261016000011_seguridad.sql:126-139
--    (versión FINAL: 0011 re-definió el guard de 0004:592 a assert_admin()).
--    Ídem set_user_premium sobre is_active.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_user_active(
  p_user_id uuid, p_value boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.assert_admin();  -- D-4
  UPDATE public.users
  SET is_active = p_value, updated_at = now()
  WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'usuario inexistente: %', p_user_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. register_entry — VERBATIM 20261016000009_negocio.sql:101-153
--    (versión FINAL: 0009 re-definió el de 0004:729 con el check D-6;
--    0011 NO la re-definió — ver cabecera de 0011: "register_entry/
--    register_exit/register_payment NO se re-definen — su guard COALESCE ya
--    vive en 0009"). Toca orders, order_items, price_publications, stock,
--    movements, dashboard_daily.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- D-6 / R2 — register_entry: check muerto ⇒ validación real
-- En su versión ORIGINAL (pre-3444c18), 0004 comparaba v_price (reusada)
-- con p_store en un IF cuyo THEN era NULL (no-op) ⇒ aceptaba pedidos de OTRA
-- tienda y filtraba el unit_price privado de esa tienda (D40/D41); el 0004
-- actual ya RAISEa 'pertenece a la tienda' (3444c18). 0009 self-contiene el
-- fix con CHECKS MÁS FUERTES: v_order_store variable propia (no reusa
-- v_price) + store check + IF NOT FOUND sobre order_items. Guard NOT IN ⇒
-- COALESCE (NULL-safe propio, D-1).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_entry(
  p_product bigint, p_store bigint, p_qty numeric(12,3), p_motive_id bigint,
  p_order_id bigint DEFAULT NULL, p_expiry_date date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role        text := COALESCE(public.my_role(), '');  -- NULL-safe (D-4 barato)
  v_dist        bigint;
  v_order_store bigint;  -- D-6: variable PROPIA (el check muerto reusaba v_price)
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
  -- unit_price: order_items si hay pedido; si no, precio activo de la tienda
  IF p_order_id IS NOT NULL THEN
    SELECT o.distributor_id, o.store_id INTO v_dist, v_order_store  -- D25 + D-6
    FROM public.orders o WHERE o.id = p_order_id;
    IF NOT FOUND THEN  -- R2.3: reemplaza el NULL-check muerto
      RAISE EXCEPTION 'pedido inexistente: %', p_order_id;
    END IF;
    IF v_order_store IS DISTINCT FROM p_store THEN  -- R2.2 / D-6
      RAISE EXCEPTION 'register_entry: el pedido % pertenece a la tienda %, no a %',
        p_order_id, v_order_store, p_store;
    END IF;
    SELECT oi.unit_price INTO v_price FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.product_id = p_product;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'producto % no pertenece al pedido %', p_product, p_order_id;
    END IF;
  ELSE
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

-- ---------------------------------------------------------------------------
-- 7. register_exit — VERBATIM 20261016000009_negocio.sql:159-210
--    (versión FINAL: 0009 re-definió el de 0004:781; 0011 no la tocó).
-- ---------------------------------------------------------------------------

-- register_exit (D-6): MISMA fuga que register_entry (además el Select de
-- order_items no chequeaba FOUND ⇒ producto ajeno al pedido entraba con
-- precio NULL). Mismo tratamiento: v_order_store propia, store check,
-- IF NOT FOUND sobre order_items. Guard NOT IN ⇒ COALESCE.
CREATE OR REPLACE FUNCTION public.register_exit(
  p_product bigint, p_store bigint, p_qty numeric(12,3), p_motive_id bigint,
  p_order_id bigint DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role        text := COALESCE(public.my_role(), '');  -- NULL-safe (D-4 barato)
  v_dist        bigint;
  v_order_store bigint;  -- D-6
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
  IF p_order_id IS NOT NULL THEN
    SELECT o.distributor_id, o.store_id INTO v_dist, v_order_store  -- D-6
    FROM public.orders o WHERE o.id = p_order_id;
    IF NOT FOUND THEN  -- R2.3
      RAISE EXCEPTION 'pedido inexistente: %', p_order_id;
    END IF;
    IF v_order_store IS DISTINCT FROM p_store THEN  -- R2.2 / D-6
      RAISE EXCEPTION 'register_exit: el pedido % pertenece a la tienda %, no a %',
        p_order_id, v_order_store, p_store;
    END IF;
    SELECT oi.unit_price INTO v_price FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.product_id = p_product;
    IF NOT FOUND THEN  -- D-6: sin este FOUND el producto ajeno entraba con precio NULL
      RAISE EXCEPTION 'producto % no pertenece al pedido %', p_product, p_order_id;
    END IF;
  ELSE
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

-- ---------------------------------------------------------------------------
-- 8. confirm_delivery — VERBATIM 20261016000010_perf.sql:58-167
--    (versión FINAL: 0010 re-definió íntegro el de 0004:978/0009:225 con
--    batcheado D-2 + dedup + guards de 0009 preservados). Toca orders,
--    order_items, stock, movements, dashboard_daily, motives, alerts.
-- ---------------------------------------------------------------------------

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
-- 9. create_order — VERBATIM 20261016000010_perf.sql:187-272
--    (versión FINAL: 0010 re-definió íntegro el de 0004:879/0009:320 con
--    set-based R12 + guards de 0009 preservados). Toca orders, order_items,
--    price_publications, products, stores, distributors.
-- ---------------------------------------------------------------------------

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
-- 10. register_reverse — VERBATIM 20261016000011_seguridad.sql:192-231
--     (versión FINAL: 0011 re-definió el de 0004:829 con guard assert_admin;
--     sin redefiniciones posteriores). Toca movements, stock, dashboard_daily,
--     alerts (implícito en internal_stock_entry) y audit_log.
-- ---------------------------------------------------------------------------

-- Anulación por reverso (D31): 1 por original (unique parcial), tipo opuesto,
-- mismo producto/tienda, original no revertido y no siendo él mismo un reverso.
-- p_reason se persiste en audit_log (diff JSONB, D10) — decisión documentada.
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

-- Fin 30_negocio. Siguiente: 40_seeds.sql (los seeds de catálogos que estas
-- RPC asumen en runtime — p.ej. confirm_delivery exige motives 'reabastecimiento').
