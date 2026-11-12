-- ============================================================================
-- FAROX — 0042: teléfono verificado (identidad para el asistente).
--
-- PROBLEMA
--   users.phone_number es text nullable, sin UNIQUE y editable por el dueño
--   (GRANT UPDATE de 0006:369). Usarlo como identificador para el bot permite
--   que cualquiera escriba el número de otra persona y lea sus datos. Hace
--   falta una prueba de control del número.
--
-- FLUJO ELEGIDO (opción 2 del feature doc)
--   1. El usuario autenticado llama phone_verification_start('300 222 3333').
--   2. La RPC normaliza a E.164, genera un código de 6 hex y lo DEVUELVE a la
--      app (el usuario lo ve en pantalla; no se envía por ningún canal).
--   3. El usuario manda "FAROX <código>" desde su WhatsApp al bot.
--   4. El webhook (service_role) llama phone_verification_confirm_whatsapp(
--      wa_id, código). El wa_id es el número que Meta ya verificó: si el
--      código corresponde a ese número, el control queda probado.
--
--   Devolver el código al cliente es seguro: quien lo recibe es el dueño de la
--   sesión, y para confirmar hace falta enviarlo desde el WhatsApp del número
--   declarado. Un atacante puede generar códigos para el número de la víctima,
--   pero no puede enviarlos desde ese teléfono.
--
-- SEGURIDAD
--   · phone_verified_at queda FUERA del GRANT UPDATE de perfil: solo lo escribe
--     la RPC SECURITY DEFINER.
--   · Un trigger limpia phone_verified_at si el dueño cambia phone_number por
--     UPDATE directo (si no, podría verificar un número y luego cambiarlo).
--   · Un teléfono verificado pertenece a una sola cuenta (índice único parcial).
--   · La tabla es interna: RLS sin policies y sin DML para authenticated/anon.
-- ============================================================================

-- ============================================================================
-- 1. Columna de verificación + unicidad del número verificado.
-- ============================================================================
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone_verified
  ON public.users (phone_number)
  WHERE phone_verified_at IS NOT NULL;

-- ============================================================================
-- 2. Tabla de códigos pendientes (interna).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.phone_verifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phone_e164  text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  code_hash   text NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_user_created
  ON public.phone_verifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_phone_active
  ON public.phone_verifications (phone_e164)
  WHERE consumed_at IS NULL;

ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_verifications FROM authenticated, anon;

COMMENT ON TABLE public.phone_verifications IS
  'Códigos OTP de verificación de teléfono. Solo accesible vía RPCs SECURITY DEFINER.';

