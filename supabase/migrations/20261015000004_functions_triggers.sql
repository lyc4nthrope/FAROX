-- ============================================================================
-- FAROX — Sprint 1, paso 4/8: funciones, triggers y RPCs (§4)
-- Spec: `Base de datos FAROX.md` — sección 4 (+ §3.9/§3.13/§7.10)
--
-- Reglas aplicadas:
--  · Toda SECURITY DEFINER lleva `SET search_path = pg_catalog, public` (§4
--    "Search path (obligatorio)") y las referencias van calificadas
--    (public.x, auth.uid()).
--  · Ninguna RPC acepta distributor_id/store_id como parámetro de ALCANCE:
--    el scope se deriva siempre en servidor desde el JWT (my_distributor_id()
--    / my_store_ids()). Los parámetros de entrada son de CONTENIDO.
--  · Gate global D37: acciones crear/actualizar no-admin exigen has_scope();
--    en tablas con scope la derivación desde el JWT ya lo garantiza.
--  · Trigger audit_diff SOLO en las 8 tablas del alcance D21 (NO en movements
--    ni chat_*). movements ya es el asiento forense.
--  · ON CONFLICT sobre uq_alert_open usa el target EXACTO con COALESCE (§3.9).
--
-- Nota (NØSEE, D44 — resuelta 2026-10-15): NØSEE tiene además el trigger auth
-- `handle_user_email_confirmed` (email confirmado ⇒ users.is_verified = TRUE).
-- Aprobado para recrear y luego REVERSADO: se confirma la eliminación de
-- §2.9/0002 ("la verifica Supabase Auth") ⇒ sin la columna el trigger fallaría
-- en runtime al confirmar el primer email. DESCARTADO: ni trigger, ni columna,
-- ni cambios de conteo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 4.1 Helpers de scope (SECURITY DEFINER STABLE)
-- ---------------------------------------------------------------------------

-- Nombre del rol del JWT; helper de todas las validaciones.
CREATE OR REPLACE FUNCTION public.my_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.name
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id
  WHERE u.id = auth.uid();
$$;

-- premium OR rol = admin (D7), leído de users — nunca del JWT.
CREATE OR REPLACE FUNCTION public.is_premium() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = auth.uid() AND (u.premium OR r.name = 'admin')
  );
$$;

-- Alcance del operador, evaluado 1 vez por query (no subconsulta correlacionada por fila).
CREATE OR REPLACE FUNCTION public.my_store_ids() RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(array_agg(us.store_id), '{}'::bigint[])
  FROM public.user_stores us
  WHERE us.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.my_distributor_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.distributor_id FROM public.users u WHERE u.id = auth.uid();
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
      AND (r.name = 'admin'
           OR u.distributor_id IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.user_stores us WHERE us.user_id = u.id))
  );
$$;

-- ---------------------------------------------------------------------------
-- 4.2 Helpers internos (NO para clientes — 0006 revoca EXECUTE)
-- ---------------------------------------------------------------------------

-- Anti-duplicados por episodio (D24): 1 alerta abierta por episodio.
-- El ON CONFLICT debe calcar carácter a carácter el índice uq_alert_open (§3.9).
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
  ON CONFLICT (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0))
  WHERE resolved_at IS NULL
  DO NOTHING;  -- nunca EXCEPTION (subtransacción en camino caliente) ni SELECT previo (carrera)
END;
$$;

