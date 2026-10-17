-- ============================================================================
-- FAROX — Sprint 1 hardening, batch 1/4: NEGOCIO (0009)
-- Spec: sdd/sprint1-hardening — R1-R6 (delta sobre 0004/0006)
-- Design: D-3 (is_active en helpers) · D-6 (validaciones de inventario + D34)
--         · D-7 (scope de créditos/rutas) · D-1 (autocontención)
--
-- Reglas aplicadas:
--  · Append-only: NINGÚN archivo 0001-0008 se edita. Todo es CREATE OR REPLACE
--    completo o DROP ... IF EXISTS + CREATE (convención 0004/0006).
--  · Autocontención (D-1): cada función tocada se reemplaza íntegra; los fixes
--    de este batch viven en el cuerpo nuevo. 0010 reescribirá
--    confirm_delivery/create_order completos CON estos fixes incluidos.
--  · Null-safety barato: COALESCE(my_role(), '') en los guards de las RPC
--    que este batch reescribe (register_entry/exit, create_credit,
--    register_payment). El commit remoto 3444c18 ya dejó NULL-safe los
--    guards equivalentes de 0004, pero este batch NO depende del fundamento:
--    autocontención D-1 — cada función tocada trae su propio COALESCE. Los
--    guards IF/ELSIF/ELSE de confirm_delivery y create_order ya son
--    NULL-safe (NULL cae al ELSE-RAISE — D-4) y NO se tocan. El refactor
--    integral assert_admin() es 0011 (batch 3).
--  · Sin cambios de grants (0011) ni índices (0010).
--
-- NOTA (R1 vs enum): public.order_status = ('pending','in_route','delivered',
-- 'cancelled') — NO existen 'confirmed'/'in_transit'. El guard de
-- confirm_delivery usa la traducción concreta del design D-1: rechazar los
-- estados cerrados 'delivered' y 'cancelled' (equivalente operativo de
-- "solo admite recepción si está en tránsito").
--
-- Convención INVERSE (batch 1): bloque al final del archivo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- D-3 / R3 — Helpers con is_active enforced
-- Usuario inactivo pierde rol, alcance y premium. Los helpers son SECURITY
-- DEFINER (owner postgres, RLS no aplica) ⇒ sin recursión users→policy→helper
-- (design D-3). Mismo cuerpo que 0004 §4.1 + predicado u.is_active.
-- ---------------------------------------------------------------------------

-- Nombre del rol del JWT; helper de todas las validaciones.
CREATE OR REPLACE FUNCTION public.my_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.name
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id
  WHERE u.id = auth.uid() AND u.is_active;  -- R3/D-3: inactivo ⇒ NULL ⇒ guard no pasa
$$;

-- premium OR rol = admin (D7), leído de users — nunca del JWT.
CREATE OR REPLACE FUNCTION public.is_premium() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = auth.uid() AND u.is_active AND (u.premium OR r.name = 'admin')  -- R3/D-3
  );
$$;

-- Alcance del operador, evaluado 1 vez por query (no subconsulta correlacionada por fila).
CREATE OR REPLACE FUNCTION public.my_store_ids() RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(array_agg(us.store_id), '{}'::bigint[])
  FROM public.user_stores us
  WHERE us.user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.users u  -- R3/D-3: inactivo ⇒ alcance vacío
                WHERE u.id = auth.uid() AND u.is_active);
$$;

CREATE OR REPLACE FUNCTION public.my_distributor_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.distributor_id FROM public.users u
  WHERE u.id = auth.uid() AND u.is_active;  -- R3/D-3: inactivo ⇒ NULL
$$;

-- Gate de "todas las acciones" (D37): admin · rol distribuidor con
-- distributor_id · cualquier usuario con >=1 fila en user_stores.
CREATE OR REPLACE FUNCTION public.has_scope() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = auth.uid()
      AND u.is_active  -- R3/D-3
      AND (r.name = 'admin'
           OR u.distributor_id IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.user_stores us WHERE us.user_id = u.id))
  );
$$;

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

