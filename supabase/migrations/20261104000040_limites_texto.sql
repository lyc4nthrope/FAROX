-- ============================================================================
-- FAROX — 0040: límites de longitud en columnas de texto.
--
-- PROBLEMA
--   Salvo products.barcode (4-64) y movement_templates.name (1-80), ninguna
--   columna text del dominio tenía tope. Un usuario autenticado podía escribir
--   megabytes en users.full_name/phone_number (UPDATE directo) o llamar
--   send_message con un content arbitrario (el maxLength=800 del textarea es
--   solo UI). PostgreSQL guarda eso en TOAST: disco, WAL y backups crecen sin
--   control y VACUUM no recupera el espacio sin VACUUM FULL.
--
-- ESTRATEGIA
--   CHECK de longitud máxima en cada columna text. Se agregan NOT VALID:
--     · rigen de inmediato para INSERT/UPDATE nuevos;
--     · no escanean ni bloquean las filas existentes;
--     · no hacen fallar la migración si ya hay datos viejos que exceden.
--   Para activar la validación del histórico, correr el bloque VALIDATE del
--   final DESPUÉS de limpiar lo que reporte el diagnóstico.
--
--   Los límites NO son arbitrarios: se derivan del uso real del dominio
--   (E.164 ≤ 16, email GoTrue ≤ 255, título de chat generado a 60, etc.).
--
-- Regla del repo: append-only. Esta migración no edita archivos previos; solo
-- agrega constraints y reemplaza send_message con la MISMA firma (los GRANT
-- existentes se conservan con CREATE OR REPLACE).
-- ============================================================================

-- ============================================================================
-- 1. Diagnóstico previo (solo avisa; no bloquea).
--    Lista cada columna que hoy tiene filas por encima del límite.
-- ============================================================================
DO $$
DECLARE
  r   record;
  n   bigint;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('store_types',         'name',                80),
      ('unit_types',          'name',                80),
      ('unit_types',          'abbreviation',        10),
      ('unit_types',          'category',            40),
      ('roles',               'name',                80),
      ('roles',               'description',        255),
      ('brands',              'name',                80),
      ('product_categories',  'name',                80),
      ('product_categories',  'description',        255),
      ('motives',             'name',                80),
      ('users',               'full_name',          120),
      ('users',               'email',              255),
      ('users',               'phone_number',        32),
      ('products',            'name',               160),
      ('products',            'description',       2000),
      ('stores',              'name',               160),
      ('stores',              'address',            255),
      ('stores',              'city',                80),
      ('stores',              'phone',               32),
      ('stores',              'website_url',        500),
      ('orders',              'notes',             2000),
      ('orders',              'cancelled_reason',   500),
      ('distributors',        'name',               160),
      ('distributors',        'nit',                 32),
      ('distributors',        'contact_name',       120),
      ('distributors',        'phone',               32),
      ('distributors',        'email',              255),
      ('credits',             'cancelled_reason',   500),
      ('alerts',              'message',           1000),
      ('chat_conversations',  'title',              120),
      ('chat_messages',       'content',          16000),
      ('audit_log',           'table_name',          64),
      ('audit_log',           'row_id',              64),
      ('plans',               'code',                32),
      ('plans',               'name',                80),
      ('subscriptions',       'provider',            32),
      ('subscriptions',       'provider_subscription_id', 128),
      ('payments',            'provider',            32),
      ('payments',            'provider_payment_id', 128),
      ('payments',            'provider_reference',  128),
      ('payment_events',      'provider',            32),
      ('payment_events',      'event_id',           128),
      ('payment_events',      'topic',               64),
      ('premium_notices',     'period_key',          32),
      ('premium_notices',     'error',              500)
    ) AS v(tbl, col, lim)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE char_length(%I::text) > $1',
      r.tbl, r.col
    ) INTO n USING r.lim;
    IF n > 0 THEN
      RAISE WARNING '0040: %.% tiene % fila(s) con más de % caracteres',
        r.tbl, r.col, n, r.lim;
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- 2. Constraints. DROP IF EXISTS + ADD NOT VALID = idempotente.
--    Nombre: <tabla>_<columna>_maxlen (el bloque VALIDATE filtra por _maxlen).
-- ============================================================================

