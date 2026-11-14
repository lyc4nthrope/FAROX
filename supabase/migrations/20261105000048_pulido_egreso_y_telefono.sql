-- ============================================================================
-- FAROX — 0048: pulido de 0040-0042, privilegios y egreso.
--
-- QUÉ CORRIGE (todo lo que no se puede tocar en archivos ya versionados)
--   1. pgcrypto: 0042 usa extensions.gen_random_bytes/digest pero 0001 solo crea
--      postgis y pg_cron. Funciona porque Supabase lo trae por defecto, pero la
--      dependencia no estaba declarada: si falta, la RPC revienta en la primera
--      llamada (el cuerpo PL/pgSQL no se valida al crear la función).
--   2. internal_user_margin_pct(uuid) quedó con EXECUTE para PUBLIC. El barrido
--      deny-by-default de 0011 es una foto, no un ALTER DEFAULT PRIVILEGES: toda
--      función creada después nace ejecutable por anon/authenticated. Con
--      SECURITY DEFINER, eso deja leer el margen de cualquier usuario por UUID.
--   3. normalize_phone_e164: un fijo colombiano de 10 dígitos ('601...') no
--      empieza en 3 y salía como +60... (Malasia). El usuario nunca podía
--      verificar porque el wa_id real no matcheaba. Ahora respeta el '+' y
--      acepta móvil 3xx y fijo 60x.
--   4. users.phone_number se normaliza en toda escritura (trigger único que
--      además limpia phone_verified_at al cambiar de número). Antes solo el
--      flujo de verificación normalizaba; el perfil guardaba texto libre.
--   5. Retención de phone_verifications (crecía sin límite).
--   6. EGRESO: el cliente podía leer chat_messages.payload (hasta 16 KB por
--      fila de tool-call). Se revoca a nivel columna; el cliente ya pide
--      columnas explícitas y nunca usó payload.
--   7. EGRESO: el rate limit de send_message contaba por conversación
--      (conversation_id, created_at). Como filtra por user_id, el plan recorría
--      TODAS las conversaciones del usuario; el costo crecía con la antigüedad
--      de la cuenta. Índice por created_at + consulta semi-join.
--   8. EGRESO: register_movements_bulk hacía un upsert de dashboard_daily por
--      línea (100 eventos realtime por ticket de 100 líneas). Ahora agrega y
--      hace UNO. Mismo estado final, un evento.
--   9. VALIDATE de los *_maxlen/*_maxbytes de 0040/0041, best-effort: si hay
--      data vieja fuera de rango deja WARNING y el constraint sigue NOT VALID.
--      OJO: re-ejecutar 0040/0041 des-valida (DROP + ADD NOT VALID).
--
-- NO TOCA: contratos públicos de RPC, firmas ni grants existentes.
--
-- EGRESO — lo que NO se toca y por qué: el cliente ya usa listas de columnas
-- explícitas (products/api.ts:47-53 excluye description del listado; el
-- catálogo de precios pide solo product_id+precio, límite 500). El problema no
-- estaba en las consultas de lectura sino en payload y en realtime.
-- ============================================================================

-- ============================================================================
-- 1. Dependencia explícita de pgcrypto.
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    EXECUTE 'CREATE SCHEMA IF NOT EXISTS extensions';
    EXECUTE 'CREATE EXTENSION pgcrypto WITH SCHEMA extensions';
  END IF;
END $$;

-- ============================================================================
-- 2. Privilegios de funciones internas creadas después del barrido de 0011.
--    SECURITY DEFINER ⇒ el caller no necesita EXECUTE; los RPC que la usan
--    corren como owner.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.internal_user_margin_pct(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.internal_sale_price_from_cost(numeric, numeric)
  FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. Normalizador E.164 v2.
--    Reglas (el '+' manda):
--      · '+' explícito          ⇒ se respeta (cualquier país).
--      · '00' inicial           ⇒ se descarta el prefijo internacional.
--      · 10 dígitos 3xx / 60x   ⇒ Colombia (+57): móvil y fijo.
--      · 10 dígitos sin '+'     ⇒ se rechaza: sin prefijo no hay país.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.normalize_phone_e164(p_phone text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE
  v_raw    text := btrim(COALESCE(p_phone, ''));
  v_digits text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
BEGIN
  IF v_digits = '' THEN
    RAISE EXCEPTION 'phone: número requerido';
  END IF;

  IF left(v_raw, 1) = '+' THEN
    NULL;  -- prefijo internacional explícito: no se asume país
  ELSIF left(v_digits, 2) = '00' THEN
    v_digits := substr(v_digits, 3);
  ELSIF length(v_digits) = 10
        AND (left(v_digits, 1) = '3' OR left(v_digits, 2) = '60') THEN
    v_digits := '57' || v_digits;   -- Colombia (stores.country DEFAULT 'CO')
  ELSIF length(v_digits) = 10 THEN
    RAISE EXCEPTION 'phone: falta el prefijo internacional (ej. +57 300 123 4567)';
  END IF;

  IF length(v_digits) < 8 OR length(v_digits) > 15 THEN
    RAISE EXCEPTION 'phone: número inválido';
  END IF;

  RETURN '+' || v_digits;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.normalize_phone_e164(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- 4. Un solo trigger: normaliza y limpia la verificación en el mismo paso.
--    Antes eran dos triggers BEFORE UPDATE y el orden alfabético hacía que el
--    de limpieza corriera primero: reescribir el mismo número con otro formato
--    ('300 222 3333' → '+573002223333') borraba la verificación aunque el
--    valor normalizado fuera idéntico.
--    UPDATE OF phone_number: un cambio de nombre no re-valida un teléfono
--    viejo que ya estaba fuera de formato.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.normalize_user_phone()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_old text;
BEGIN
  -- Camino rápido: el UPDATE no cambió el número. Importa porque el perfil
  -- manda siempre las 3 columnas: sin esto, un teléfono legado fuera de formato
  -- bloquearía cualquier guardado del perfil (y no se debe re-validar un dato
  -- que el usuario no tocó).
  IF TG_OP = 'UPDATE' AND NEW.phone_number IS NOT DISTINCT FROM OLD.phone_number THEN
    RETURN NEW;
  END IF;

  IF NEW.phone_number IS NULL OR btrim(NEW.phone_number) = '' THEN
    NEW.phone_number := NULL;
  ELSE
    NEW.phone_number := public.normalize_phone_e164(NEW.phone_number);
  END IF;

  -- Comparar contra el valor VIEJO normalizado: reescribir el mismo número con
  -- otro formato ('300 222 3333' → '+573002223333') no es un cambio de número
  -- y no debe borrar la verificación.
  IF TG_OP = 'UPDATE' AND NEW.phone_verified_at IS NOT DISTINCT FROM OLD.phone_verified_at THEN
    v_old := OLD.phone_number;
    BEGIN
      v_old := public.normalize_phone_e164(OLD.phone_number);
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- legado no normalizable: se compara contra el texto crudo
    END;
    IF NEW.phone_number IS DISTINCT FROM v_old THEN
      NEW.phone_verified_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_clear_phone_verification ON public.users;
DROP TRIGGER IF EXISTS trg_users_normalize_phone ON public.users;
CREATE TRIGGER trg_users_normalize_phone
BEFORE INSERT OR UPDATE OF phone_number ON public.users
FOR EACH ROW EXECUTE FUNCTION public.normalize_user_phone();

DROP FUNCTION IF EXISTS public.clear_phone_verification_on_change();

-- Backfill tolerante: normaliza lo que se puede y deja WARNING con el resto.
-- Un usuario ya verificado tiene el número normalizado, así que el UPDATE no
-- lo toca y no pierde la verificación.
DO $$
DECLARE
  r      record;
  v_norm text;
BEGIN
  FOR r IN
    SELECT id, phone_number FROM public.users WHERE phone_number IS NOT NULL
  LOOP
    BEGIN
      v_norm := public.normalize_phone_e164(r.phone_number);
      IF v_norm IS DISTINCT FROM r.phone_number THEN
        UPDATE public.users SET phone_number = v_norm WHERE id = r.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '0048: users.% conserva un teléfono no normalizable (%)',
        r.id, r.phone_number;
    END;
  END LOOP;
END $$;

-- ============================================================================
-- 5. Retención de códigos OTP. 3 por usuario/hora, pero nada los borraba.
-- ============================================================================
DO $$
DECLARE j record;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job WHERE jobname = 'farox_phone_verifications_purge'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

SELECT cron.schedule('farox_phone_verifications_purge', '25 4 * * *',
  $$DELETE FROM public.phone_verifications
     WHERE created_at < now() - interval '2 days'$$);

-- ============================================================================
-- 6. EGRESO — chat_messages: payload fuera del alcance del cliente.
--    role='tool' guarda {args, result} del asistente, hasta 16 KB por fila.
--    Ninguna pantalla lo lee (solo lo escribe el agente con service_role).
--    El grant por columna además obliga a select explícito: un select('*')
--    falla en vez de arrastrar el payload.
-- ============================================================================
REVOKE SELECT ON public.chat_messages FROM authenticated, anon;
GRANT SELECT (id, conversation_id, role, content, created_at)
  ON public.chat_messages TO authenticated;

-- ============================================================================
-- 7. EGRESO — rate limit de chat por created_at.
--    El índice (conversation_id, created_at) WHERE role='user' no sirve para
--    filtrar por dueño: el plan baja por todas las conversaciones del usuario.
--    Un índice por created_at acota el rango a la última hora y el semi-join
--    descarta lo ajeno.
-- ============================================================================
DROP INDEX IF EXISTS public.idx_chat_messages_user_rate;
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_hour
  ON public.chat_messages (created_at)
  WHERE role = 'user';

CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation bigint, p_content text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id    bigint;
  v_count integer;
BEGIN
  IF p_content IS NULL OR length(trim(p_content)) = 0 THEN
    RAISE EXCEPTION 'send_message: content requerido';
  END IF;
  IF char_length(p_content) > 800 THEN
    RAISE EXCEPTION 'send_message: content supera 800 caracteres';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_conversations cc
                  WHERE cc.id = p_conversation AND cc.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'send_message: conversación inexistente o no es suya';
  END IF;

  -- 0048: rango por created_at + semi-join por dueño (índice parcial nuevo).
  SELECT count(*) INTO v_count
    FROM public.chat_messages cm
   WHERE cm.role = 'user'
     AND cm.created_at > now() - interval '1 hour'
     AND cm.conversation_id IN (
       SELECT cc.id FROM public.chat_conversations cc WHERE cc.user_id = auth.uid()
     );

  IF v_count >= 120 THEN
    RAISE EXCEPTION 'send_message: límite de 120 mensajes por hora';
  END IF;

  INSERT INTO public.chat_messages (conversation_id, role, content)
  VALUES (p_conversation, 'user', p_content)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ============================================================================
-- 8. EGRESO — un solo evento realtime por ticket.
--    internal_dashboard_upsert respeta la marca transaccional
--    'farox.batch_dashboard': cuando está en 'on' no escribe. El lote acumula
--    el delta real leyendo los movements que acaba de insertar y hace UN
--    upsert al final. La marca es LOCAL a la transacción (set_config ... true)
--    y solo la prende register_movements_bulk.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.internal_dashboard_upsert(
  p_distributor_id bigint,
  p_entries_count  integer,
  p_exits_count    integer,
  p_entries_value  numeric,
  p_exits_value    numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- 0048: dentro de un lote, el caller agrega y upsertea una vez.
  IF current_setting('farox.batch_dashboard', true) = 'on' THEN
    RETURN;
  END IF;

  INSERT INTO public.dashboard_daily AS d
    (day, distributor_id, entries_count, exits_count, entries_value, exits_value)
  VALUES (CURRENT_DATE, COALESCE(p_distributor_id, 0), p_entries_count, p_exits_count,
          p_entries_value, p_exits_value)
  ON CONFLICT (day, distributor_id) DO UPDATE SET
    entries_count = GREATEST(d.entries_count + EXCLUDED.entries_count, 0),
    exits_count   = GREATEST(d.exits_count   + EXCLUDED.exits_count,   0),
    entries_value = GREATEST(d.entries_value + EXCLUDED.entries_value, 0),
    exits_value   = GREATEST(d.exits_value   + EXCLUDED.exits_value,   0),
    updated_at    = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.register_movements_bulk(
  p_store    bigint,
  p_type     public.movement_type,
  p_motive_id bigint,
  p_lines    jsonb,
  p_discount numeric(5,2) DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_line      record;
  v_id        bigint;
  v_ids       bigint[] := '{}';
  v_count     integer := 0;
  v_fill      numeric(12,2);
  v_in_count  integer := 0;
  v_out_count integer := 0;
  v_in_val    numeric := 0;
  v_out_val   numeric := 0;
BEGIN
  IF p_store IS NULL THEN
    RAISE EXCEPTION 'register_movements_bulk: tienda requerida';
  END IF;
  IF p_type IS NULL THEN
    RAISE EXCEPTION 'register_movements_bulk: tipo requerido';
  END IF;
  IF p_motive_id IS NULL THEN
    RAISE EXCEPTION 'register_movements_bulk: motivo requerido';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.motives m WHERE m.id = p_motive_id AND m.is_active
  ) THEN
    RAISE EXCEPTION 'register_movements_bulk: motivo % inválido', p_motive_id;
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'register_movements_bulk: agregá al menos un producto';
  END IF;
  IF jsonb_array_length(p_lines) > 100 THEN
    RAISE EXCEPTION 'register_movements_bulk: máximo 100 líneas por ticket';
  END IF;
  IF p_discount IS NOT NULL THEN
    IF p_type <> 'exit' THEN
      RAISE EXCEPTION 'register_movements_bulk: el descuento solo aplica a salidas';
    END IF;
    IF p_discount < 0 OR p_discount > 100 THEN
      RAISE EXCEPTION 'register_movements_bulk: el descuento debe estar entre 0 y 100';
    END IF;
  END IF;

  -- 0048: deltas del dashboard suprimidos durante el loop; se upsertea una vez.
  PERFORM set_config('farox.batch_dashboard', 'on', true);

  -- 0048: ORDER BY fija el orden de lock (anti-deadlock) igual que
  -- confirm_delivery: dos tickets con productos solapados no se cruzan.
  FOR v_line IN
    SELECT * FROM jsonb_to_recordset(p_lines)
      AS x(product_id bigint, quantity numeric(12,3), unit_price numeric(12,2), expiry_date date)
    ORDER BY x.product_id
  LOOP
    v_fill := NULL;
    IF p_type = 'entry' THEN
      v_id := public.register_entry(
        p_product     => v_line.product_id,
        p_store       => p_store,
        p_qty         => v_line.quantity,
        p_motive_id   => p_motive_id,
        p_order_id    => NULL,
        p_expiry_date => v_line.expiry_date,
        p_unit_price  => v_line.unit_price,
        p_fill_price  => NULL
      );
    ELSE
      IF p_discount IS NOT NULL AND p_discount > 0 AND p_discount < 100 THEN
        v_fill := round(v_line.unit_price / (1 - p_discount / 100.0), 2);
      END IF;
      v_id := public.register_exit(
        p_product    => v_line.product_id,
        p_store      => p_store,
        p_qty        => v_line.quantity,
        p_motive_id  => p_motive_id,
        p_order_id   => NULL,
        p_unit_price => v_line.unit_price,
        p_fill_price => v_fill
      );
      IF p_discount IS NOT NULL THEN
        UPDATE public.movements SET discount_pct = p_discount WHERE id = v_id;
      END IF;
    END IF;
    v_ids   := v_ids || v_id;
    v_count := v_count + 1;
  END LOOP;

  PERFORM set_config('farox.batch_dashboard', 'off', true);

  -- Delta real: se lee de los movements recién insertados. Usar la línea del
  -- input subestimaría las entradas sin precio informado (register_entry
  -- resuelve el precio de la relación).
  SELECT count(*) FILTER (WHERE m.type = 'entry'),
         COALESCE(sum(m.quantity * COALESCE(m.unit_price, 0))
                  FILTER (WHERE m.type = 'entry'), 0),
         count(*) FILTER (WHERE m.type = 'exit'),
         COALESCE(sum(m.quantity * COALESCE(m.unit_price, 0))
                  FILTER (WHERE m.type = 'exit'), 0)
    INTO v_in_count, v_in_val, v_out_count, v_out_val
    FROM public.movements m
   WHERE m.id = ANY (v_ids);

  IF v_count > 0 THEN
    -- p_order_id siempre NULL acá ⇒ el agregado es del distribuidor 0, igual
    -- que el COALESCE(v_dist, 0) que hacía register_entry por línea.
    PERFORM public.internal_dashboard_upsert(0, v_in_count, v_out_count,
                                             v_in_val, v_out_val);
  END IF;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 9. VALIDATE best-effort del histórico de 0040/0041.
--    Rige para filas nuevas desde que se crearon; validar cierra el histórico.
--    Toma SHARE UPDATE EXCLUSIVE (no bloquea lecturas ni escrituras). Si una
--    tabla tiene data vieja fuera de rango, se deja WARNING y sigue NOT VALID.
-- ============================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conrelid::regclass AS tbl, conname
      FROM pg_constraint
     WHERE connamespace = 'public'::regnamespace
       AND contype = 'c'
       AND (conname LIKE '%\_maxlen' OR conname LIKE '%\_maxbytes')
       AND NOT convalidated
     ORDER BY conname
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', r.tbl, r.conname);
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING '0048: % sigue con datos fuera de rango; queda NOT VALID',
        r.conname;
    END;
  END LOOP;
END $$;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · normalize:  SELECT public.normalize_phone_e164('601 234 5678');  -- +576012345678
--                 SELECT public.normalize_phone_e164('300 222 3333');  -- +573002223333
--                 SELECT public.normalize_phone_e164('+60 12 345 678'); -- +6012345678
--   · privilegios: como anon,
--       SELECT public.internal_user_margin_pct('...');  -- ⇒ permission denied
--   · egreso:     como authenticated,
--       SELECT payload FROM public.chat_messages LIMIT 1;  -- ⇒ permission denied
--       SELECT id, role, content FROM public.chat_messages LIMIT 1;  -- ⇒ ok
--   · dashboard:  un ticket de 3 líneas deja UN evento realtime (suscripción a
--                 dashboard_daily) y entries_count = 3.
--   · retención:  SELECT * FROM cron.job WHERE jobname = 'farox_phone_verifications_purge';
--
-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   DROP TRIGGER IF EXISTS trg_users_normalize_phone ON public.users;
--   DROP FUNCTION IF EXISTS public.normalize_user_phone();
--   DROP FUNCTION IF EXISTS public.normalize_phone_e164(text);
--   SELECT cron.unschedule('farox_phone_verifications_purge');
--   GRANT SELECT ON public.chat_messages TO authenticated;
--   DROP INDEX IF EXISTS public.idx_chat_messages_user_hour;
--   Restaurar internal_dashboard_upsert (0004) y register_movements_bulk (0044),
--   y normalize_phone_e164 / clear_phone_verification_on_change desde 0042.
-- ============================================================================
