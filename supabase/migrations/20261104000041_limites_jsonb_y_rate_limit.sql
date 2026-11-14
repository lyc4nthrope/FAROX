-- ============================================================================
-- FAROX — 0041: topes para columnas jsonb + rate limit de chat en la BD.
--
-- CONTEXTO (continúa 0040)
--   0040 acotó las columnas text. Quedaban dos vectores:
--     a) columnas jsonb sin tope: un payload grande (webhook de Mercado Pago,
--        tool-call del asistente) entra completo a TOAST.
--     b) el límite de 60 consultas/hora vive SOLO en la Edge Function. Llamar
--        send_message o create_chat directo desde el navegador lo saltea: con
--        filas chicas igual se pueden crear millones.
--
-- CRITERIO DE MEDIDA
--   Para jsonb se usa octet_length(col::text), NO pg_column_size: sobre un
--   valor TOASTeado, pg_column_size devuelve el tamaño del puntero/comprimido
--   en disco, no el tamaño lógico. La serialización a text fuerza el detoast y
--   mide lo que realmente se escribió.
--
-- MISMAS REGLAS QUE 0040
--   · CHECK NOT VALID: rige para escrituras nuevas sin escanear el histórico.
--   · DROP IF EXISTS + ADD = idempotente.
--   · send_message se reemplaza con la MISMA firma (GRANT de 0011 intacto).
-- ============================================================================

-- ============================================================================
-- 1. Diagnóstico previo (solo avisa; no bloquea).
-- ============================================================================
DO $$
DECLARE
  r   record;
  n   bigint;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('chat_messages',  'payload',   16384),
      ('alerts',         'context',    2048),
      ('plans',          'features',   8192),
      ('payments',       'raw_event', 65536),
      ('payment_events', 'payload',   65536)
    ) AS v(tbl, col, lim)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE %I IS NOT NULL AND octet_length(%I::text) > $1',
      r.tbl, r.col, r.col
    ) INTO n USING r.lim;
    IF n > 0 THEN
      RAISE WARNING '0041: %.% tiene % fila(s) con más de % bytes',
        r.tbl, r.col, n, r.lim;
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- 2. Topes de tamaño en jsonb.
-- ============================================================================
ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_payload_maxbytes,
  ADD CONSTRAINT chat_messages_payload_maxbytes
    CHECK (payload IS NULL OR octet_length(payload::text) <= 16384) NOT VALID;

ALTER TABLE public.alerts
  DROP CONSTRAINT IF EXISTS alerts_context_maxbytes,
  ADD CONSTRAINT alerts_context_maxbytes
    CHECK (context IS NULL OR octet_length(context::text) <= 2048) NOT VALID;

ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_features_maxbytes,
  ADD CONSTRAINT plans_features_maxbytes
    CHECK (features IS NULL OR octet_length(features::text) <= 8192) NOT VALID;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_raw_event_maxbytes,
  ADD CONSTRAINT payments_raw_event_maxbytes
    CHECK (raw_event IS NULL OR octet_length(raw_event::text) <= 65536) NOT VALID;

ALTER TABLE public.payment_events
  DROP CONSTRAINT IF EXISTS payment_events_payload_maxbytes,
  ADD CONSTRAINT payment_events_payload_maxbytes
    CHECK (octet_length(payload::text) <= 65536) NOT VALID;

-- ============================================================================
-- 3. Índices para los conteos de rate limit.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_created
  ON public.chat_conversations (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_rate
  ON public.chat_messages (conversation_id, created_at)
  WHERE role = 'user';

-- ============================================================================
-- 4. Rate limit de conversaciones — trigger, no RPC.
--    Cubre create_chat(text) y create_chat(text, bigint) sin duplicar sus
--    cuerpos, y también cualquier INSERT futuro sobre la tabla.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_chat_conversation_rate()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.chat_conversations
   WHERE user_id = NEW.user_id
     AND created_at > now() - interval '1 hour';

  IF v_count >= 30 THEN
    RAISE EXCEPTION 'create_chat: límite de 30 conversaciones por hora';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_conversations_rate ON public.chat_conversations;
CREATE TRIGGER trg_chat_conversations_rate
BEFORE INSERT ON public.chat_conversations
FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_conversation_rate();

REVOKE EXECUTE ON FUNCTION public.enforce_chat_conversation_rate()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_chat_conversation_rate()
  TO service_role;

-- ============================================================================
-- 5. send_message — conserva los guards de 0040 y suma el rate limit.
--    Cuenta SOLO role='user': assistant/tool los inserta service_role y el
--    turno del asistente ya se limita en la Edge Function.
-- ============================================================================
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

  SELECT count(*) INTO v_count
    FROM public.chat_messages cm
    JOIN public.chat_conversations cc ON cc.id = cm.conversation_id
   WHERE cc.user_id = auth.uid()
     AND cm.role = 'user'
     AND cm.created_at > now() - interval '1 hour';

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
-- 6. VALIDATE del histórico — DESCOMENTAR cuando el diagnóstico (paso 1) no
--    reporte warnings. Incluye *_maxlen de 0040 y *_maxbytes de acá.
-- ============================================================================
-- DO $$
-- DECLARE r record;
-- BEGIN
--   FOR r IN
--     SELECT conrelid::regclass AS tbl, conname
--       FROM pg_constraint
--      WHERE connamespace = 'public'::regnamespace
--        AND contype = 'c'
--        AND (conname LIKE '%_maxlen' OR conname LIKE '%_maxbytes')
--        AND NOT convalidated
--   LOOP
--     EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', r.tbl, r.conname);
--   END LOOP;
-- END $$;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · 5 constraints *_maxbytes:
--       SELECT conname, convalidated FROM pg_constraint
--        WHERE connamespace = 'public'::regnamespace
--          AND conname LIKE '%_maxbytes';           -- esperado: 5 filas
--   · jsonb que muerde:
--       INSERT INTO public.payment_events (provider, event_id, payload)
--       VALUES ('test', 'test', jsonb_build_object('big', repeat('x', 70000)));
--       -- ⇒ violates check constraint "payment_events_payload_maxbytes"
--   · rate de conversaciones (usuario real):
--       SELECT public.create_chat('prueba') FROM generate_series(1, 31);
--       -- ⇒ a la 31: create_chat: límite de 30 conversaciones por hora
--   · rate de mensajes:
--       SELECT public.send_message(<conv>, 'hola') FROM generate_series(1, 121);
--       -- ⇒ al 121: send_message: límite de 120 mensajes por hora
--   · El flujo normal (1 turno = 1 user + 1 assistant) sigue pasando.
--
-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   DROP TRIGGER IF EXISTS trg_chat_conversations_rate ON public.chat_conversations;
--   DROP FUNCTION IF EXISTS public.enforce_chat_conversation_rate();
--   ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_payload_maxbytes;
--   -- ... cada *_maxbytes; restaurar send_message de 0040.
-- ============================================================================