-- Catálogos ---------------------------------------------------------------
ALTER TABLE public.store_types
  DROP CONSTRAINT IF EXISTS store_types_name_maxlen,
  ADD CONSTRAINT store_types_name_maxlen
    CHECK (char_length(name) <= 80) NOT VALID;

ALTER TABLE public.unit_types
  DROP CONSTRAINT IF EXISTS unit_types_name_maxlen,
  ADD CONSTRAINT unit_types_name_maxlen
    CHECK (char_length(name) <= 80) NOT VALID,
  DROP CONSTRAINT IF EXISTS unit_types_abbreviation_maxlen,
  ADD CONSTRAINT unit_types_abbreviation_maxlen
    CHECK (char_length(abbreviation) <= 10) NOT VALID,
  DROP CONSTRAINT IF EXISTS unit_types_category_maxlen,
  ADD CONSTRAINT unit_types_category_maxlen
    CHECK (char_length(category) <= 40) NOT VALID;

ALTER TABLE public.roles
  DROP CONSTRAINT IF EXISTS roles_name_maxlen,
  ADD CONSTRAINT roles_name_maxlen
    CHECK (char_length(name) <= 80) NOT VALID,
  DROP CONSTRAINT IF EXISTS roles_description_maxlen,
  ADD CONSTRAINT roles_description_maxlen
    CHECK (description IS NULL OR char_length(description) <= 255) NOT VALID;

ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_name_maxlen,
  ADD CONSTRAINT brands_name_maxlen
    CHECK (char_length(name) <= 80) NOT VALID;

ALTER TABLE public.product_categories
  DROP CONSTRAINT IF EXISTS product_categories_name_maxlen,
  ADD CONSTRAINT product_categories_name_maxlen
    CHECK (char_length(name) <= 80) NOT VALID,
  DROP CONSTRAINT IF EXISTS product_categories_description_maxlen,
  ADD CONSTRAINT product_categories_description_maxlen
    CHECK (description IS NULL OR char_length(description) <= 255) NOT VALID;

ALTER TABLE public.motives
  DROP CONSTRAINT IF EXISTS motives_name_maxlen,
  ADD CONSTRAINT motives_name_maxlen
    CHECK (char_length(name) <= 80) NOT VALID;

-- Usuarios ----------------------------------------------------------------
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_full_name_maxlen,
  ADD CONSTRAINT users_full_name_maxlen
    CHECK (char_length(full_name) <= 120) NOT VALID,
  DROP CONSTRAINT IF EXISTS users_email_maxlen,
  ADD CONSTRAINT users_email_maxlen
    CHECK (email IS NULL OR char_length(email) <= 255) NOT VALID,
  DROP CONSTRAINT IF EXISTS users_phone_number_maxlen,
  ADD CONSTRAINT users_phone_number_maxlen
    CHECK (phone_number IS NULL OR char_length(phone_number) <= 32) NOT VALID;

-- Productos y tiendas ------------------------------------------------------
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_name_maxlen,
  ADD CONSTRAINT products_name_maxlen
    CHECK (char_length(name) <= 160) NOT VALID,
  DROP CONSTRAINT IF EXISTS products_description_maxlen,
  ADD CONSTRAINT products_description_maxlen
    CHECK (description IS NULL OR char_length(description) <= 2000) NOT VALID;

ALTER TABLE public.stores
  DROP CONSTRAINT IF EXISTS stores_name_maxlen,
  ADD CONSTRAINT stores_name_maxlen
    CHECK (char_length(name) <= 160) NOT VALID,
  DROP CONSTRAINT IF EXISTS stores_address_maxlen,
  ADD CONSTRAINT stores_address_maxlen
    CHECK (address IS NULL OR char_length(address) <= 255) NOT VALID,
  DROP CONSTRAINT IF EXISTS stores_city_maxlen,
  ADD CONSTRAINT stores_city_maxlen
    CHECK (city IS NULL OR char_length(city) <= 80) NOT VALID,
  DROP CONSTRAINT IF EXISTS stores_phone_maxlen,
  ADD CONSTRAINT stores_phone_maxlen
    CHECK (phone IS NULL OR char_length(phone) <= 32) NOT VALID,
  DROP CONSTRAINT IF EXISTS stores_website_url_maxlen,
  ADD CONSTRAINT stores_website_url_maxlen
    CHECK (website_url IS NULL OR char_length(website_url) <= 500) NOT VALID;