-- register_exit (D-6): MISMA fuga que register_entry (además el SELECT de
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
-- R1 / D-1 — confirm_delivery: guards de estado, idempotencia y race-safety
--  · Estado: 'delivered'/'cancelled' no admiten recepción (R1.2/R1.3).
--  · p_items: null/no-array/vacío ⇒ RAISE (R1.4).
--  · received_quantity > quantity ⇒ RAISE (R1.5), vía RETURNING (1 sentencia).
--  · Cierre condicional: UPDATE ... WHERE status <> 'delivered' + IF NOT FOUND
--    ⇒ RAISE (R1.6). El SELECT FOR UPDATE inicial ya serializa las carreras
--    (el perdedor ve 'delivered' y cae en el guard de estado); el UPDATE
--    condicional es defensa en profundidad.
-- El guard del rol es IF/ELSIF/ELSE (NULL cae al ELSE-RAISE) ⇒ NULL-safe por
-- diseño (D-4): NO se le añade COALESCE. Se conserva el upsert de dashboard
-- por línea y las subconsultas de unit_price: el batcheado (D-2) es 0010.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_delivery(
  p_order bigint, p_items jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role   text := public.my_role();
  o        public.orders%ROWTYPE;
  v_motive bigint;
  it       record;
  v_rq     numeric(12,3);
  v_qty    numeric(12,3);  -- R1.5: cantidad pedida para el upper bound
  v_st     public.order_item_status;
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
    UPDATE public.order_items oi
    SET received_quantity = it.received_quantity,
        status = CASE
                   WHEN it.received_quantity = oi.quantity THEN 'received'::public.order_item_status
                   WHEN it.received_quantity > 0          THEN 'partial'::public.order_item_status
                   ELSE 'pending'::public.order_item_status
                 END
    WHERE oi.order_id = p_order AND oi.product_id = it.product_id
    RETURNING oi.received_quantity, oi.status, oi.quantity INTO v_rq, v_st, v_qty;  -- R1.5: quantity en el mismo RETURNING
    IF NOT FOUND THEN
      RAISE EXCEPTION 'producto % no pertenece al pedido %', it.product_id, p_order;
    END IF;
    IF v_rq > v_qty THEN  -- R1.5: upper bound; el RAISE revierte la transacción completa
      RAISE EXCEPTION 'confirm_delivery: received_quantity (%) excede la cantidad pedida (%) del producto %',
        v_rq, v_qty, it.product_id;
    END IF;
    IF v_rq > 0 THEN
      -- entrada (no exit): la entrega suma stock a la tienda destino (C3)
      PERFORM public.internal_stock_entry('entry', it.product_id, o.store_id, v_rq,
                                          v_motive, p_order, o.distributor_id,
                                          (SELECT oi.unit_price FROM public.order_items oi
                                            WHERE oi.order_id = p_order AND oi.product_id = it.product_id),
                                          NULL, auth.uid());
      PERFORM public.internal_dashboard_upsert(COALESCE(o.distributor_id, 0), 1, 0,
        v_rq * (SELECT oi.unit_price FROM public.order_items oi
                 WHERE oi.order_id = p_order AND oi.product_id = it.product_id), 0);
    END IF;
  END LOOP;
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
-- R5 / D-6 — create_order: is_active de tienda, distribuidor y producto
-- Soft-delete no es borrado: una tienda/distribuidor/producto desactivado no
-- debe ser referenciable en un pedido nuevo. Se conserva el resto del cuerpo
-- (D43, unit_price congelado) — la versión set-based es 0010 (R12).
-- El guard del rol es IF/ELSIF/ELSE (NULL-safe, D-4): sin COALESCE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order(
  p_distributor bigint, p_store bigint, p_items jsonb,
  p_expected_at timestamptz DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role    text := public.my_role();
  v_order   bigint;
  it        record;
  v_count   integer := 0;
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
  INSERT INTO public.orders (distributor_id, store_id, created_by, expected_at, notes)
  VALUES (p_distributor, p_store, auth.uid(), p_expected_at, p_notes)
  RETURNING id INTO v_order;
  FOR it IN
    SELECT x.product_id, x.quantity
    FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
  LOOP
    IF it.quantity IS NULL OR it.quantity <= 0 THEN
      RAISE EXCEPTION 'create_order: quantity debe ser > 0 (producto %)', it.product_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products p  -- R5.3: soft-delete no es borrado
                   WHERE p.id = it.product_id AND p.is_active) THEN
      RAISE EXCEPTION 'producto inactivo o inexistente: %', it.product_id;
    END IF;
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    SELECT v_order, it.product_id, it.quantity, pp.price
    FROM public.price_publications pp
    WHERE pp.product_id = it.product_id AND pp.store_id = p_store AND pp.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'sin precio activo para producto % en tienda %; use set_price() primero', it.product_id, p_store;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'create_order: ningún item válido';
  END IF;
  RETURN v_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- R6 / D-6 — create_credit: rechaza pedidos cancelados (D15) + tienda activa
-- El fiado se calcula sobre lo ENTREGADO (total = Σ unit_price × quantity de
-- order_items); con el pedido cancelado el crédito no corresponde. El guard
-- <> 'admin' es NULL-unsafe ⇒ COALESCE en DECLARE (D-4 barato).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_credit(
  p_order bigint, p_due_date date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role   text := COALESCE(public.my_role(), '');  -- NULL-safe (D-4 barato)
  v_total  numeric(14,2);
  v_store  bigint;
  v_status public.order_status;
  v_id     bigint;
BEGIN
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'create_credit: solo admin';
  END IF;
  SELECT o.store_id, o.status INTO v_store, v_status
  FROM public.orders o WHERE o.id = p_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido inexistente: %', p_order; END IF;
  IF v_status = 'cancelled' THEN  -- R6.2 / D15
    RAISE EXCEPTION 'create_credit: el pedido % está cancelado; no se puede fiar', p_order;
  END IF;
  IF v_status <> 'delivered' THEN  -- D-6 / tarea 1.4: el fiado se calcula sobre lo entregado
    RAISE EXCEPTION 'create_credit: el pedido % está en estado %; el fiado solo se registra sobre pedidos delivered',
      p_order, v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.id = v_store AND s.is_active) THEN  -- D-6
    RAISE EXCEPTION 'create_credit: la tienda % del pedido está inactiva', v_store;
  END IF;
  SELECT COALESCE(sum(oi.unit_price * oi.quantity), 0) INTO v_total
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

-- ---------------------------------------------------------------------------
-- R4 / D-7 — register_payment: scope del operador post-FOR UPDATE
-- credit_payments no tiene policy de UPDATE (append-only, todo pasa por RPC)
-- ⇒ el scope se valida DENTRO de la función, tras bloquear la fila del crédito
-- (D37). Guard NOT IN ⇒ COALESCE (NULL-safe, D-4 barato).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_payment(
  p_credit bigint, p_amount numeric(14,2), p_method public.payment_method
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := COALESCE(public.my_role(), '');  -- NULL-safe (D-4 barato)
  c       public.credits%ROWTYPE;
  v_id    bigint;
  v_bal   numeric(14,2);
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'register_payment: solo admin/operador';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'register_payment: amount debe ser > 0';
  END IF;
  SELECT * INTO c FROM public.credits WHERE id = p_credit FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'crédito inexistente: %', p_credit; END IF;
  IF v_role = 'operador' AND NOT (c.store_id = ANY (public.my_store_ids())) THEN  -- R4.2 / D-7
    RAISE EXCEPTION 'register_payment: crédito fuera del alcance del operador';
  END IF;
  IF c.status = 'cancelled' THEN
    RAISE EXCEPTION 'crédito cancelado: %', p_credit;
  END IF;
  IF p_amount > c.balance THEN
    RAISE EXCEPTION 'amount % excede el saldo %; un cobro excesivo se corrige revirtiendo el pago (§3.7)', p_amount, c.balance;
  END IF;
  INSERT INTO public.credit_payments (credit_id, amount, payment_method, created_by)
  VALUES (p_credit, p_amount, p_method, auth.uid())
  RETURNING id INTO v_id;
  v_bal := c.balance - p_amount;
  UPDATE public.credits
  SET balance = v_bal,
      status = CASE WHEN v_bal = 0 THEN 'paid'::public.credit_status ELSE c.status END,
      settled_at = CASE WHEN v_bal = 0 THEN now() ELSE c.settled_at END
  WHERE id = p_credit;
  IF v_bal = 0 THEN
    PERFORM public.internal_alert_resolve('credit_overdue', NULL, NULL, c.order_id);  -- A6
  END IF;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- D34 — tope de tiendas en reactivación
-- El trigger de 0004 (§4.4) es INSERT-only ⇒ desactivar + crear + reactivar
-- evadía el tope (1 activa, 3 premium). Se recrea la función (cuerpo idéntico
-- al de 0004; se reemplaza completo por convención autocontenida D-1) y se
-- añade trg_stores_cap_reactivate BEFORE UPDATE WHEN (false → true).
-- La función es válida en ambos contextos: en BEFORE UPDATE la fila todavía
-- tiene is_active=false en la tabla ⇒ el count() no incluye la fila que se
-- reactiva ⇒ el tope se evalúa correctamente contra las demás tiendas activas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_store_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_count integer;
  v_cap   integer;
BEGIN
  IF auth.uid() IS NULL OR public.my_role() = 'admin' THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_count FROM public.stores WHERE created_by = auth.uid() AND is_active;
  v_cap := CASE WHEN public.is_premium() THEN 3 ELSE 1 END;  -- 1 activa; 3 si premium; admin exento
  IF v_count >= v_cap THEN
    RAISE EXCEPTION 'D34: tope de tiendas alcanzado (% activas, tope %)', v_count, v_cap;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stores_cap_reactivate ON public.stores;
CREATE TRIGGER trg_stores_cap_reactivate
BEFORE UPDATE ON public.stores FOR EACH ROW
WHEN (OLD.is_active = FALSE AND NEW.is_active = TRUE)
EXECUTE FUNCTION public.enforce_store_cap();

-- ---------------------------------------------------------------------------
-- R4 / D-7 — RLS: scope de tienda en credits, credit_payments, routes y
-- route_stops (patrón idéntico a orders_select de 0006). Sin rama
-- distribuidor en credits (el fiado de su tienda no es suyo — D-7).
-- Policies reemplazadas con DROP IF EXISTS + CREATE (convención 0004
-- DROP TRIGGER IF EXISTS aplicada a policies).
-- ---------------------------------------------------------------------------

-- credits (R4.1): admin todas · operador SOLO de sus tiendas.
DROP POLICY IF EXISTS credits_select ON public.credits;
CREATE POLICY credits_select ON public.credits
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids())));