-- ============================================================================
-- 3. Normalizador E.164.
--    Sin `+` se asume Colombia para móviles de 10 dígitos que empiezan en 3
--    (stores.country DEFAULT 'CO'). Para otros países, el cliente debe enviar
--    el prefijo internacional o 00.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.normalize_phone_e164(p_phone text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
BEGIN
  IF v_digits = '' THEN
    RAISE EXCEPTION 'phone: número requerido';
  END IF;

  IF v_digits LIKE '00%' THEN
    v_digits := substr(v_digits, 3);
  ELSIF length(v_digits) = 10 AND left(v_digits, 1) = '3' THEN
    v_digits := '57' || v_digits;
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
-- 4. Inicio: genera el código y lo devuelve al dueño de la sesión.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.phone_verification_start(p_phone text)
RETURNS TABLE (code text, phone_e164 text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_phone   text;
  v_code    text;
  v_expires timestamptz;
  v_sent    integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'phone_verification: requiere sesión';
  END IF;

  v_phone := public.normalize_phone_e164(p_phone);

  -- Un número ya verificado por otra cuenta no se puede reclamar.
  IF EXISTS (
    SELECT 1
      FROM public.users u
     WHERE u.phone_number = v_phone
       AND u.phone_verified_at IS NOT NULL
       AND u.id <> v_user
  ) THEN
    RAISE EXCEPTION 'phone_verification: ese teléfono ya está verificado en otra cuenta';
  END IF;

  SELECT count(*) INTO v_sent
    FROM public.phone_verifications pv
   WHERE pv.user_id = v_user
     AND pv.created_at > now() - interval '1 hour';
  IF v_sent >= 3 THEN
    RAISE EXCEPTION 'phone_verification: límite de 3 códigos por hora';
  END IF;

  -- Un solo código activo por usuario.
  UPDATE public.phone_verifications
     SET consumed_at = now()
   WHERE user_id = v_user
     AND consumed_at IS NULL;

  v_code    := upper(encode(extensions.gen_random_bytes(3), 'hex'));
  v_expires := now() + interval '10 minutes';

  INSERT INTO public.phone_verifications (user_id, phone_e164, code_hash, expires_at)
  VALUES (
    v_user,
    v_phone,
    encode(extensions.digest(v_code, 'sha256'), 'hex'),
    v_expires
  );

  RETURN QUERY SELECT v_code, v_phone, v_expires;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.phone_verification_start(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phone_verification_start(text)
  TO authenticated, service_role;

-- ============================================================================
-- 5. Confirmación desde el webhook (service_role).
--    Se busca por (phone_e164, code_hash): así un código de otra cuenta para
--    el mismo número no puede "taparlo". El wa_id es el número verificado por
--    Meta; el usuario declarado es el dueño del código.
--
--    Devuelve: verified | invalid | expired | too_many_attempts | phone_taken
-- ============================================================================
CREATE OR REPLACE FUNCTION public.phone_verification_confirm_whatsapp(
  p_wa_id text,
  p_code  text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_phone text;
  v_code  text;
  v_hash    text;
  v_row     public.phone_verifications%ROWTYPE;
  v_attempt public.phone_verifications%ROWTYPE;
BEGIN
  v_phone := public.normalize_phone_e164(p_wa_id);
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
    -- Sin coincidencia: cuenta el intento en el código activo más reciente de
    -- ese número. Al quinto intento el código se consume.
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

-- ============================================================================
-- 6. Cambiar el número por UPDATE directo borra la verificación.
--    Sin esto, el dueño podría verificar un número y después reemplazarlo por
--    otro sin volver a probar control. La RPC de confirmación cambia AMBAS
--    columnas, así que el trigger la deja pasar.
-- ============================================================================
-- SECURITY INVOKER a propósito: el trigger solo reescribe NEW, no consulta
-- otras tablas ni necesita saltar RLS.
CREATE OR REPLACE FUNCTION public.clear_phone_verification_on_change()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.phone_number IS DISTINCT FROM OLD.phone_number
     AND NEW.phone_verified_at IS NOT DISTINCT FROM OLD.phone_verified_at THEN
    NEW.phone_verified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_clear_phone_verification ON public.users;
CREATE TRIGGER trg_users_clear_phone_verification
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.clear_phone_verification_on_change();

REVOKE EXECUTE ON FUNCTION public.clear_phone_verification_on_change()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_phone_verification_on_change()
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor, con una sesión real):
--   · normalize:  SELECT public.normalize_phone_e164('300 222 3333');
--                 -- ⇒ +573002223333
--                 SELECT public.normalize_phone_e164('+57 300 123 4567');
--                 -- ⇒ +573001234567
--   · start:      SELECT * FROM public.phone_verification_start('3002223333');
--                 -- ⇒ code (6 hex), phone_e164, expires_at
--   · confirm (desde el SQL editor corre como owner; en producción solo el
--     webhook con service_role):
--                 SELECT public.phone_verification_confirm_whatsapp(
--                   '573002223333', '<code>');
--                 -- ⇒ verified
--   · cambio de número borra la verificación:
--                 UPDATE public.users SET phone_number = '3009999999'
--                  WHERE id = auth.uid();
--                 SELECT phone_verified_at FROM public.users WHERE id = auth.uid();
--                 -- ⇒ NULL
--   · intento inválido:
--                 SELECT public.phone_verification_confirm_whatsapp(
--                   '573002223333', 'AAAAAA');   -- ⇒ invalid
--
-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   DROP TRIGGER IF EXISTS trg_users_clear_phone_verification ON public.users;
--   DROP FUNCTION IF EXISTS public.clear_phone_verification_on_change();
--   DROP FUNCTION IF EXISTS public.phone_verification_confirm_whatsapp(text, text);
--   DROP FUNCTION IF EXISTS public.phone_verification_start(text);
--   DROP FUNCTION IF EXISTS public.normalize_phone_e164(text);
--   DROP TABLE IF EXISTS public.phone_verifications;
--   DROP INDEX IF EXISTS public.uq_users_phone_verified;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS phone_verified_at;
-- ============================================================================
