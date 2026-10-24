-- ============================================================================
-- FAROX — Sprint 1 hardening, batch 3/4: SEGURIDAD (0011)
-- Spec: sdd/sprint1-hardening — R14-R17 (delta sobre 0004/0006/0009/0010)
-- Design: D-4 (assert_admin + 15 guards) · D-5 (lockdown de grants)
--
-- Reglas aplicadas:
--  · Append-only: NINGÚN archivo 0001-0010 se edita. Todo es CREATE OR
--    REPLACE completo o sentencias GRANT/REVOKE/ALTER DEFAULT PRIVILEGES
--    (convención 0004/0006/0009).
--  · Autocontención (D-1): las 12 funciones cuyo guard cambia se
--    reemplazan ÍNTEGRAS; create_credit copia el cuerpo aprobado de 0009
--    (R6/D-6 incluidos) — solo cambia el guard.
--  · Uniformidad D-4: register_entry/register_exit/register_payment NO se
--    re-definen — su guard COALESCE ya vive en 0009 (tabla D-4: "ya en
--    0009"). confirm_delivery/create_order/save_route/update_route_status/
--    update_order_status/create_store y los helpers SQL son NULL-safe por
--    diseño (IF/ELSIF/ELSE-RAISE o WHERE que niega con NULL) — NO se tocan.
--  · Sin verify (0012, batch 4) ni docs (batch docs).
--
-- ORDEN DE EJECUCIÓN CRÍTICO (D-5): este archivo corre DESPUÉS de 0009 y
-- 0010 en la MISMA ventana de mantenimiento (nota ALTO de tasks: con
-- my_role()=NULL para inactivos, cualquier hueco entre batches deja guards
-- NULL-bypass activos). Dentro del archivo: assert_admin → redefiniciones
-- → lockdown. El lockdown entero (sweep + whitelist) vive en UNA
-- transacción ⇒ sin ventana expuesta entre el REVOKE y los GRANT.
--
-- NOTA (bootstrap C2 / R16): el bypass de assert_admin usa session_user, NO
-- current_user — ver el comentario CRÍTICO en §assert_admin. handle_new_user
-- y los demás triggers NO necesitan EXECUTE al dispararse: PostgreSQL sólo
-- lo exige en CREATE TRIGGER (docs CREATE TRIGGER) ⇒ el sweep de §D-5 no
-- rompe el signup; los jobs pg_cron corren como postgres (owner).
--
-- Convención INVERSE (batch 3): bloque al final del archivo, INERTE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- D-4 / R16 — assert_admin(): guard NULL-safe unificado
-- Reemplaza los guards solo-admin de las RPCs de 0004 (tabla D-4: 15 sitios)
-- por una única rutina. NOTA histórica: el commit remoto 3444c18 ya dejó los
-- guards de 0004 NULL-safe (IS DISTINCT FROM / COALESCE(...,false) / IF-ELSIF-
-- ELSE); 0011 los CENTRALIZA acá por uniformidad D-4 + el check de is_active
-- (my_role() de 0004 no filtra is_active). Mensaje uniforme
-- 'solo admin' (contrato de test negativo de 0012 H3).
-- Sin EXECUTE para clientes (D-5): las RPC DEFINER la invocan como owner
-- (postgres) — anon/authenticated reciben permission denied ANTES del body.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_admin() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_ok boolean;
BEGIN
  -- CRÍTICO: session_user, NO current_user. Dentro de SECURITY DEFINER,
  -- current_user SIEMPRE es el owner (postgres) ⇒ "current_user='postgres'"
  -- dejaría pasar a TODOS (bypass total del guard). En PostgREST,
  -- session_user = 'authenticator' (nunca 'postgres') ⇒ anon y clientes
  -- jamás toman el bypass; la sesión del SQL editor/MCP (session_user =
  -- 'postgres', sin JWT ⇒ auth.uid() IS NULL) sí, preservando el bootstrap
  -- del primer admin (C2, R16.3).
  IF session_user = 'postgres' AND auth.uid() IS NULL THEN
    RETURN;  -- sesión del SQL editor: bootstrap del primer admin (C2)
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.users u JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = auth.uid() AND r.name = 'admin' AND u.is_active
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'solo admin'; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- D-4 — Guard reemplazado por assert_admin() en las 9 RPCs solo-admin de
-- 0004 (update_user_role L544, set_user_premium L575, set_user_active L592,
-- assign_user_stores L611, set_price L697, register_reverse L829,
-- create_credit L1189, cancel_credit L1220, register_payment_reverse L1289;
-- refs post-3444c18 — citar por nombre de función, las líneas derivan).
-- Cuerpos tomados de los aprobados (0004; create_credit = cuerpo de 0009),
-- único cambio funcional: el guard. IMPORTANTE: los guards de 0004 ya eran
-- NULL-safe post-3444c18 (IS DISTINCT FROM / COALESCE(...,false)); la
-- motivación de reemplazarlos es la UNIFORMIDAD de mensaje ('solo admin',
-- test H3 de 0012) + is_active enforced dentro de assert_admin — NO un fix
-- de NULL-bypass.
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

-- Única escritura de user_stores (A1): sin esto un operador podría
-- auto-insertarse filas y escalar su propio alcance RLS.
CREATE OR REPLACE FUNCTION public.assign_user_stores(
  p_user uuid, p_stores bigint[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.assert_admin();  -- D-4
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'usuario inexistente: %', p_user;
  END IF;
  -- 1 transacción: borra los ausentes, inserta los nuevos
  DELETE FROM public.user_stores us
  WHERE us.user_id = p_user AND NOT (us.store_id = ANY (COALESCE(p_stores, '{}'::bigint[])));
  INSERT INTO public.user_stores (user_id, store_id)
  SELECT p_user, s FROM unnest(COALESCE(p_stores, '{}'::bigint[])) AS s
  ON CONFLICT DO NOTHING;
END;
$$;

-- Única mutación de precios (D17/D27): SELECT ... FOR UPDATE serializa
-- concurrentes + fila nueva activa + desactiva la anterior (histórico intacto).
CREATE OR REPLACE FUNCTION public.set_price(
  p_product bigint, p_store bigint, p_price numeric(12,2), p_currency char(3) DEFAULT 'COP'
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_prev bigint;
  v_id   bigint;
BEGIN
  PERFORM public.assert_admin();  -- D-4
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'set_price: price debe ser > 0 (D27)';
  END IF;
  SELECT id INTO v_prev
  FROM public.price_publications
  WHERE product_id = p_product AND store_id = p_store AND is_active
  FOR UPDATE;  -- lock de la fila activa previa
  IF FOUND THEN
    UPDATE public.price_publications SET is_active = false WHERE id = v_prev;  -- permitido: solo apagar is_active
  END IF;
  INSERT INTO public.price_publications (product_id, store_id, created_by, price, currency)
  VALUES (p_product, p_store, auth.uid(), p_price, COALESCE(p_currency, 'COP'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

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

-- Regla fija (§3.7): si balance < total_amount (ya hay cobros) PRIMERO hay que
-- revertir los pagos; un crédito con pagos no se anula con saldo.
-- create_credit/cancel_credit: create_credit trae el cuerpo aprobado de 0009
-- (R6/D-6: rechaza cancelled, exige delivered, tienda activa); único cambio
-- el guard D-4. Review batch1 #3: la fórmula Σ unit_price × quantity usa
-- quantity = lo PEDIDO (corrección de comment diferida al batch docs, R20).
CREATE OR REPLACE FUNCTION public.create_credit(
  p_order bigint, p_due_date date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_total  numeric(14,2);
  v_store  bigint;
  v_status public.order_status;
  v_id     bigint;
BEGIN
  PERFORM public.assert_admin();  -- D-4: reemplaza COALESCE(my_role(),'') <> 'admin' (0009)
  SELECT o.store_id, o.status INTO v_store, v_status
  FROM public.orders o WHERE o.id = p_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido inexistente: %', p_order; END IF;
  IF v_status = 'cancelled' THEN  -- R6.2 / D15
    RAISE EXCEPTION 'create_credit: el pedido % está cancelado; no se puede fiar', p_order;
  END IF;
  IF v_status <> 'delivered' THEN  -- D-6: el fiado solo se registra sobre pedidos delivered
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

CREATE OR REPLACE FUNCTION public.cancel_credit(
  p_credit bigint, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  c public.credits%ROWTYPE;
BEGIN
  PERFORM public.assert_admin();  -- D-4
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'cancel_credit: reason requerido';
  END IF;
  SELECT * INTO c FROM public.credits WHERE id = p_credit FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'crédito inexistente: %', p_credit; END IF;
  IF c.status = 'cancelled' THEN RETURN; END IF;  -- idempotente
  IF c.balance < c.total_amount THEN
    RAISE EXCEPTION 'el crédito tiene cobros (saldo % < total %); revertir pagos con register_payment_reverse primero', c.balance, c.total_amount;
  END IF;
  UPDATE public.credits
  SET status = 'cancelled', cancelled_at = now(), cancelled_reason = p_reason
  WHERE id = p_credit;
  PERFORM public.internal_alert_resolve('credit_overdue', NULL, NULL, c.order_id);  -- A6
END;
$$;

-- Única corrección de cobros (A5): inserta reverso (append-only intacto),
-- recalcula balance (suma el reverso), reabre status si estaba paid.
-- (D-4: sitio register_payment_reverse/L1289, hallado en verificación — no estaba en la propuesta.)
CREATE OR REPLACE FUNCTION public.register_payment_reverse(
  p_payment bigint, p_reason text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  p      public.credit_payments%ROWTYPE;
  c      public.credits%ROWTYPE;
  v_id   bigint;
  v_bal  numeric(14,2);
BEGIN
  PERFORM public.assert_admin();  -- D-4
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'register_payment_reverse: reason requerido';
  END IF;
  SELECT * INTO p FROM public.credit_payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pago inexistente: %', p_payment; END IF;
  IF p.reverso_of_id IS NOT NULL THEN
    RAISE EXCEPTION 'D31/A5: no se puede revertir un reverso (pago % ya es un reverso)', p_payment;
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_payments cp WHERE cp.reverso_of_id = p_payment) THEN
    RAISE EXCEPTION 'A5: el pago % ya fue revertido', p_payment;
  END IF;
  SELECT * INTO c FROM public.credits WHERE id = p.credit_id FOR UPDATE;
  INSERT INTO public.credit_payments (credit_id, amount, reverso_of_id, payment_method, created_by)
  VALUES (p.credit_id, p.amount, p_payment, p.payment_method, auth.uid())
  RETURNING id INTO v_id;
  v_bal := c.balance + p.amount;  -- el reverso SUMA al saldo
  UPDATE public.credits
  SET balance = v_bal,
      status = CASE WHEN c.status = 'paid' THEN 'pending'::public.credit_status ELSE c.status END,
      settled_at = CASE WHEN c.status = 'paid' THEN NULL ELSE c.settled_at END  -- reabre si estaba saldado
  WHERE id = p.credit_id;
  IF v_bal > 0 AND c.due_date IS NOT NULL AND c.due_date < CURRENT_DATE AND c.status <> 'cancelled' THEN
    -- reabre credit_overdue (1 alerta abierta por episodio — D24)
    PERFORM public.internal_alert_open('credit_overdue', c.store_id, NULL, c.order_id,
      (SELECT o.distributor_id FROM public.orders o WHERE o.id = c.order_id),
      'Crédito del pedido #' || c.order_id || ' vencido (reabierto tras reverso)',
      jsonb_build_object('monto', v_bal));
  END IF;
  INSERT INTO public.audit_log (created_by, table_name, action, row_id, diff)
  VALUES (auth.uid(), 'credit_payments', 'update', p_payment::text,
          jsonb_build_object('reverso_of_id', v_id, 'reason', p_reason));
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- D-4 — Guard COALESCE / reestructuración en las 3 restantes de la tabla D-4
-- (assign_product_to_store L673, mark_stop L1125, mark_alert_read L1343 de
-- 0004 post-3444c18 — los sitios register_entry L729, register_exit L781,
-- register_payment L1248 ya los cerró 0009 con COALESCE). Ojo: la paridad de
-- cuerpos con 0004 NO garantiza paridad de DEFENSA NULL — auditar el guard
-- compound de mark_alert_read contra el patrón COALESCE remoto.
-- ---------------------------------------------------------------------------

-- INV-03: crea/actualiza stock y evalúa stock_low (transición, no batch).
CREATE OR REPLACE FUNCTION public.assign_product_to_store(
  p_product bigint, p_store bigint, p_threshold numeric(12,3) DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');  -- D-4: '' no es ningún rol ⇒ NOT IN rechaza
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'assign_product_to_store: solo admin/operador';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'assign_product_to_store: tienda fuera del alcance del operador';
  END IF;
  INSERT INTO public.stock AS st (product_id, store_id, threshold)
  VALUES (p_product, p_store, p_threshold)
  ON CONFLICT (product_id, store_id) DO UPDATE
  SET threshold = COALESCE(EXCLUDED.threshold, st.threshold),  -- NULL no borra umbral existente
      updated_at = now();
  PERFORM public.internal_eval_stock_alert(p_store, p_product);
END;
$$;

-- Nombre único mark_stop (nit §4). Distribuidor solo paradas propias.
-- D-4: el guard compound NOT (v_role='admin' OR ...) era NULL-bypass (todo
-- NULL ⇒ NOT NULL ⇒ NULL ⇒ no tomado ⇒ pasaba). Se reestructura al patrón
-- IF admin / ELSIF distribuidor / ELSE RAISE idéntico de update_route_status
-- (NULL cae al ELSE-RAISE).
CREATE OR REPLACE FUNCTION public.mark_stop(
  p_stop bigint, p_status public.stop_status, p_arrived timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := public.my_role();
  s      public.route_stops%ROWTYPE;
BEGIN
  SELECT rs.* INTO s
  FROM public.route_stops rs
  JOIN public.routes r ON r.id = rs.route_id
  WHERE rs.id = p_stop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'parada inexistente: %', p_stop; END IF;
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor'
        AND s.route_id IN (SELECT r.id FROM public.routes r
                            WHERE r.distributor_id = public.my_distributor_id()) THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'mark_stop: sin alcance sobre la parada %', p_stop;
  END IF;
  IF s.status NOT IN ('pending', 'arrived') AND p_status <> s.status THEN
    RAISE EXCEPTION 'mark_stop: transición inválida % → %', s.status, p_status;
  END IF;
  UPDATE public.route_stops
  SET status = p_status,
      arrived_at = CASE WHEN p_status = 'arrived' AND arrived_at IS NULL THEN COALESCE(p_arrived, now())
                        ELSE arrived_at END
  WHERE id = p_stop;
END;
$$;

-- SECURITY DEFINER obligatorio (el UPDATE directo está revocado): el chequeo
-- de scope vive DENTRO de la función — la RLS no aplica en DEFINER (A2).
-- D-4: el guard compound es NULL-able en el ÚLTIMO disjuncto (caller sin
-- distributor_id o inactivo ⇒ my_distributor_id() = NULL): false OR false OR
-- NULL = NULL ⇒ IF NOT NULL no tomado ⇒ bypass (patrón 0004 L1351). El
-- COALESCE del DECLARE solo neutraliza el PRIMER disjuncto; por eso el
-- COALESCE envuelve la expresión COMPLETA: NULL ⇒ false ⇒ RAISE.
CREATE OR REPLACE FUNCTION public.mark_alert_read(p_alert bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');  -- D-4: NULL-safe
  a      public.alerts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'mark_alert_read: requiere sesión'; END IF;
  SELECT * INTO a FROM public.alerts WHERE id = p_alert FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'alerta inexistente: %', p_alert; END IF;
  IF NOT COALESCE(v_role = 'admin'
          OR (a.store_id IS NOT NULL AND a.store_id = ANY (public.my_store_ids()))
          OR (a.distributor_id IS NOT NULL AND a.distributor_id = public.my_distributor_id()), false) THEN
    RAISE EXCEPTION 'mark_alert_read: sin alcance sobre la alerta %', p_alert;
  END IF;
  UPDATE public.alerts SET read_at = now() WHERE id = p_alert AND read_at IS NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- D-5 / R14-R15 — Lockdown de grants (deny-by-default)
-- Orden exacto del design; MISMA transacción ⇒ sin ventana expuesta.
-- 1) Default privileges futuras · 2) sweep inmediato · 3) whitelist
-- · 4) PostGIS · 5) tablas · 6) audit_log append-only.
-- ---------------------------------------------------------------------------

-- 1) Default privileges FUTURAS. PUBLIC sin IN SCHEMA (bug PG #8685: la
--    combinación IN SCHEMA + FROM PUBLIC es silenciosamente no-op); roles
--    concretos SÍ con IN SCHEMA. Efecto: toda función nueva creada por
--    postgres nace SIN EXECUTE para clientes — deny-by-default; cada
--    migración futura debe traer su GRANT explícito (convención).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- 2) Sweep inmediato: mata el grant PUBLIC de EXECUTE (CRIT-1: cualquier
--    cliente podía invocar internal_* y las RPC saltándose el check de rol
--    del caller) y deja a anon sin UNA sola función ejecutable en public.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

-- 3) Whitelist explícita (26 RPC + 5 helpers = 31) para authenticated y
--    service_role. Los 5 helpers DEBEN quedar ejecutables o RLS revienta
--    (las policies los invocan como el rol consultante): my_role,
--    is_premium, my_store_ids, my_distributor_id, has_scope.
--    service_role entra en la whitelist por integración n8n/servidor
--    (bypassrls-equivalente: no sumaba seguridad negárselo — D-5).
--    internal_* (5), job_scan_* (3), assert_admin y las 8 trigger
--    functions NO reciben grant (deny-list): los RPC/trigger/jobs los
--    invocan como owner postgres.
--    Firmas = pg_get_function_identity_arguments (typmods incluidos:
--    numeric(12,3)/char(3)/geography(Point,4326) son parte de la identidad).
GRANT EXECUTE ON FUNCTION
  public.my_role(),
  public.is_premium(),
  public.my_store_ids(),
  public.my_distributor_id(),
  public.has_scope(),
  public.update_user_role(uuid, text, bigint),
  public.set_user_premium(uuid, boolean),
  public.set_user_active(uuid, boolean),
  public.assign_user_stores(uuid, bigint[]),
  public.create_store(text, integer, text, text, text, public.geography(Point,4326), text, char(2)),
  public.assign_product_to_store(bigint, bigint, numeric(12,3)),
  public.set_price(bigint, bigint, numeric(12,2), char(3)),
  public.register_entry(bigint, bigint, numeric(12,3), bigint, bigint, date),
  public.register_exit(bigint, bigint, numeric(12,3), bigint, bigint),
  public.register_reverse(bigint, text),
  public.create_order(bigint, bigint, jsonb, timestamptz, text),
  public.update_order_status(bigint, public.order_status, text),
  public.confirm_delivery(bigint, jsonb),
  public.get_order_items(bigint),
  public.save_route(bigint, date, jsonb),
  public.mark_stop(bigint, public.stop_status, timestamptz),
  public.update_route_status(bigint, public.route_status),
  public.create_credit(bigint, date),
  public.cancel_credit(bigint, text),
  public.register_payment(bigint, numeric(14,2), public.payment_method),
  public.register_payment_reverse(bigint, text),
  public.mark_alert_read(bigint),
  public.get_stock(bigint, integer),
  public.get_dashboard(date, date),
  public.create_chat(text),
  public.send_message(bigint, text)
TO authenticated, service_role;

-- 4) PostGIS (open question D-5 / task 0.3): stores_geo es
--    WITH (security_invoker = true) ⇒ el CLIENTE ejecuta
--    public.st_x(s.location::public.geometry) / st_y / el cast
--    geography→geometry COMO CLIENTE — el sweep de (2) les revocó EXECUTE.
--    PRE-CHECK (informativo, sólo lectura de catálogo): muestra las firmas
--    EXACTAS de pg_proc ANTES del GRANT. Si geometry(geography) no aparece
--    con esa firma en el resultado, ajustar el GRANT de abajo al catálogo
--    real antes de commit del apply (verificado por 0012 H1/H4).
SELECT p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (p.proname IN ('st_x', 'st_y')
       OR (p.proname = 'geometry'
           AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'geography'))
ORDER BY 1, 2;

GRANT EXECUTE ON FUNCTION
  public.st_x(public.geometry),
  public.st_y(public.geometry),
  public.geometry(public.geography)
TO authenticated;

-- 5) Tablas: anon pierde TODO acceso a las tablas/sequences de public (el
--    default de Supabase les grantea ALL; R17.1: anon no lee ni escribe
--    nada — toda vía es RPC con JWT). El REVOKE explícito de SELECT sobre
--    user_stores/order_items (defensa en profundidad, ya revocado a
--    authenticated en 0006 L373) documenta la intención aunque el sweep
--    cubre tablas futuras. Default privileges: tablas/sequences futuras
--    tampoco nacen accesibles para anon.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE SELECT ON public.user_stores, public.order_items FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- 6) R17.2 — audit_log append-only TAMBIÉN para service_role: pierde
--    UPDATE/DELETE (SELECT ya lo tenía; INSERT lo conserva para eventos de
--    integración — el trigger audit_diff escribe como owner).
REVOKE UPDATE, DELETE ON public.audit_log FROM service_role;