-- credit_payments (R4.1): hereda el scope del crédito padre.
DROP POLICY IF EXISTS credit_payments_select ON public.credit_payments;
CREATE POLICY credit_payments_select ON public.credit_payments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.credits c
                 WHERE c.id = credit_payments.credit_id
                   AND (public.my_role() = 'admin'
                        OR (public.my_role() = 'operador'
                            AND c.store_id = ANY (public.my_store_ids())))));

-- routes (D-7): el operador pasa a ver solo rutas CON paradas en sus tiendas
-- (el índice uq_route_stops_route_order(route_id,...) cubre el EXISTS).
DROP POLICY IF EXISTS routes_select ON public.routes;
CREATE POLICY routes_select ON public.routes
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND EXISTS (SELECT 1 FROM public.route_stops rs
                         WHERE rs.route_id = routes.id
                           AND rs.store_id = ANY (public.my_store_ids())))
         OR (public.my_role() = 'distribuidor'
             AND distributor_id = public.my_distributor_id()));

-- route_stops (D-7): operador solo paradas de SUS tiendas.
DROP POLICY IF EXISTS route_stops_select ON public.route_stops;
CREATE POLICY route_stops_select ON public.route_stops
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids()))
         OR (public.my_role() = 'distribuidor'
             AND EXISTS (SELECT 1 FROM public.routes r
                         WHERE r.id = route_stops.route_id
                           AND r.distributor_id = public.my_distributor_id())));

