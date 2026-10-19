-- Entity: chat_messages | Source: 0001_extensions_enums.sql:L82-88 (enum chat_role), 0003_tables_farox.sql:L221-234 (tabla+índice), 0004_functions_triggers.sql:L251 (sin touch: append-only), L488-491 (trg_chat_message_touch), L498 (sin audit en chat_*), L1431-1450 (send_message), 0006_rls_grants.sql:L49 (RLS), L321-325 (policy), L356 (REVOKE DML), L380 (GRANT SELECT), 0011_seguridad.sql:L511 (whitelist send_message) | Order: after chat_conversations, users

-- ============================================================================
-- chat_messages — mensajes del chatbot (role: user/assistant/tool). Escritura
-- SOLO vía send_message(); SIN updated_at (append-only, keyset por id).
-- payload jsonb = tool-calling FUERA de listados (egress).
-- ============================================================================

-- CREATE TABLE — 0003_tables_farox.sql:222-229 (VERBATIM)
CREATE TABLE public.chat_messages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  role            public.chat_role NOT NULL,   -- tool guarda respuestas de funciones
  content         text NOT NULL,
  payload         jsonb NULL,   -- tool-calling del chatbot; FUERA de listados (egress)
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Índice — 0003_tables_farox.sql:231-234 (VERBATIM)
-- Keyset corregido (A8): por created_at dos mensajes de la misma transacción
-- comparten timestamp y el cursor los saltaba/duplicaba; id es único y monotónico.
-- Cursor: WHERE conversation_id = $1 AND id > $after ORDER BY id LIMIT 21.
CREATE INDEX idx_chat_messages_conversation_id ON public.chat_messages (conversation_id, id);

-- Triggers — 0004_functions_triggers.sql:488-491 (VERBATIM): AFTER INSERT ⇒
-- toca updated_at de la conversación (fn touch_conversation_updated_at en
-- 22_chat_conversations.sql:66-75). Sin touch_updated_at propio: append-only
-- SIN updated_at (0004:251). Sin trg_audit_* (0004:498: NO chat_*).
DROP TRIGGER IF EXISTS trg_chat_message_touch ON public.chat_messages;
CREATE TRIGGER trg_chat_message_touch
AFTER INSERT ON public.chat_messages FOR EACH ROW
EXECUTE FUNCTION public.touch_conversation_updated_at();

-- ============================================================================
-- RLS — 0006_rls_grants.sql:49 + 317-325 (VERBATIM): lectura por DUEÑO vía la
-- conversación (§8, contradicción (1) del encabezado de 0006:12-15 — chat
-- legible en vez del REVOKE de §4). Escritura: send_message() valida dueño.
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_messages_select ON public.chat_messages
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chat_conversations c
                 WHERE c.id = chat_messages.conversation_id
                   AND c.user_id = auth.uid()));

-- GRANTs — 0006_rls_grants.sql:351-357 (REVOKE DML, VERBATIM parcial) + :380 (GRANT SELECT)
-- REVOKE global de las 15 tablas RPC-only: CONSOLIDADO en 90_security.sql
-- (0006:351-357, VERBATIM). Acá NO se repite: en orden de entidad el bloque
-- referenciaría tablas que aun no existen (forward refs).
-- (1) chat legible por dueño — §8 manda sobre el revoke incompleto de §4.
GRANT SELECT ON public.chat_conversations, public.chat_messages TO authenticated;
-- GRANT EXECUTE send_message(bigint, text) TO authenticated, service_role — 0011:511.
-- 0007_realtime_jobs.sql:10 (contexto): chat_* JAMÁS en la publicación realtime.

-- ============================================================================
-- RPCs SOBRE ESTA TABLA (estado FINAL = última migración)
-- send_message — 0004_functions_triggers.sql:1431-1450 (VERBATIM; 0011 NO la
-- reescribe, solo la GRANTEA en 0011:511). Valida dueño en servidor. Toca
-- chat_messages (INSERT) + chat_conversations (la valida; el UPDATE de
-- updated_at lo hace trg_chat_message_touch).
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
-- GRANT EXECUTE send_message(bigint, text) TO authenticated, service_role — 0011:511.