-- Cierra episodios abiertos de un tipo/entidad (A6: sin cierre, el dedup
-- impediría re-alertar para siempre).
CREATE OR REPLACE FUNCTION public.internal_alert_resolve(
  p_type        public.alert_type,
  p_store_id    bigint,
  p_product_id  bigint,
  p_order_id    bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.alerts
  SET resolved_at = now()
  WHERE type = p_type
    AND resolved_at IS NULL
    AND (p_store_id   IS NULL OR store_id   IS NOT DISTINCT FROM p_store_id)
    AND (p_product_id IS NULL OR product_id IS NOT DISTINCT FROM p_product_id)
    AND (p_order_id   IS NULL OR order_id   IS NOT DISTINCT FROM p_order_id);
END;
$$;

-- Regla INV-06 EXACTA (documentada, no improvisada): alerta si quantity = 0
-- O (threshold IS NOT NULL Y quantity <= threshold). Evaluación SOLO en
-- transiciones (assign + register_*), nunca por batch (D24).
CREATE OR REPLACE FUNCTION public.internal_eval_stock_alert(
  p_store_id   bigint,
  p_product_id bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_qty      numeric(12,3);
  v_thr      numeric(12,3);
  v_msg      text;
  v_pname    text;
  v_sname    text;
BEGIN
  SELECT s.quantity, s.threshold, p.name, st.name
    INTO v_qty, v_thr, v_pname, v_sname
  FROM public.stock s
  JOIN public.products p ON p.id = s.product_id
  JOIN public.stores  st ON st.id = s.store_id
  WHERE s.product_id = p_product_id AND s.store_id = p_store_id;

  IF NOT FOUND THEN RETURN; END IF;

  IF v_qty = 0 OR (v_thr IS NOT NULL AND v_qty <= v_thr) THEN
    v_msg := v_pname || ' en ' || v_sname || ': ' ||
             CASE WHEN v_qty = 0 THEN 'sin stock' ELSE v_qty::text || ' <= umbral ' || v_thr::text END;
    PERFORM public.internal_alert_open(
      'stock_low', p_store_id, p_product_id, NULL, NULL, v_msg,
      jsonb_build_object('quantity', v_qty, 'threshold', v_thr));
  ELSE
    -- se resuelve cuando quantity > threshold (o > 0 si no hay umbral)
    PERFORM public.internal_alert_resolve('stock_low', p_store_id, p_product_id, NULL);
  END IF;
END;
$$;

-- Upsert O(1) del agregado INT-01 (D20): deltas con clampa en 0 (usado con
-- negativos por register_reverse, que "reevalúa" el dashboard).
CREATE OR REPLACE FUNCTION public.internal_dashboard_upsert(
  p_distributor_id bigint,
  p_entries_count  integer,
  p_exits_count    integer,
  p_entries_value  numeric,
  p_exits_value    numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.dashboard_daily AS d (day, distributor_id, entries_count, exits_count, entries_value, exits_value)
  VALUES (CURRENT_DATE, COALESCE(p_distributor_id, 0), p_entries_count, p_exits_count, p_entries_value, p_exits_value)
  ON CONFLICT (day, distributor_id) DO UPDATE SET
    entries_count = GREATEST(d.entries_count + EXCLUDED.entries_count, 0),
    exits_count   = GREATEST(d.exits_count   + EXCLUDED.exits_count,   0),
    entries_value = GREATEST(d.entries_value + EXCLUDED.entries_value, 0),
    exits_value   = GREATEST(d.exits_value   + EXCLUDED.exits_value,   0),
    updated_at    = now();
END;
$$;

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
-- 4.3 Triggers genéricos
-- ---------------------------------------------------------------------------

-- BEFORE UPDATE de todas las tablas mutables con updated_at.
-- (No aplica a append-only: movements, credit_payments, audit_log, chat_messages,
--  y a tablas sin updated_at: motives, route_stops, alerts, user_stores.)
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Auditoría DML (D10/D21): SOLO columnas cambiadas en UPDATE; alcance = 8
-- tablas (users, price_publications, orders, credits, credit_payments,
-- distributors, products, stores). NO audita movements (ya es el asiento
-- forense) ni chat_* (volumen máximo). Los SELECT no se auditan con triggers
-- DML (M8: la trazabilidad de tools del chatbot la lleva n8n).
CREATE OR REPLACE FUNCTION public.audit_diff() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_diff   jsonb;
  v_row_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(jsonb_object_agg(n.key, n.value), '{}'::jsonb)
      INTO v_diff
    FROM jsonb_each(to_jsonb(NEW)) AS n(key, value)
    WHERE n.value IS DISTINCT FROM to_jsonb(OLD) -> n.key;
    IF v_diff = '{}'::jsonb THEN
      RETURN NEW;  -- update sin cambios reales: no auditar
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_diff := to_jsonb(NEW) - 'search_vector';  -- tsvector derivado: ruido + peso
  ELSE
    v_diff := to_jsonb(OLD) - 'search_vector';
  END IF;

  -- row_id text (no bigint): users.id es uuid — sin esto los cambios de
  -- rol/premium (los más críticos de SEC-01) quedaban con row_id NULL (B10)
  v_row_id := COALESCE(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id');

  INSERT INTO public.audit_log (created_by, table_name, action, row_id, diff)
  VALUES (auth.uid(), TG_TABLE_NAME, lower(TG_OP)::public.audit_action, v_row_id, v_diff);
  RETURN NEW;
END;
$$;

-- M2: el precio sólo cambia vía set_price(). Rechaza UPDATE de price sobre la
-- fila activa (destruiría el histórico); apagar is_active está permitido.
CREATE OR REPLACE FUNCTION public.prevent_price_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.is_active AND NEW.price IS DISTINCT FROM OLD.price THEN
    RAISE EXCEPTION 'no se puede actualizar price sobre una fila activa; use set_price() (D27)';
  END IF;
  RETURN NEW;
END;
$$;

-- M11: red de seguridad además de update_user_role — rol distribuidor ⇒
-- distributor_id NOT NULL; otro rol ⇒ NULL (evita scope RLS huérfano).
CREATE OR REPLACE FUNCTION public.sanitize_distributor_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text;
BEGIN
  SELECT r.name INTO v_role FROM public.roles r WHERE r.id = NEW.role_id;
  IF v_role = 'distribuidor' THEN
    IF NEW.distributor_id IS NULL THEN
      RAISE EXCEPTION 'M11: el rol distribuidor requiere distributor_id';
    END IF;
  ELSE
    NEW.distributor_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- C2: sin esto el primer login no tiene fila users y todo el sistema de permisos
-- cae. Rol por defecto = operador (rol neutro de ejecución; admin luego con
-- update_user_role). Requiere el seed de roles (0005) — si falta, avisa.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.users (id, role_id, full_name, email)
  SELECT NEW.id,
         r.id,
         COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
                  NULLIF(split_part(NEW.email, '@', 1), ''),
                  'Usuario'),
         NEW.email
  FROM public.roles r
  WHERE r.name = 'operador'
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'roles sin sembrar: no existe el rol "operador" (correr 20261015000005_seeds.sql)';
  END IF;
  RETURN NEW;
END;
$$;

-- Copia de auth.users.email → users.email en ediciones posteriores
-- (PostgREST no puede leer auth.users con el JWT del cliente).
CREATE OR REPLACE FUNCTION public.sync_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.users
  SET email = NEW.email, updated_at = now()
  WHERE id = NEW.id AND public.users.email IS DISTINCT FROM NEW.email;
  RETURN NEW;
END;
$$;

-- Respaldo del tope D34 en el borde de la BD (el primario vive en create_store):
-- auth.uid() NULL (seed/migración) o admin ⇒ pasa.
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

-- §3.11: updated_at lo toca un trigger al insertar mensaje (ordenar listados).
-- Sin trigger de auditoría en chat_* (A1).
CREATE OR REPLACE FUNCTION public.touch_conversation_updated_at() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.chat_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4.4 Creación de triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
AFTER UPDATE OF email ON auth.users FOR EACH ROW
WHEN (OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION public.sync_email();

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON public.users FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_users_sanitize_scope ON public.users;
CREATE TRIGGER trg_users_sanitize_scope
BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW
EXECUTE FUNCTION public.sanitize_distributor_scope();

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON public.products FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_brands_updated_at ON public.brands;
CREATE TRIGGER trg_brands_updated_at
BEFORE UPDATE ON public.brands FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_product_categories_updated_at ON public.product_categories;
CREATE TRIGGER trg_product_categories_updated_at
BEFORE UPDATE ON public.product_categories FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_stores_updated_at ON public.stores;
CREATE TRIGGER trg_stores_updated_at
BEFORE UPDATE ON public.stores FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_stores_cap ON public.stores;
CREATE TRIGGER trg_stores_cap
BEFORE INSERT ON public.stores FOR EACH ROW
EXECUTE FUNCTION public.enforce_store_cap();

DROP TRIGGER IF EXISTS trg_price_publications_updated_at ON public.price_publications;
CREATE TRIGGER trg_price_publications_updated_at
BEFORE UPDATE ON public.price_publications FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_prevent_price_update ON public.price_publications;
CREATE TRIGGER trg_prevent_price_update
BEFORE UPDATE OF price ON public.price_publications FOR EACH ROW
EXECUTE FUNCTION public.prevent_price_update();

DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON public.orders FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_order_items_updated_at ON public.order_items;
CREATE TRIGGER trg_order_items_updated_at
BEFORE UPDATE ON public.order_items FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_stock_updated_at ON public.stock;
CREATE TRIGGER trg_stock_updated_at
BEFORE UPDATE ON public.stock FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_distributors_updated_at ON public.distributors;
CREATE TRIGGER trg_distributors_updated_at
BEFORE UPDATE ON public.distributors FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_routes_updated_at ON public.routes;
CREATE TRIGGER trg_routes_updated_at
BEFORE UPDATE ON public.routes FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_credits_updated_at ON public.credits;
CREATE TRIGGER trg_credits_updated_at
BEFORE UPDATE ON public.credits FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_chat_conversations_updated_at ON public.chat_conversations;
CREATE TRIGGER trg_chat_conversations_updated_at
BEFORE UPDATE ON public.chat_conversations FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_chat_message_touch ON public.chat_messages;
CREATE TRIGGER trg_chat_message_touch
AFTER INSERT ON public.chat_messages FOR EACH ROW
EXECUTE FUNCTION public.touch_conversation_updated_at();

DROP TRIGGER IF EXISTS trg_dashboard_daily_updated_at ON public.dashboard_daily;
CREATE TRIGGER trg_dashboard_daily_updated_at
BEFORE UPDATE ON public.dashboard_daily FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- audit_diff: SOLO las 8 tablas del alcance D21 (NO movements, NO chat_*)
DROP TRIGGER IF EXISTS trg_audit_users ON public.users;
CREATE TRIGGER trg_audit_users
AFTER INSERT OR UPDATE OR DELETE ON public.users FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();

DROP TRIGGER IF EXISTS trg_audit_products ON public.products;
CREATE TRIGGER trg_audit_products
AFTER INSERT OR UPDATE OR DELETE ON public.products FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();

DROP TRIGGER IF EXISTS trg_audit_stores ON public.stores;
CREATE TRIGGER trg_audit_stores
AFTER INSERT OR UPDATE OR DELETE ON public.stores FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();

DROP TRIGGER IF EXISTS trg_audit_distributors ON public.distributors;
CREATE TRIGGER trg_audit_distributors
AFTER INSERT OR UPDATE OR DELETE ON public.distributors FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();

DROP TRIGGER IF EXISTS trg_audit_price_publications ON public.price_publications;
CREATE TRIGGER trg_audit_price_publications
AFTER INSERT OR UPDATE OR DELETE ON public.price_publications FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();

DROP TRIGGER IF EXISTS trg_audit_orders ON public.orders;
CREATE TRIGGER trg_audit_orders
AFTER INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();

DROP TRIGGER IF EXISTS trg_audit_credits ON public.credits;
CREATE TRIGGER trg_audit_credits
AFTER INSERT OR UPDATE OR DELETE ON public.credits FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();

DROP TRIGGER IF EXISTS trg_audit_credit_payments ON public.credit_payments;
CREATE TRIGGER trg_audit_credit_payments
AFTER INSERT OR UPDATE OR DELETE ON public.credit_payments FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();

-- ---------------------------------------------------------------------------
-- 4.5 RPCs de gestión de usuarios / alcance
-- ---------------------------------------------------------------------------

-- Única vía de asignar rol y alcance de distribuidor (C2/M11/D29).
CREATE OR REPLACE FUNCTION public.update_user_role(
  p_user uuid, p_role text, p_distributor bigint DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role_id integer;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'update_user_role: solo admin';
  END IF;
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

-- D47: cierran el gap de columnas privilegiadas D45 — premium/is_active no
-- tenían ruta vía PostgREST (UPDATE de tabla completa revocado a todos los
-- roles). Mismo patrón que update_user_role: solo-admin, SET de su columna +
-- updated_at; la auditoría la escribe el trigger audit_diff sobre users.
CREATE OR REPLACE FUNCTION public.set_user_premium(
  p_user_id uuid, p_value boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'set_user_premium: solo admin';
  END IF;
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
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'set_user_active: solo admin';
  END IF;
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
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'assign_user_stores: solo admin';
  END IF;
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

-- Bootstrap de tienda (D34/D35): cualquier usuario autenticado (exento del
-- gate has_scope), valida tope (1 activa; 3 premium; admin exento), inserta la
-- tienda (created_by = auth.uid() — sin suplantación: INSERT directo revocado)
-- y auto-asoca al dueño en user_stores. Devuelve el id.
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
-- 4.6 RPCs de catálogo / precios
-- ---------------------------------------------------------------------------

-- INV-03: crea/actualiza stock y evalúa stock_low (transición, no batch).
CREATE OR REPLACE FUNCTION public.assign_product_to_store(
  p_product bigint, p_store bigint, p_threshold numeric(12,3) DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := public.my_role();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'operador') THEN
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
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'set_price: solo admin';
  END IF;
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

-- ---------------------------------------------------------------------------
-- 4.7 RPCs de inventario (D39: premium para movimientos manuales)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_entry(
  p_product bigint, p_store bigint, p_qty numeric(12,3), p_motive_id bigint,
  p_order_id bigint DEFAULT NULL, p_expiry_date date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := public.my_role();
  v_dist  bigint;
  v_price numeric(12,2);
  v_id    bigint;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'operador') THEN
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
    SELECT distributor_id, store_id INTO v_dist, v_price
    FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'pedido inexistente: %', p_order_id; END IF;
    IF v_price IS DISTINCT FROM p_store THEN
      RAISE EXCEPTION 'register_entry: pedido % pertenece a la tienda %, no a %',
                      p_order_id, v_price::bigint, p_store;
    END IF;
    SELECT oi.unit_price INTO v_price FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.product_id = p_product;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'producto % no pertenece al pedido %', p_product, p_order_id;
    END IF;
    SELECT o.distributor_id INTO v_dist FROM public.orders o WHERE o.id = p_order_id;  -- D25: derivado, nunca parámetro
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

CREATE OR REPLACE FUNCTION public.register_exit(
  p_product bigint, p_store bigint, p_qty numeric(12,3), p_motive_id bigint,
  p_order_id bigint DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := public.my_role();
  v_dist  bigint;
  v_price numeric(12,2);
  v_id    bigint;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'operador') THEN
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
    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND store_id = p_store) THEN
      RAISE EXCEPTION 'register_exit: pedido % inexistente o de otra tienda', p_order_id;
    END IF;
    SELECT oi.unit_price INTO v_price FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.product_id = p_product;
    SELECT o.distributor_id INTO v_dist FROM public.orders o WHERE o.id = p_order_id;  -- D25
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

-- Anulación por reverso (D31): 1 por original (unique parcial), tipo opuesto,
-- mismo producto/tienda, original no revertido y no siendo él mismo un reverso.
-- p_reason no tiene columna en movements (append-only sin columna de motivo):
-- se persiste en audit_log (diff JSONB, D10) — decisión documentada.
CREATE OR REPLACE FUNCTION public.register_reverse(
  p_movement_id bigint, p_reason text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  m     public.movements%ROWTYPE;
  v_opp public.movement_type;
  v_id  bigint;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'register_reverse: solo admin';
  END IF;
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

-- ---------------------------------------------------------------------------
-- 4.8 RPCs de pedidos (D39/D40/D43: pedir es feature normal, sin premium)
-- ---------------------------------------------------------------------------

-- Crea orders + order_items con unit_price congelado (D40). El precio se
-- DERIVA del listado activo de la tienda (no es parámetro ⇒ no se puede
-- manipular). p_items jsonb: [{"product_id":1,"quantity":2.5}, ...]
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
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store) THEN
    RAISE EXCEPTION 'tienda inexistente: %', p_store;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.distributors WHERE id = p_distributor) THEN
    RAISE EXCEPTION 'distribuidor inexistente: %', p_distributor;
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

-- Transiciones pending → in_route → …; 'delivered' solo la pone
-- confirm_delivery; 'cancelled' exige admin + reason (A7, CHECK lo exige).
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
  ELSIF v_role = 'operador' AND (o.store_id = ANY (public.my_store_ids())) THEN
    NULL;
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

-- Recepción atómica: register_entry POR LÍNEA (la entrega SUMA stock — C3),
-- received/status por línea, delivered_at + status='delivered' (lo exige el
-- CHECK), cierra alertas order_late. premium NO exigido (D39).
-- p_items jsonb: [{"product_id":1,"received_quantity":2.5}, ...]
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
  -- Anti doble-entrega: una 2ª llamada re-sumaría stock por cada línea
  -- (received_quantity se sobreescribe, pero internal_stock_entry ya no
  -- distingue). delivered/cancelled no son re-entregables.
  IF o.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'confirm_delivery: pedido % en estado % (no re-entregable)', p_order, o.status;
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'confirm_delivery: items requeridos';
  END IF;
  SELECT id INTO v_motive FROM public.motives WHERE name = 'reabastecimiento';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'motivo "reabastecimiento" sin sembrar (correr 0005_seeds.sql)';
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
    RETURNING oi.received_quantity, oi.status INTO v_rq, v_st;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'producto % no pertenece al pedido %', it.product_id, p_order;
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
  UPDATE public.orders SET status = 'delivered', delivered_at = now() WHERE id = p_order;  -- CHECK lo exige
  PERFORM public.internal_alert_resolve('order_late', NULL, NULL, p_order);  -- A6
END;
$$;

-- D40: RLS no filtra columnas ⇒ solo esta RPC puede omitir unit_price.
CREATE OR REPLACE FUNCTION public.get_order_items(p_order bigint)
RETURNS TABLE (
  id                 bigint,
  product_id         bigint,
  product_name       text,
  quantity           numeric(12,3),
  received_quantity  numeric(12,3),
  status             public.order_item_status,
  unit_price         numeric(12,2)
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT oi.id, oi.product_id, p.name, oi.quantity, oi.received_quantity, oi.status,
         CASE WHEN public.is_premium() THEN oi.unit_price END  -- no-premium: sabe QUÉ y CUÁNTO, no el precio
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = p_order
    AND (public.my_role() = 'admin'
         OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order
                     AND (o.store_id = ANY (public.my_store_ids())
                          OR o.distributor_id = public.my_distributor_id())));
$$;

-- ---------------------------------------------------------------------------
-- 4.9 RPCs de rutas
-- ---------------------------------------------------------------------------

-- Admin crea cualquier ruta; distribuidor solo la suya (se valida contra el
-- JWT — nunca se confía en p_distributor del cliente). p_stops jsonb:
-- [{"store_id":1,"stop_order":1,"estimated_time":"09:00"}, ...]
CREATE OR REPLACE FUNCTION public.save_route(
  p_distributor bigint, p_route_date date, p_stops jsonb DEFAULT '[]'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := public.my_role();
  v_route bigint;
  it      record;
BEGIN
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor' AND p_distributor = public.my_distributor_id() THEN
    NULL;  -- paradas propias
  ELSE
    RAISE EXCEPTION 'save_route: solo admin, o distribuidor sobre su propia ruta';
  END IF;
  IF p_route_date IS NULL THEN RAISE EXCEPTION 'save_route: route_date requerida'; END IF;
  SELECT id INTO v_route FROM public.routes
  WHERE distributor_id = p_distributor AND route_date = p_route_date AND status <> 'cancelled'
  FOR UPDATE;
  IF FOUND THEN
    DELETE FROM public.route_stops WHERE route_id = v_route;  -- reemplaza el listado completo
  ELSE
    INSERT INTO public.routes (distributor_id, route_date)
    VALUES (p_distributor, p_route_date)
    RETURNING id INTO v_route;
  END IF;
  FOR it IN
    SELECT x.store_id, x.stop_order, x.estimated_time
    FROM jsonb_to_recordset(COALESCE(p_stops, '[]'::jsonb))
      AS x(store_id bigint, stop_order smallint, estimated_time time)
  LOOP
    IF it.stop_order IS NULL OR it.stop_order <= 0 THEN
      RAISE EXCEPTION 'save_route: stop_order debe ser > 0';
    END IF;
    INSERT INTO public.route_stops (route_id, store_id, stop_order, estimated_time)
    VALUES (v_route, it.store_id, it.stop_order, it.estimated_time);
  END LOOP;
  RETURN v_route;
END;
$$;

-- Nombre único mark_stop (nit §4). Distribuidor solo paradas propias.
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
  IF NOT COALESCE(v_role = 'admin'
          OR (v_role = 'distribuidor'
              AND s.route_id IN (SELECT r.id FROM public.routes r
                                  WHERE r.distributor_id = public.my_distributor_id())), false) THEN
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

-- planned → active → completed/cancelled; distribuidor solo completed de suya (A8).
CREATE OR REPLACE FUNCTION public.update_route_status(
  p_route bigint, p_status public.route_status
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := public.my_role();
  r      public.routes%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.routes WHERE id = p_route FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ruta inexistente: %', p_route; END IF;
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor'
        AND r.distributor_id = public.my_distributor_id()
        AND r.status = 'active' AND p_status = 'completed' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'update_route_status: rol/estado no permitido (% → %)', r.status, p_status;
  END IF;
  IF NOT ((r.status = 'planned'   AND p_status IN ('active', 'cancelled')) OR
          (r.status = 'active'    AND p_status IN ('completed', 'cancelled'))) THEN
    RAISE EXCEPTION 'update_route_status: transición inválida % → %', r.status, p_status;
  END IF;
  UPDATE public.routes SET status = p_status WHERE id = p_route;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4.10 RPCs de créditos (fiado)
-- ---------------------------------------------------------------------------

-- total_amount derivado de order_items.unit_price × quantity; 1 crédito
-- vigente por pedido lo impone el unique parcial uq_credits_order_active.
CREATE OR REPLACE FUNCTION public.create_credit(
  p_order bigint, p_due_date date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_total numeric(14,2);
  v_store bigint;
  v_id    bigint;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'create_credit: solo admin';
  END IF;
  SELECT o.store_id INTO v_store FROM public.orders o WHERE o.id = p_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido inexistente: %', p_order; END IF;
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

-- Regla fija (§3.7): si balance < total_amount (ya hay cobros) PRIMERO hay que
-- revertir los pagos; un crédito con pagos no se anula con saldo.
CREATE OR REPLACE FUNCTION public.cancel_credit(
  p_credit bigint, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  c public.credits%ROWTYPE;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'cancel_credit: solo admin';
  END IF;
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

-- Valida amount <= balance, inserta pago, recalcula balance, pone paid +
-- settled_at al llegar a 0, cierra credit_overdue, audita (trigger).
CREATE OR REPLACE FUNCTION public.register_payment(
  p_credit bigint, p_amount numeric(14,2), p_method public.payment_method
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  c      public.credits%ROWTYPE;
  v_id   bigint;
  v_bal  numeric(14,2);
BEGIN
  IF public.my_role() IS NULL OR public.my_role() NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'register_payment: solo admin/operador';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'register_payment: amount debe ser > 0';
  END IF;
  SELECT * INTO c FROM public.credits WHERE id = p_credit FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'crédito inexistente: %', p_credit; END IF;
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

-- Única corrección de cobros (A5): inserta reverso (append-only intacto),
-- recalcula balance (suma el reverso), reabre status si estaba paid.
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
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'register_payment_reverse: solo admin';
  END IF;
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
-- 4.11 RPCs de alertas / stock / dashboard
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER obligatorio (el UPDATE directo está revocado): el chequeo
-- de scope vive DENTRO de la función — la RLS no aplica en DEFINER (A2).
CREATE OR REPLACE FUNCTION public.mark_alert_read(p_alert bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  a public.alerts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'mark_alert_read: requiere sesión'; END IF;
  SELECT * INTO a FROM public.alerts WHERE id = p_alert FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'alerta inexistente: %', p_alert; END IF;
  IF NOT COALESCE(public.my_role() = 'admin'
          OR (a.store_id IS NOT NULL AND a.store_id = ANY (public.my_store_ids()))
          OR (a.distributor_id IS NOT NULL AND a.distributor_id = public.my_distributor_id()), false) THEN
    RAISE EXCEPTION 'mark_alert_read: sin alcance sobre la alerta %', p_alert;
  END IF;
  UPDATE public.alerts SET read_at = now() WHERE id = p_alert AND read_at IS NULL;
END;
$$;

-- Tool del chatbot (M3): filtro en servidor, LIMIT duro, columnas mínimas.
-- distribuidor: solo tiendas de sus pedidos o de su ruta.
CREATE OR REPLACE FUNCTION public.get_stock(
  p_store bigint, p_limit int DEFAULT 50
)
RETURNS TABLE (
  product_id   bigint,
  product_name text,
  quantity     numeric(12,3),
  threshold    numeric(12,3),
  expiry_date  date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT s.product_id, p.name, s.quantity, s.threshold, s.expiry_date
  FROM public.stock s
  JOIN public.products p ON p.id = s.product_id
  WHERE s.store_id = p_store
    AND (public.my_role() = 'admin'
         OR (public.my_role() = 'operador' AND s.store_id = ANY (public.my_store_ids()))
         OR (public.my_role() = 'distribuidor'
             AND (s.store_id IN (SELECT o.store_id FROM public.orders o
                                  WHERE o.distributor_id = public.my_distributor_id())
                  OR s.store_id IN (SELECT rs.store_id FROM public.route_stops rs
                                      JOIN public.routes r ON r.id = rs.route_id
                                     WHERE r.distributor_id = public.my_distributor_id()))))
  ORDER BY s.product_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);  -- LIMIT duro
$$;

-- D39: sin premium no hay dashboard analítico. Alcance: distribuidor solo lo
-- suyo; operador ve el agregado GLOBAL en MVP (desviación A3 anotada en §8);
-- admin todo. Rango por defecto 30 días. Nunca agregación en vivo (egress).
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.day, d.distributor_id, d.entries_count, d.exits_count, d.entries_value, d.exits_value
  FROM public.dashboard_daily d
  WHERE d.day BETWEEN COALESCE(p_from, CURRENT_DATE - 30) AND COALESCE(p_to, CURRENT_DATE)
    AND public.is_premium()  -- gate premium por fila-función (evalúa 1 vez)
    AND (public.my_role() = 'admin'
         OR public.my_role() = 'operador'            -- A3: agregado global en MVP
         OR d.distributor_id = public.my_distributor_id())
  ORDER BY d.day;
$$;

-- ---------------------------------------------------------------------------
-- 4.12 RPCs de chat (M3): solo por RPC; dueño validado en servidor.
-- Excepción del gate has_scope (D37): el canal de onboarding no se bloquea.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_chat(p_title text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'create_chat: requiere sesión'; END IF;
  INSERT INTO public.chat_conversations (user_id, title)
  VALUES (auth.uid(), p_title)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation bigint, p_content text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_content IS NULL OR length(trim(p_content)) = 0 THEN
    RAISE EXCEPTION 'send_message: content requerido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_conversations cc
                  WHERE cc.id = p_conversation AND cc.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'send_message: conversación inexistente o no es suya';
  END IF;
  INSERT INTO public.chat_messages (conversation_id, role, content)
  VALUES (p_conversation, 'user', p_content)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4.13 Jobs diarios de alertas (§7.10) — ejecutados por pg_cron (0007).
-- Cierran episodios caducos además de abrir nuevos (A6: sin cierre, el dedup
-- WHERE resolved_at IS NULL impediría re-alertar para siempre).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.job_scan_expiry_soon() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  c CONSTANT integer := 15;  -- horizonte del job (constante, §3.9)
BEGIN
  -- abre
  INSERT INTO public.alerts (type, store_id, product_id, message, context)
  SELECT 'expiry_soon', s.store_id, s.product_id,
         p.name || ' en ' || st.name || ': caduca el ' || s.expiry_date ||
         ' (' || (s.expiry_date - CURRENT_DATE) || ' días)',
         jsonb_build_object('quantity', s.quantity, 'dias_restantes', s.expiry_date - CURRENT_DATE)
  FROM public.stock s
  JOIN public.products p ON p.id = s.product_id
  JOIN public.stores  st ON st.id = s.store_id
  WHERE s.expiry_date <= CURRENT_DATE + c AND s.quantity > 0
  ON CONFLICT (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0))
  WHERE resolved_at IS NULL
  DO NOTHING;
  -- cierra los que salieron del horizonte (expiry > horizon o quantity = 0)
  UPDATE public.alerts a
  SET resolved_at = now()
  WHERE a.type = 'expiry_soon' AND a.resolved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.stock s
      WHERE s.store_id = a.store_id AND s.product_id = a.product_id
        AND s.expiry_date <= CURRENT_DATE + c AND s.quantity > 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.job_scan_order_late() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- abre
  INSERT INTO public.alerts (type, store_id, order_id, distributor_id, message, context)
  SELECT 'order_late', o.store_id, o.id, o.distributor_id,
         'Pedido #' || o.id || ' atrasado (esperado ' || o.expected_at || ')',
         jsonb_build_object('esperado', o.expected_at)
  FROM public.orders o
  WHERE o.expected_at < now() AND o.delivered_at IS NULL
    AND o.status NOT IN ('delivered', 'cancelled')
  ON CONFLICT (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0))
  WHERE resolved_at IS NULL
  DO NOTHING;
  -- cierra (también se cierra en confirm_delivery/update_order_status — A6)
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
  -- abre
  INSERT INTO public.alerts (type, store_id, order_id, distributor_id, message, context)
  SELECT 'credit_overdue', c.store_id, c.order_id, o.distributor_id,
         'Crédito del pedido #' || c.order_id || ' vencido desde ' || c.due_date ||
         ' (saldo ' || c.balance || ')',
         jsonb_build_object('monto', c.balance, 'vence', c.due_date)
  FROM public.credits c
  LEFT JOIN public.orders o ON o.id = c.order_id
  WHERE c.due_date < CURRENT_DATE AND c.balance > 0 AND c.status <> 'cancelled'
  ON CONFLICT (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0))
  WHERE resolved_at IS NULL
  DO NOTHING;
  -- cierra (también se cierra en register_payment/reverse/cancel_credit — A6)
  UPDATE public.alerts a
  SET resolved_at = now()
  WHERE a.type = 'credit_overdue' AND a.resolved_at IS NULL
    AND EXISTS (SELECT 1 FROM public.credits c
                 WHERE c.order_id = a.order_id
                   AND (c.balance = 0 OR c.status = 'cancelled'));
END;
$$;

-- ---------------------------------------------------------------------------
-- 4.14 Vista stores_geo (§2.7): lat/lng calculados en SERVIDOR; el front no
-- ejecuta ST_X/ST_Y. security_invoker ⇒ respeta RLS de stores (SELECT = true).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.stores_geo
WITH (security_invoker = true) AS
SELECT s.id,
       s.name,
       s.city,
       s.country,
       s.is_active,
       public.st_x(s.location::public.geometry) AS lng,
       public.st_y(s.location::public.geometry) AS lat
FROM public.stores s;

-- Fin paso 4/8. Seeds: 0005. RLS/grants: 0006. Realtime/cron: 0007.