-- Fin batch 1 (0009). Siguiente: 20261016000010_perf.sql (batch 2).
-- Smoke post-0008 (solo con ref MCP confirmada, R19.2): entry de pedido
-- ajeno falla ('pertenece a la tienda'), doble confirm falla ('ya
-- confirmado'), payment de tienda ajena falla ('fuera del alcance').

-- ============================================================================
-- INVERSE (rollback de 0009) — ejecutar en UNA transacción:
--
-- 1) Quitar el trigger nuevo (0004 no lo crea ⇒ no se restaura con él):
-- DROP TRIGGER IF EXISTS trg_stores_cap_reactivate ON public.stores;
--
-- 2) Restaurar las 4 policies a su definición de 0006:
-- DROP POLICY IF EXISTS credits_select ON public.credits;
-- CREATE POLICY credits_select ON public.credits
--   FOR SELECT TO authenticated
--   USING (public.my_role() IN ('admin', 'operador'));
-- DROP POLICY IF EXISTS credit_payments_select ON public.credit_payments;
-- CREATE POLICY credit_payments_select ON public.credit_payments
--   FOR SELECT TO authenticated
--   USING (public.my_role() IN ('admin', 'operador'));
-- DROP POLICY IF EXISTS routes_select ON public.routes;
-- CREATE POLICY routes_select ON public.routes
--   FOR SELECT TO authenticated
--   USING (public.my_role() IN ('admin', 'operador')
--          OR (public.my_role() = 'distribuidor'
--              AND distributor_id = public.my_distributor_id()));
-- DROP POLICY IF EXISTS route_stops_select ON public.route_stops;
-- CREATE POLICY route_stops_select ON public.route_stops
--   FOR SELECT TO authenticated
--   USING (public.my_role() IN ('admin', 'operador')
--          OR (public.my_role() = 'distribuidor' AND EXISTS (
--               SELECT 1 FROM public.routes r
--               WHERE r.id = route_stops.route_id
--                 AND r.distributor_id = public.my_distributor_id())));
--
-- 3) Restaurar los cuerpos de funciones pre-0009: re-ejecutar
--    20261015000004_functions_triggers.sql COMPLETO (es inmutable por
--    convención append-only; su §4.1 y §4.5-4.10 son el estado previo de
--    my_role/is_premium/has_scope/my_store_ids/my_distributor_id,
--    register_entry/register_exit/confirm_delivery/create_order/
--    create_credit/register_payment/enforce_store_cap).
--    Alternativa a nivel de archivo: git revert del commit del batch 1.
-- ============================================================================
