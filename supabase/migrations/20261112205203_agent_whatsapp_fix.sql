-- ============================================================================
-- FAROX — 20261112205203: fix de conversaciones WhatsApp por usuario.
--
-- El índice original (channel, external_id) asumía un wa_id = una persona.
-- Si un teléfono se libera y otra cuenta lo verifica, esa segunda cuenta
-- heredaba la conversación (y el historial) de la anterior. La conversación
-- debe ser única por (canal, wa_id, usuario), no solo por wa_id.
--
-- También se agrega el índice del rate limit por wa_id + received_at.
-- ============================================================================

DROP INDEX IF EXISTS public.uq_chat_conversations_whatsapp;

CREATE UNIQUE INDEX uq_chat_conversations_whatsapp
  ON public.chat_conversations (channel, external_id, user_id)
  WHERE channel = 'whatsapp' AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_wa_received
  ON public.whatsapp_inbound (wa_id, received_at);

-- Verificación manual:
--   · Dos usuarios distintos con el mismo external_id (wa_id) pueden tener una
--     conversación cada uno; el historial no se cruza.
--   · Un mismo usuario no puede tener dos conversaciones WhatsApp con el mismo
--     wa_id (el unique lo impide).
-- ----------------------------------------------------------------------------