-- Pedidos, distribuidores, créditos ---------------------------------------
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_notes_maxlen,
  ADD CONSTRAINT orders_notes_maxlen
    CHECK (notes IS NULL OR char_length(notes) <= 2000) NOT VALID,
  DROP CONSTRAINT IF EXISTS orders_cancelled_reason_maxlen,
  ADD CONSTRAINT orders_cancelled_reason_maxlen
    CHECK (cancelled_reason IS NULL OR char_length(cancelled_reason) <= 500) NOT VALID;

ALTER TABLE public.distributors
  DROP CONSTRAINT IF EXISTS distributors_name_maxlen,
  ADD CONSTRAINT distributors_name_maxlen
    CHECK (char_length(name) <= 160) NOT VALID,
  DROP CONSTRAINT IF EXISTS distributors_nit_maxlen,
  ADD CONSTRAINT distributors_nit_maxlen
    CHECK (char_length(nit) <= 32) NOT VALID,
  DROP CONSTRAINT IF EXISTS distributors_contact_name_maxlen,
  ADD CONSTRAINT distributors_contact_name_maxlen
    CHECK (contact_name IS NULL OR char_length(contact_name) <= 120) NOT VALID,
  DROP CONSTRAINT IF EXISTS distributors_phone_maxlen,
  ADD CONSTRAINT distributors_phone_maxlen
    CHECK (phone IS NULL OR char_length(phone) <= 32) NOT VALID,
  DROP CONSTRAINT IF EXISTS distributors_email_maxlen,
  ADD CONSTRAINT distributors_email_maxlen
    CHECK (email IS NULL OR char_length(email) <= 255) NOT VALID;

ALTER TABLE public.credits
  DROP CONSTRAINT IF EXISTS credits_cancelled_reason_maxlen,
  ADD CONSTRAINT credits_cancelled_reason_maxlen
    CHECK (cancelled_reason IS NULL OR char_length(cancelled_reason) <= 500) NOT VALID;

-- Alertas y chat -----------------------------------------------------------
ALTER TABLE public.alerts
  DROP CONSTRAINT IF EXISTS alerts_message_maxlen,
  ADD CONSTRAINT alerts_message_maxlen
    CHECK (char_length(message) <= 1000) NOT VALID;

ALTER TABLE public.chat_conversations
  DROP CONSTRAINT IF EXISTS chat_conversations_title_maxlen,
  ADD CONSTRAINT chat_conversations_title_maxlen
    CHECK (title IS NULL OR char_length(title) <= 120) NOT VALID;

ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_content_maxlen,
  ADD CONSTRAINT chat_messages_content_maxlen
    CHECK (char_length(content) <= 16000) NOT VALID;

-- Auditoría ----------------------------------------------------------------
ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_table_name_maxlen,
  ADD CONSTRAINT audit_log_table_name_maxlen
    CHECK (char_length(table_name) <= 64) NOT VALID,
  DROP CONSTRAINT IF EXISTS audit_log_row_id_maxlen,
  ADD CONSTRAINT audit_log_row_id_maxlen
    CHECK (row_id IS NULL OR char_length(row_id) <= 64) NOT VALID;