-- Fin batch 3 (0011). Siguiente: 20261016000012_verify_hardening.sql (batch 4).
-- Smoke post-0011 (fixtures, solo con ref MCP confirmada, R19.2):
--  · anon + anon key → cualquier RPC ⇒ permission denied (ANTES del body).
--  · operador activo → set_user_premium ⇒ 'solo admin' (assert_admin).
--  · usuario inactivo admin → update_user_role ⇒ 'solo admin' (is_active).
--  · sesión SQL editor (postgres, sin JWT) → update_user_role ⇒ OK
--    (bootstrap C2 intacto vía bypass session_user).
--  · authenticated → stores_geo ⇒ OK (re-grant PostGIS st_x/st_y/cast).
--  · authenticated → internal_alert_open/job_scan_* ⇒ permission denied.

-- ============================================================================
-- INVERSE (rollback de 0011) — ejecutar en UNA transacción, ASUMIENDO 0010
-- aplicado. El estado resultante = post-0010.
--
-- ⚠ ALERTA: los pasos 3 y 5 restauran el flaw CRIT-1 (EXECUTE PUBLIC y
-- acceso de anon a tablas) — es lo que "rollback" significa, pero NO es un
-- estado al que volver en producción salvo emergencia real; si el problema
-- es puntual de una RPC, preferir un GRANT quirúrgico sobre la whitelist.
--
-- 1) Quitar el helper nuevo (0004 no lo crea ⇒ no se restaura con él):
-- DROP FUNCTION IF EXISTS public.assert_admin();
--
-- 2) Restaurar los cuerpos de funciones pre-0011: re-ejecutar, EN ESTE
--    ORDEN (los tres archivos son idempotentes por convención append-only):
--      a) 20261015000004_functions_triggers.sql COMPLETO
--      b) 20261016000009_negocio.sql COMPLETO
--      c) 20261016000010_perf.sql COMPLETO
--    El ORDEN importa: (a) revierte las 12 funciones de este batch a sus
--    guards pre-0011 — que post-3444c18 ya son NULL-safe en 0004 (IS
--    DISTINCT FROM / COALESCE(...,false) / IF-ELSIF-ELSE); lo que se PIERDE
--    con el rollback es el mensaje uniforme 'solo admin' y el is_active
--    dentro de assert_admin, NO la NULL-safety; (b) restaura los fixes de
--    negocio (incl. create_credit/register_payment COALESCE); (c) restaura
--    confirm_delivery/create_order/audit_diff/get_dashboard aprobados.
--    Alternativa a nivel de archivo: git revert del commit del batch 3.
--
-- 3) Restaurar grants de funciones (vuelve el flaw CRIT-1, ver ALERTA):
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC;
--
-- 4) Restaurar default privileges de funciones (best-effort; sólo afecta a
--    objetos FUTUROS — los ya creados conservan el ACL resultante del 3):
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--   GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
--
-- 5) Restaurar acceso de anon a tablas/sequences (vuelve el flaw, ver
--    ALERTA; el GRANT SELECT de user_stores/order_items replicaba el
--    estado pre-0006-documentado, con policy inactiva a propósito):
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
-- GRANT SELECT ON public.user_stores, public.order_items TO anon;
--
-- 6) Restaurar DML de service_role sobre audit_log:
-- GRANT UPDATE, DELETE ON public.audit_log TO service_role;
--
-- 7) PostGIS: los 3 re-grants (st_x, st_y, geometry(geography)) se DEJAN —
--    pre-0011 authenticated ya los tenía vía default privileges; quitarlos
--    rompería stores_geo.
-- ============================================================================
