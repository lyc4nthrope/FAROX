-- Entity: chat_conversations | Source: 0003_tables_farox.sql:L209-219 (tabla+índice), 0004_functions_triggers.sql:L382-392 (touch_conversation_updated_at), L483-486 (trg_updated_at), L498 (sin audit en chat_*), L1418-1429 (create_chat), 0006_rls_grants.sql:L48 (RLS), L312-320 (policy), L356 (REVOKE DML), L380 (GRANT SELECT), 0011_seguridad.sql:L510 (whitelist create_chat) | Order: after users

-- ============================================================================
-- chat_conversations — conversaciones del chatbot (dueño = user_id). Escritura
-- SOLO vía create_chat(); trigger toca updated_al insertar mensaje (§3.11).
-- Sin trigger de auditoría: auditar mensajes de chat es ruido + peso (A1).
-- ============================================================================

-- CREATE TABLE — 0003_tables_farox.sql:210-217 (VERBATIM)
CREATE TABLE public.chat_conversations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,  -- dueño
  title       text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()  -- lo toca un trigger al insertar mensaje (ordenar listados)
  -- Sin trigger de auditoría: auditar mensajes de chat es ruido + peso (A1)
);

-- Índice — 0003_tables_farox.sql:219 (VERBATIM)
CREATE INDEX idx_chat_conversations_user_updated ON public.chat_conversations (user_id, updated_at DESC);

-- Triggers — 0004_functions_triggers.sql:483-486 (VERBATIM): solo updated_at.
-- NO hay trg_audit_* sobre chat_* (0004:498: "SOLO las 8 tablas del alcance D21
-- (NO movements, NO chat_*)"). El UPDATE de updated_at al insertar mensaje lo
-- hace el trigger trg_chat_message_touch de 23_chat_messages.sql vía la
-- función touch_conversation_updated_at (cuerpo abajo).
DROP TRIGGER IF EXISTS trg_chat_conversations_updated_at ON public.chat_conversations;
CREATE TRIGGER trg_chat_conversations_updated_at
BEFORE UPDATE ON public.chat_conversations FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- touch_conversation_updated_at — 0004_functions_triggers.sql:382-392 (VERBATIM).
-- Su target lógico es ESTA tabla (UPDATE de updated_at); el trigger que la
-- dispara (trg_chat_message_touch) vive en 23_chat_messages.sql.
-- §3.11: updated_at lo toca un trigger al insertar mensaje (ordenar listados).
-- Sin trigger de auditoría en chat_* (A1).
CREATE OR REPLACE FUNCTION public.touch_conversation_updated_at() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public $$
BEGIN
  UPDATE public.chat_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- RLS — 0006_rls_grants.sql:48 + 312-320 (VERBATIM). Lectura por DUEÑO (§8) en
-- vez del REVOKE de §4: no existe get_chat()/get_messages() ⇒ sin SELECT la
-- feature chat queda muda (contradicción (1) del encabezado de 0006:12-15).
-- Escritura: create_chat()/send_message() validan dueño en servidor.
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_conversations_select ON public.chat_conversations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- GRANTs — 0006_rls_grants.sql:351-357 (REVOKE DML, VERBATIM parcial) + :380 (GRANT SELECT)
REVOKE INSERT, UPDATE, DELETE ON
  public.stock, public.movements, public.order_items, public.orders,
  public.credits, public.credit_payments, public.price_publications,
  public.alerts, public.routes, public.route_stops, public.user_stores,
  public.dashboard_daily, public.audit_log,
  public.chat_conversations, public.chat_messages
FROM authenticated;
-- (1) chat legible por dueño — §8 manda sobre el revoke incompleto de §4.
GRANT SELECT ON public.chat_conversations, public.chat_messages TO authenticated;
-- GRANT EXECUTE create_chat(text) TO authenticated, service_role — 0011:510.
-- 0011:545-546 (contexto): REVOKE ALL ON ALL TABLES/SEQUENCES IN SCHEMA public FROM anon.

-- ============================================================================
-- RPCs SOBRE ESTA TABLA (estado FINAL = última migración)
-- create_chat — 0004_functions_triggers.sql:1418-1429 (VERBATIM; 0011 NO la
-- reescribe, solo la GRANTEA en 0011:510). Excepción del gate has_scope (D37):
-- el canal de onboarding no se bloquea. Toca SOLO chat_conversations.
CREATE OR REPLACE FUNCTION public.create_chat(p_title text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public $$
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
-- GRANT EXECUTE create_chat(text) TO authenticated, service_role — 0011:510.
-- send_message (INSERT en chat_messages + valida dueño acá) ⇒ va en 23_chat_messages.sql.