-- Premium y pagos ----------------------------------------------------------
ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_code_maxlen,
  ADD CONSTRAINT plans_code_maxlen
    CHECK (char_length(code) <= 32) NOT VALID,
  DROP CONSTRAINT IF EXISTS plans_name_maxlen,
  ADD CONSTRAINT plans_name_maxlen
    CHECK (char_length(name) <= 80) NOT VALID;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_provider_maxlen,
  ADD CONSTRAINT subscriptions_provider_maxlen
    CHECK (char_length(provider) <= 32) NOT VALID,
  DROP CONSTRAINT IF EXISTS subscriptions_provider_subscription_id_maxlen,
  ADD CONSTRAINT subscriptions_provider_subscription_id_maxlen
    CHECK (provider_subscription_id IS NULL
           OR char_length(provider_subscription_id) <= 128) NOT VALID;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_provider_maxlen,
  ADD CONSTRAINT payments_provider_maxlen
    CHECK (char_length(provider) <= 32) NOT VALID,
  DROP CONSTRAINT IF EXISTS payments_provider_payment_id_maxlen,
  ADD CONSTRAINT payments_provider_payment_id_maxlen
    CHECK (provider_payment_id IS NULL
           OR char_length(provider_payment_id) <= 128) NOT VALID,
  DROP CONSTRAINT IF EXISTS payments_provider_reference_maxlen,
  ADD CONSTRAINT payments_provider_reference_maxlen
    CHECK (provider_reference IS NULL
           OR char_length(provider_reference) <= 128) NOT VALID;

ALTER TABLE public.payment_events
  DROP CONSTRAINT IF EXISTS payment_events_provider_maxlen,
  ADD CONSTRAINT payment_events_provider_maxlen
    CHECK (char_length(provider) <= 32) NOT VALID,
  DROP CONSTRAINT IF EXISTS payment_events_event_id_maxlen,
  ADD CONSTRAINT payment_events_event_id_maxlen
    CHECK (char_length(event_id) <= 128) NOT VALID,
  DROP CONSTRAINT IF EXISTS payment_events_topic_maxlen,
  ADD CONSTRAINT payment_events_topic_maxlen
    CHECK (topic IS NULL OR char_length(topic) <= 64) NOT VALID;

ALTER TABLE public.premium_notices
  DROP CONSTRAINT IF EXISTS premium_notices_period_key_maxlen,
  ADD CONSTRAINT premium_notices_period_key_maxlen
    CHECK (char_length(period_key) <= 32) NOT VALID,
  DROP CONSTRAINT IF EXISTS premium_notices_error_maxlen,
  ADD CONSTRAINT premium_notices_error_maxlen
    CHECK (error IS NULL OR char_length(error) <= 500) NOT VALID;

-- ============================================================================
-- 3. send_message: alinear el servidor con el límite real de la UI.
--    Misma firma ⇒ los GRANT de 0011 se conservan. Solo rol 'user' pasa por
--    acá; assistant/tool los inserta service_role y quedan con el CHECK 16000.
-- ============================================================================
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
  IF char_length(p_content) > 800 THEN
    RAISE EXCEPTION 'send_message: content supera 800 caracteres';
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

-- ============================================================================
-- 4. VALIDATE del histórico — DESCOMENTAR cuando el diagnóstico (paso 1) no
--    reporte warnings. Toma SHARE UPDATE EXCLUSIVE: no bloquea lecturas ni
--    escrituras. Si queda data vieja fuera de rango, este bloque aborta y
--    lista el primer constraint que falla.
-- ============================================================================
-- DO $$
-- DECLARE r record;
-- BEGIN
--   FOR r IN
--     SELECT conrelid::regclass AS tbl, conname
--       FROM pg_constraint
--      WHERE connamespace = 'public'::regnamespace
--        AND contype = 'c'
--        AND conname LIKE '%_maxlen'
--        AND NOT convalidated
--   LOOP
--     EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', r.tbl, r.conname);
--   END LOOP;
-- END $$;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · 45 constraints *_maxlen, todos NOT VALID (o validados tras el paso 4):
--       SELECT conname, convalidated
--         FROM pg_constraint
--        WHERE connamespace = 'public'::regnamespace
--          AND conname LIKE '%_maxlen'
--        ORDER BY conname;                          -- esperado: 45 filas
--   · El tope muerde:
--       UPDATE public.users SET full_name = repeat('x', 121) WHERE id = auth.uid();
--       -- ⇒ new row for relation "users" violates check constraint
--   · send_message:
--       SELECT public.send_message(<conv>, repeat('x', 801));
--       -- ⇒ send_message: content supera 800 caracteres
--   · Un tamaño normal sigue pasando:
--       UPDATE public.users SET full_name = 'Ada Lovelace' WHERE id = auth.uid();
--
-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_full_name_maxlen, ...
--   -- repetir por cada constraint *_maxlen y restaurar send_message de 0004.
-- ============================================================================
