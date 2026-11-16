-- ============================================================================
-- FAROX — 20261113125000: pulido de PR review (0053).
--
--   1. send_message: serializa por usuario con pg_advisory_xact_lock(hashtext)
--      para que peticiones en paralelo a la Edge Function o al RPC no salteen
--      el límite por hora.
--   2. phone_verification_confirm_whatsapp: Meta entrega wa_id sin '+'; se
--      antepone '+' antes de normalize_phone_e164 para que números extranjeros
--      de 10 dígitos no se interpreten ni rechacen como locales de Colombia.
--   3. whatsapp_inbound: job diario en pg_cron para purgar filas viejas (>7d),
--      igual que phone_verifications en 0048.
--   4. 0008 y 0012 siguen intactas como foto del Sprint 1.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. send_message con lock transaccional por usuario.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation bigint, p_content text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_id    bigint;
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'send_message: requiere sesión';
  END IF;
  IF p_content IS NULL OR length(trim(p_content)) = 0 THEN
    RAISE EXCEPTION 'send_message: content requerido';
  END IF;
  IF char_length(p_content) > 800 THEN
    RAISE EXCEPTION 'send_message: content supera 800 caracteres';
  END IF;

  -- Serializa los envíos del mismo usuario dentro de la transacción para que
  -- ráfagas concurrentes no lean el mismo conteo antes de insertar.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user::text));

  IF NOT EXISTS (SELECT 1 FROM public.chat_conversations cc
                  WHERE cc.id = p_conversation AND cc.user_id = v_user) THEN
    RAISE EXCEPTION 'send_message: conversación inexistente o no es suya';
  END IF;

  SELECT count(*) INTO v_count
    FROM public.chat_messages cm
   WHERE cm.role = 'user'
     AND cm.created_at > now() - interval '1 hour'
     AND cm.conversation_id IN (
       SELECT cc.id FROM public.chat_conversations cc WHERE cc.user_id = v_user
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

-- ----------------------------------------------------------------------------
-- 2. phone_verification_confirm_whatsapp: prefijo '+' explícito para wa_id.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.phone_verification_confirm_whatsapp(
  p_wa_id text,
  p_code  text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_phone   text;
  v_code    text;
  v_hash    text;
  v_row     public.phone_verifications%ROWTYPE;
  v_attempt public.phone_verifications%ROWTYPE;
BEGIN
  v_phone := public.normalize_phone_e164('+' || ltrim(btrim(COALESCE(p_wa_id, '')), '+'));
  v_code  := upper(btrim(COALESCE(p_code, '')));

  IF v_code !~ '^[0-9A-F]{6}$' THEN
    RETURN 'invalid';
  END IF;

  v_hash := encode(extensions.digest(v_code, 'sha256'), 'hex');

  SELECT * INTO v_row
    FROM public.phone_verifications pv
   WHERE pv.phone_e164 = v_phone
     AND pv.code_hash = v_hash
     AND pv.consumed_at IS NULL
     AND pv.expires_at > now()
   ORDER BY pv.created_at DESC
   LIMIT 1;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_attempt
      FROM public.phone_verifications pv
     WHERE pv.phone_e164 = v_phone
       AND pv.consumed_at IS NULL
       AND pv.expires_at > now()
     ORDER BY pv.created_at DESC
     LIMIT 1;

    IF v_attempt.id IS NULL THEN
      RETURN 'expired';
    END IF;

    IF v_attempt.attempts >= 4 THEN
      UPDATE public.phone_verifications
         SET attempts = attempts + 1,
             consumed_at = now()
       WHERE id = v_attempt.id;
      RETURN 'too_many_attempts';
    END IF;

    UPDATE public.phone_verifications
       SET attempts = attempts + 1
     WHERE id = v_attempt.id;
    RETURN 'invalid';
  END IF;

  IF v_row.attempts >= 5 THEN
    UPDATE public.phone_verifications SET consumed_at = now() WHERE id = v_row.id;
    RETURN 'too_many_attempts';
  END IF;

  BEGIN
    UPDATE public.users
       SET phone_number = v_phone,
           phone_verified_at = now()
     WHERE id = v_row.user_id;
  EXCEPTION WHEN unique_violation THEN
    UPDATE public.phone_verifications SET consumed_at = now() WHERE id = v_row.id;
    RETURN 'phone_taken';
  END;

  UPDATE public.phone_verifications SET consumed_at = now() WHERE id = v_row.id;
  RETURN 'verified';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.phone_verification_confirm_whatsapp(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phone_verification_confirm_whatsapp(text, text)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Retención de whatsapp_inbound (deduplicación de Meta).
-- ----------------------------------------------------------------------------
DO $$
DECLARE j record;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job WHERE jobname = 'farox_whatsapp_inbound_purge'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

SELECT cron.schedule('farox_whatsapp_inbound_purge', '35 4 * * *',
  $$DELETE FROM public.whatsapp_inbound
     WHERE received_at < now() - interval '7 days'$$);
