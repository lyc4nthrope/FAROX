-- ============================================================================
-- FAROX — 20261112160559: asistente con escritura (fase 2, slice 1).
--
-- El modelo NO escribe: prepara un borrador en agent_actions. La escritura
-- ocurre en agent_execute_action después de una confirmación humana.
--
-- Web:      agent_prepare_action / agent_execute_action / agent_cancel_action
-- WhatsApp: *_for_user, solo service_role, con confirmation_code.
--
-- Precios: solo web en esta versión. El wrapper de WhatsApp rechaza
-- kind = 'price_update' aunque se llame la RPC directamente.
--
-- Reglas del repo: SECURITY DEFINER + SET search_path; el alcance sale del
-- JWT, nunca de parámetros. Las variantes _for_user fijan las claims locales
-- con internal_set_actor y reutilizan las mismas RPCs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'agent_action_kind'
  ) THEN
    EXECUTE 'CREATE TYPE public.agent_action_kind AS ENUM (
      ''store_exit'',
      ''distributor_sale'',
      ''distributor_purchase'',
      ''price_update'',
      ''shortage_toggle''
    )';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'agent_action_status'
  ) THEN
    EXECUTE 'CREATE TYPE public.agent_action_status AS ENUM (
      ''pending'',
      ''executed'',
      ''cancelled'',
      ''failed'',
      ''expired''
    )';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. agent_actions — borradores y su resultado (append-only de negocio).
-- ----------------------------------------------------------------------------
CREATE TABLE public.agent_actions (
  id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id                     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id             bigint NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  kind                        public.agent_action_kind NOT NULL,
  status                      public.agent_action_status NOT NULL DEFAULT 'pending',
  channel                     text NOT NULL DEFAULT 'web'
                              CHECK (channel IN ('web', 'whatsapp')),
  wa_id                       text NULL,
  confirmation_code           text NULL,
  requires_strong_confirmation boolean NOT NULL DEFAULT false,
  payload                     jsonb NOT NULL,
  summary                     jsonb NOT NULL,
  result                      jsonb NULL,
  error                       text NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  expires_at                  timestamptz NOT NULL,
  executed_at                 timestamptz NULL,
  cancelled_at                timestamptz NULL
);

CREATE INDEX idx_agent_actions_user_status
  ON public.agent_actions (user_id, status, expires_at);
CREATE INDEX idx_agent_actions_conversation_status
  ON public.agent_actions (conversation_id, status);

ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_actions_read ON public.agent_actions;
CREATE POLICY agent_actions_read ON public.agent_actions
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- El cliente solo lee; toda escritura pasa por las RPCs SECURITY DEFINER.
REVOKE ALL ON TABLE public.agent_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.agent_actions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_actions TO service_role;

-- ----------------------------------------------------------------------------
-- 3. chat_conversations — canal y hebra externa (WhatsApp).
-- ----------------------------------------------------------------------------
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'web'
    CHECK (channel IN ('web', 'whatsapp')),
  ADD COLUMN IF NOT EXISTS external_id text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_conversations_whatsapp
  ON public.chat_conversations (channel, external_id)
  WHERE channel = 'whatsapp' AND external_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. whatsapp_inbound — deduplicación por message.id (Meta reintenta).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_inbound (
  message_id  text PRIMARY KEY,
  wa_id       text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_received_at
  ON public.whatsapp_inbound (received_at);

ALTER TABLE public.whatsapp_inbound ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_inbound FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.whatsapp_inbound TO service_role;

-- ----------------------------------------------------------------------------
-- 5. internal_set_actor — claims locales para reutilizar RPCs desde WhatsApp.
--
-- Solo service_role. El webhook resuelve el usuario por teléfono verificado y
-- pasa p_user; nunca acepta un user id desde el mensaje.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.internal_set_actor(p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'internal_set_actor: usuario requerido';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user AND u.is_active
  ) THEN
    RAISE EXCEPTION 'internal_set_actor: usuario inactivo o inexistente';
  END IF;
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text,
    true
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5b. internal_assert_wa_identity — defensa en profundidad: el wa_id debe ser
-- el teléfono verificado del usuario, aunque el webhook ya lo resolvió.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.internal_assert_wa_identity(
  p_user  uuid,
  p_wa_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_user IS NULL OR p_wa_id IS NULL OR p_wa_id = '' THEN
    RAISE EXCEPTION 'internal_assert_wa_identity: usuario y wa_id requeridos';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = p_user
      AND u.is_active
      AND u.phone_verified_at IS NOT NULL
      AND regexp_replace(COALESCE(u.phone_number, ''), '\D', '', 'g') = p_wa_id
  ) THEN
    RAISE EXCEPTION 'internal_assert_wa_identity: teléfono no verificado para el usuario';
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. agent_prepare_action — valida y crea el borrador. No escribe negocio.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_prepare_action(
  p_conversation bigint,
  p_kind         public.agent_action_kind,
  p_payload      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_user          uuid := auth.uid();
  v_role          text := COALESCE(public.my_role(), '');
  v_lines         jsonb;
  v_priced        jsonb;
  v_summary_lines jsonb;
  v_payload       jsonb;
  v_summary       jsonb;
  v_store         bigint;
  v_motive        bigint;
  v_product       bigint;
  v_discount      numeric := 0;
  v_subtotal      numeric := 0;
  v_total         numeric := 0;
  v_count         integer := 0;
  v_id            bigint;
  v_expires       timestamptz;
  v_strong        boolean := false;
  v_scope         text;
  v_shortage      boolean;
  v_old_shortage  boolean;
  v_dist          bigint;
  v_bad           bigint;
  v_line          record;
  v_old_purchase  numeric;
  v_old_sale      numeric;
  v_product_name  text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'agent_prepare_action: sesión requerida';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'agent_prepare_action: payload inválido';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_conversations c
    WHERE c.id = p_conversation AND c.user_id = v_user
  ) THEN
    RAISE EXCEPTION 'agent_prepare_action: conversación inexistente o sin permiso';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.agent_actions a
  WHERE a.user_id = v_user AND a.created_at > now() - INTERVAL '1 hour';
  IF v_count >= 20 THEN
    RAISE EXCEPTION 'agent_prepare_action: límite de acciones por hora';
  END IF;

  -- -------------------------------------------------------------------------
  -- store_exit: salida/venta de tienda (admin/operador, Premium).
  -- -------------------------------------------------------------------------
  IF p_kind = 'store_exit' THEN
    IF v_role NOT IN ('admin', 'operador') THEN
      RAISE EXCEPTION 'agent_prepare_action: solo admin/operador';
    END IF;
    IF NOT public.is_premium() THEN
      RAISE EXCEPTION 'agent_prepare_action: registrar movimientos requiere Premium';
    END IF;
    v_store := (p_payload->>'store_id')::bigint;
    IF v_store IS NULL THEN
      RAISE EXCEPTION 'agent_prepare_action: tienda requerida';
    END IF;
    IF v_role = 'operador' AND NOT (v_store = ANY (public.my_store_ids())) THEN
      RAISE EXCEPTION 'agent_prepare_action: tienda fuera del alcance';
    END IF;

    v_lines := p_payload->'lines';
    IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
      RAISE EXCEPTION 'agent_prepare_action: agregá al menos un producto';
    END IF;
    IF jsonb_array_length(v_lines) > 100 THEN
      RAISE EXCEPTION 'agent_prepare_action: máximo 100 líneas';
    END IF;
    IF (
      SELECT count(DISTINCT (e->>'product_id')::bigint)
      FROM jsonb_array_elements(v_lines) e
    ) <> jsonb_array_length(v_lines) THEN
      RAISE EXCEPTION 'agent_prepare_action: producto repetido en el ticket';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(v_lines) AS x(product_id bigint, quantity numeric)
      WHERE x.product_id IS NULL OR x.quantity IS NULL OR x.quantity <= 0
    ) THEN
      RAISE EXCEPTION 'agent_prepare_action: producto o cantidad inválida';
    END IF;

    SELECT x.product_id INTO v_bad
    FROM jsonb_to_recordset(v_lines) AS x(product_id bigint)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.stock s
      JOIN public.products p ON p.id = s.product_id AND p.is_active
      WHERE s.store_id = v_store AND s.product_id = x.product_id
    )
    LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'agent_prepare_action: el producto % no está en la tienda', v_bad;
    END IF;

    SELECT id INTO v_motive
    FROM public.motives
    WHERE name = 'venta' AND is_active
    LIMIT 1;
    IF v_motive IS NULL THEN
      RAISE EXCEPTION 'agent_prepare_action: motivo venta sin sembrado';
    END IF;

    v_discount := COALESCE((p_payload->>'discount')::numeric, 0);
    IF v_discount < 0 OR v_discount > 100 THEN
      RAISE EXCEPTION 'agent_prepare_action: descuento fuera de rango';
    END IF;

    SELECT jsonb_agg(
             jsonb_build_object(
               'product_id', x.product_id,
               'quantity', x.quantity,
               'unit_price', round(pp.price * (1 - v_discount / 100.0), 2)
             ) ORDER BY x.product_id
           )
    INTO v_priced
    FROM jsonb_to_recordset(v_lines) AS x(product_id bigint, quantity numeric)
    LEFT JOIN public.price_publications pp
      ON pp.product_id = x.product_id AND pp.store_id = v_store AND pp.is_active;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_priced) e
      WHERE e->>'unit_price' IS NULL
    ) THEN
      RAISE EXCEPTION 'agent_prepare_action: hay productos sin precio de venta';
    END IF;

    SELECT COALESCE(sum((e->>'quantity')::numeric * (e->>'unit_price')::numeric), 0)
    INTO v_subtotal
    FROM jsonb_array_elements(v_priced) e;
    v_total := v_subtotal;

    SELECT jsonb_agg(
             jsonb_build_object(
               'name', p.name,
               'qty', x.quantity,
               'unit_price', round(pp.price * (1 - v_discount / 100.0), 2)
             ) ORDER BY p.name
           )
    INTO v_summary_lines
    FROM jsonb_to_recordset(v_lines) AS x(product_id bigint, quantity numeric)
    JOIN public.products p ON p.id = x.product_id
    JOIN public.price_publications pp
      ON pp.product_id = x.product_id AND pp.store_id = v_store AND pp.is_active;

    v_payload := jsonb_build_object(
      'store_id', v_store,
      'motive_id', v_motive,
      'lines', v_priced,
      'discount', v_discount
    );
    v_summary := jsonb_build_object(
      'kind', p_kind,
      'store', (SELECT name FROM public.stores WHERE id = v_store),
      'lines', v_summary_lines,
      'discount', v_discount,
      'total', v_total
    );
    v_strong := false;

  -- -------------------------------------------------------------------------
  -- distributor_sale: venta del distribuidor a una tienda vinculada.
  -- -------------------------------------------------------------------------
  ELSIF p_kind = 'distributor_sale' THEN
    IF v_role <> 'distribuidor' THEN
      RAISE EXCEPTION 'agent_prepare_action: solo distribuidor';
    END IF;
    IF NOT public.is_premium() THEN
      RAISE EXCEPTION 'agent_prepare_action: la venta requiere Premium';
    END IF;
    v_dist := public.my_distributor_id();
    IF v_dist IS NULL THEN
      RAISE EXCEPTION 'agent_prepare_action: distribuidora no identificada';
    END IF;
    v_store := (p_payload->>'store_id')::bigint;
    IF v_store IS NULL THEN
      RAISE EXCEPTION 'agent_prepare_action: tienda requerida';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.store_distributors sd
      WHERE sd.store_id = v_store AND sd.distributor_id = v_dist
    ) THEN
      RAISE EXCEPTION 'agent_prepare_action: tienda no vinculada';
    END IF;

    v_lines := p_payload->'lines';
    IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
      RAISE EXCEPTION 'agent_prepare_action: agregá al menos un producto';
    END IF;
    IF jsonb_array_length(v_lines) > 100 THEN
      RAISE EXCEPTION 'agent_prepare_action: máximo 100 líneas';
    END IF;
    IF (
      SELECT count(DISTINCT (e->>'product_id')::bigint)
      FROM jsonb_array_elements(v_lines) e
    ) <> jsonb_array_length(v_lines) THEN
      RAISE EXCEPTION 'agent_prepare_action: producto repetido en el ticket';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(v_lines) AS x(product_id bigint, quantity numeric)
      WHERE x.product_id IS NULL OR x.quantity IS NULL OR x.quantity <= 0
    ) THEN
      RAISE EXCEPTION 'agent_prepare_action: producto o cantidad inválida';
    END IF;

    SELECT x.product_id INTO v_bad
    FROM jsonb_to_recordset(v_lines) AS x(product_id bigint)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.distributor_products dp
      JOIN public.products p ON p.id = dp.product_id AND p.is_active
      WHERE dp.distributor_id = v_dist
        AND dp.product_id = x.product_id
        AND dp.sale_price IS NOT NULL
    )
    LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'agent_prepare_action: producto % sin precio de venta', v_bad;
    END IF;

    v_discount := COALESCE((p_payload->>'discount')::numeric, 0);
    IF v_discount < 0 OR v_discount > 100 THEN
      RAISE EXCEPTION 'agent_prepare_action: descuento fuera de rango';
    END IF;

    SELECT jsonb_agg(
             jsonb_build_object(
               'product_id', x.product_id,
               'quantity', x.quantity,
               'unit_price', round(dp.sale_price * (1 - v_discount / 100.0), 2)
             ) ORDER BY x.product_id
           )
    INTO v_priced
    FROM jsonb_to_recordset(v_lines) AS x(product_id bigint, quantity numeric)
    JOIN public.distributor_products dp
      ON dp.distributor_id = v_dist AND dp.product_id = x.product_id;

    SELECT COALESCE(sum((e->>'quantity')::numeric * (e->>'unit_price')::numeric), 0)
    INTO v_subtotal
    FROM jsonb_array_elements(v_priced) e;
    v_total := v_subtotal;

    SELECT jsonb_agg(
             jsonb_build_object(
               'name', p.name,
               'qty', x.quantity,
               'unit_price', round(dp.sale_price * (1 - v_discount / 100.0), 2)
             ) ORDER BY p.name
           )
    INTO v_summary_lines
    FROM jsonb_to_recordset(v_lines) AS x(product_id bigint, quantity numeric)
    JOIN public.products p ON p.id = x.product_id
    JOIN public.distributor_products dp
      ON dp.distributor_id = v_dist AND dp.product_id = x.product_id;

    v_payload := jsonb_build_object(
      'store_id', v_store,
      'lines', v_priced,
      'discount', v_discount
    );
    v_summary := jsonb_build_object(
      'kind', p_kind,
      'store', (SELECT name FROM public.stores WHERE id = v_store),
      'lines', v_summary_lines,
      'discount', v_discount,
      'total', v_total
    );
    v_strong := false;

  -- -------------------------------------------------------------------------
  -- distributor_purchase: compra del distribuidor (suma stock propio).
  -- -------------------------------------------------------------------------
  ELSIF p_kind = 'distributor_purchase' THEN
    IF v_role <> 'distribuidor' THEN
      RAISE EXCEPTION 'agent_prepare_action: solo distribuidor';
    END IF;
    IF NOT public.is_premium() THEN
      RAISE EXCEPTION 'agent_prepare_action: la compra requiere Premium';
    END IF;
    v_dist := public.my_distributor_id();
    IF v_dist IS NULL THEN
      RAISE EXCEPTION 'agent_prepare_action: distribuidora no identificada';
    END IF;

    v_lines := p_payload->'lines';
    IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
      RAISE EXCEPTION 'agent_prepare_action: agregá al menos un producto';
    END IF;
    IF jsonb_array_length(v_lines) > 100 THEN
      RAISE EXCEPTION 'agent_prepare_action: máximo 100 líneas';
    END IF;
    IF (
      SELECT count(DISTINCT (e->>'product_id')::bigint)
      FROM jsonb_array_elements(v_lines) e
    ) <> jsonb_array_length(v_lines) THEN
      RAISE EXCEPTION 'agent_prepare_action: producto repetido en el ticket';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(v_lines) AS x(
        product_id bigint, quantity numeric, unit_price numeric, expiry_date date
      )
      WHERE x.product_id IS NULL
         OR x.quantity IS NULL OR x.quantity <= 0
         OR x.unit_price IS NULL OR x.unit_price <= 0
    ) THEN
      RAISE EXCEPTION 'agent_prepare_action: producto, cantidad o costo inválido';
    END IF;

    SELECT x.product_id INTO v_bad
    FROM jsonb_to_recordset(v_lines) AS x(product_id bigint)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.distributor_products dp
      JOIN public.products p ON p.id = dp.product_id AND p.is_active
      WHERE dp.distributor_id = v_dist AND dp.product_id = x.product_id
    )
    LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'agent_prepare_action: el producto % no está en tu catálogo', v_bad;
    END IF;

    SELECT jsonb_agg(
             jsonb_build_object(
               'product_id', x.product_id,
               'quantity', x.quantity,
               'unit_price', x.unit_price,
               'expiry_date', x.expiry_date
             ) ORDER BY x.product_id
           )
    INTO v_priced
    FROM jsonb_to_recordset(v_lines) AS x(
      product_id bigint, quantity numeric, unit_price numeric, expiry_date date
    );

    SELECT COALESCE(sum((e->>'quantity')::numeric * (e->>'unit_price')::numeric), 0)
    INTO v_total
    FROM jsonb_array_elements(v_priced) e;

    SELECT jsonb_agg(
             jsonb_build_object(
               'name', p.name,
               'qty', x.quantity,
               'unit_cost', x.unit_price
             ) ORDER BY p.name
           )
    INTO v_summary_lines
    FROM jsonb_to_recordset(v_lines) AS x(
      product_id bigint, quantity numeric, unit_price numeric, expiry_date date
    )
    JOIN public.products p ON p.id = x.product_id;

    v_payload := jsonb_build_object('lines', v_priced);
    v_summary := jsonb_build_object(
      'kind', p_kind,
      'lines', v_summary_lines,
      'total', v_total
    );
    v_strong := false;

  -- -------------------------------------------------------------------------
  -- price_update: cambios de precio (SOLO WEB en esta versión).
  -- -------------------------------------------------------------------------
  ELSIF p_kind = 'price_update' THEN
    v_scope := p_payload->>'scope';
    IF v_scope IS NULL OR v_scope NOT IN ('store', 'distributor') THEN
      RAISE EXCEPTION 'agent_prepare_action: scope de precio inválido';
    END IF;
    v_lines := p_payload->'lines';
    IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
      RAISE EXCEPTION 'agent_prepare_action: no hay cambios de precio';
    END IF;
    IF jsonb_array_length(v_lines) > 50 THEN
      RAISE EXCEPTION 'agent_prepare_action: máximo 50 productos por borrador';
    END IF;
    IF (
      SELECT count(DISTINCT (e->>'product_id')::bigint)
      FROM jsonb_array_elements(v_lines) e
    ) <> jsonb_array_length(v_lines) THEN
      RAISE EXCEPTION 'agent_prepare_action: producto repetido en el lote';
    END IF;

    v_priced := '[]'::jsonb;
    v_summary_lines := '[]'::jsonb;

    IF v_scope = 'store' THEN
      IF v_role NOT IN ('admin', 'operador') THEN
        RAISE EXCEPTION 'agent_prepare_action: solo admin/operador';
      END IF;
      IF NOT public.is_premium() THEN
        RAISE EXCEPTION 'agent_prepare_action: precios requiere Premium';
      END IF;
      v_store := (p_payload->>'store_id')::bigint;
      IF v_store IS NULL THEN
        RAISE EXCEPTION 'agent_prepare_action: tienda requerida';
      END IF;
      IF v_role = 'operador' AND NOT (v_store = ANY (public.my_store_ids())) THEN
        RAISE EXCEPTION 'agent_prepare_action: tienda fuera del alcance';
      END IF;

      FOR v_line IN
        SELECT * FROM jsonb_to_recordset(v_lines) AS x(
          product_id bigint, purchase_price numeric(12,2), sale_price numeric(12,2),
          set_purchase boolean, set_sale boolean
        )
      LOOP
        IF v_line.product_id IS NULL THEN
          RAISE EXCEPTION 'agent_prepare_action: producto requerido';
        END IF;
        IF NOT COALESCE(v_line.set_purchase, false)
           AND NOT COALESCE(v_line.set_sale, false) THEN
          RAISE EXCEPTION 'agent_prepare_action: la fila no indica qué precio cambiar';
        END IF;
        IF COALESCE(v_line.set_purchase, false)
           AND v_line.purchase_price IS NOT NULL AND v_line.purchase_price <= 0 THEN
          RAISE EXCEPTION 'agent_prepare_action: el precio de compra debe ser > 0';
        END IF;
        IF COALESCE(v_line.set_sale, false)
           AND v_line.sale_price IS NOT NULL AND v_line.sale_price <= 0 THEN
          RAISE EXCEPTION 'agent_prepare_action: el precio de venta debe ser > 0';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM public.stock s
          WHERE s.store_id = v_store AND s.product_id = v_line.product_id
        ) THEN
          RAISE EXCEPTION 'agent_prepare_action: el producto % no está en la tienda',
            v_line.product_id;
        END IF;

        SELECT spp.purchase_price INTO v_old_purchase
        FROM public.store_product_prices spp
        WHERE spp.store_id = v_store AND spp.product_id = v_line.product_id;
        SELECT pp.price INTO v_old_sale
        FROM public.price_publications pp
        WHERE pp.product_id = v_line.product_id AND pp.store_id = v_store AND pp.is_active;

        v_priced := v_priced || jsonb_build_array(jsonb_build_object(
          'product_id', v_line.product_id,
          'set_purchase', COALESCE(v_line.set_purchase, false),
          'set_sale', COALESCE(v_line.set_sale, false),
          'purchase_price', v_line.purchase_price,
          'sale_price', v_line.sale_price,
          'old_purchase_price', v_old_purchase,
          'old_sale_price', v_old_sale
        ));

        SELECT p.name INTO v_product_name FROM public.products p WHERE p.id = v_line.product_id;
        v_summary_lines := v_summary_lines || jsonb_build_array(jsonb_build_object(
          'product', v_product_name,
          'old_purchase', v_old_purchase,
          'new_purchase', CASE WHEN COALESCE(v_line.set_purchase, false)
                               THEN v_line.purchase_price ELSE v_old_purchase END,
          'old_sale', v_old_sale,
          'new_sale', CASE WHEN COALESCE(v_line.set_sale, false)
                           THEN v_line.sale_price ELSE v_old_sale END
        ));
      END LOOP;
    ELSE
      IF v_role <> 'distribuidor' THEN
        RAISE EXCEPTION 'agent_prepare_action: solo distribuidor';
      END IF;
      IF NOT public.is_premium() THEN
        RAISE EXCEPTION 'agent_prepare_action: precios requiere Premium';
      END IF;
      v_dist := public.my_distributor_id();
      IF v_dist IS NULL THEN
        RAISE EXCEPTION 'agent_prepare_action: distribuidora no identificada';
      END IF;
      v_store := NULL;

      FOR v_line IN
        SELECT * FROM jsonb_to_recordset(v_lines) AS x(
          product_id bigint, purchase_price numeric(12,2), sale_price numeric(12,2),
          set_purchase boolean, set_sale boolean
        )
      LOOP
        IF v_line.product_id IS NULL THEN
          RAISE EXCEPTION 'agent_prepare_action: producto requerido';
        END IF;
        IF NOT COALESCE(v_line.set_purchase, false)
           AND NOT COALESCE(v_line.set_sale, false) THEN
          RAISE EXCEPTION 'agent_prepare_action: la fila no indica qué precio cambiar';
        END IF;
        IF COALESCE(v_line.set_purchase, false)
           AND v_line.purchase_price IS NOT NULL AND v_line.purchase_price <= 0 THEN
          RAISE EXCEPTION 'agent_prepare_action: el precio de compra debe ser > 0';
        END IF;
        IF COALESCE(v_line.set_sale, false)
           AND v_line.sale_price IS NOT NULL AND v_line.sale_price <= 0 THEN
          RAISE EXCEPTION 'agent_prepare_action: el precio de venta debe ser > 0';
        END IF;

        SELECT dp.purchase_price, dp.sale_price
        INTO v_old_purchase, v_old_sale
        FROM public.distributor_products dp
        WHERE dp.distributor_id = v_dist AND dp.product_id = v_line.product_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'agent_prepare_action: el producto % no está en tu catálogo',
            v_line.product_id;
        END IF;

        v_priced := v_priced || jsonb_build_array(jsonb_build_object(
          'product_id', v_line.product_id,
          'set_purchase', COALESCE(v_line.set_purchase, false),
          'set_sale', COALESCE(v_line.set_sale, false),
          'purchase_price', v_line.purchase_price,
          'sale_price', v_line.sale_price,
          'old_purchase_price', v_old_purchase,
          'old_sale_price', v_old_sale
        ));

        SELECT p.name INTO v_product_name FROM public.products p WHERE p.id = v_line.product_id;
        v_summary_lines := v_summary_lines || jsonb_build_array(jsonb_build_object(
          'product', v_product_name,
          'old_purchase', v_old_purchase,
          'new_purchase', CASE WHEN COALESCE(v_line.set_purchase, false)
                               THEN v_line.purchase_price ELSE v_old_purchase END,
          'old_sale', v_old_sale,
          'new_sale', CASE WHEN COALESCE(v_line.set_sale, false)
                           THEN v_line.sale_price ELSE v_old_sale END
        ));
      END LOOP;
    END IF;

    v_payload := jsonb_build_object('scope', v_scope, 'store_id', v_store, 'lines', v_priced);
    v_summary := jsonb_build_object(
      'kind', p_kind,
      'scope', v_scope,
      'store', CASE WHEN v_store IS NULL THEN NULL
                    ELSE (SELECT name FROM public.stores WHERE id = v_store) END,
      'lines', v_summary_lines
    );
    v_strong := true;

  -- -------------------------------------------------------------------------
  -- shortage_toggle: activar/desactivar faltante (stock.is_shortage).
  -- -------------------------------------------------------------------------
  ELSIF p_kind = 'shortage_toggle' THEN
    IF v_role NOT IN ('admin', 'operador') THEN
      RAISE EXCEPTION 'agent_prepare_action: solo admin/operador';
    END IF;
    v_store := (p_payload->>'store_id')::bigint;
    v_product := (p_payload->>'product_id')::bigint;
    v_shortage := (p_payload->>'shortage')::boolean;
    IF v_store IS NULL OR v_product IS NULL OR v_shortage IS NULL THEN
      RAISE EXCEPTION 'agent_prepare_action: tienda, producto y estado requeridos';
    END IF;
    IF v_role = 'operador' AND NOT (v_store = ANY (public.my_store_ids())) THEN
      RAISE EXCEPTION 'agent_prepare_action: tienda fuera del alcance';
    END IF;

    SELECT s.is_shortage INTO v_old_shortage
    FROM public.stock s
    JOIN public.products p ON p.id = s.product_id AND p.is_active
    WHERE s.store_id = v_store AND s.product_id = v_product;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'agent_prepare_action: el producto no está asignado a la tienda';
    END IF;

    SELECT p.name INTO v_product_name FROM public.products p WHERE p.id = v_product;
    v_payload := jsonb_build_object(
      'store_id', v_store,
      'product_id', v_product,
      'shortage', v_shortage
    );
    v_summary := jsonb_build_object(
      'kind', p_kind,
      'store', (SELECT name FROM public.stores WHERE id = v_store),
      'product', v_product_name,
      'old', v_old_shortage,
      'new', v_shortage
    );
    v_strong := false;

  ELSE
    RAISE EXCEPTION 'agent_prepare_action: kind no soportado';
  END IF;

  INSERT INTO public.agent_actions (
    user_id, conversation_id, kind, status, channel,
    requires_strong_confirmation, payload, summary, expires_at
  )
  VALUES (
    v_user, p_conversation, p_kind, 'pending', 'web',
    v_strong, v_payload, v_summary, now() + INTERVAL '10 minutes'
  )
  RETURNING id, expires_at INTO v_id, v_expires;

  RETURN jsonb_build_object(
    'action_id', v_id,
    'summary', v_summary,
    'expires_at', v_expires,
    'requires_strong_confirmation', v_strong
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. agent_execute_action — confirma y ejecuta. Idempotente por estado.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_execute_action(
  p_action       bigint,
  p_confirmation text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_user          uuid := auth.uid();
  v_action        public.agent_actions%ROWTYPE;
  v_count         integer := 0;
  v_result        jsonb;
  v_line          jsonb;
  v_curr_purchase numeric;
  v_curr_sale     numeric;
  v_dist          bigint;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'agent_execute_action: sesión requerida';
  END IF;
  SELECT * INTO v_action
  FROM public.agent_actions
  WHERE id = p_action
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_execute_action: acción inexistente';
  END IF;
  IF v_action.user_id <> v_user THEN
    RAISE EXCEPTION 'agent_execute_action: la acción no te pertenece';
  END IF;
  IF v_action.status = 'executed' THEN
    RETURN COALESCE(v_action.result, '{}'::jsonb)
      || jsonb_build_object('ok', true, 'already', true);
  END IF;
  IF v_action.status <> 'pending' THEN
    RAISE EXCEPTION 'agent_execute_action: la acción ya no está pendiente';
  END IF;
  IF v_action.expires_at <= now() THEN
    UPDATE public.agent_actions SET status = 'expired' WHERE id = p_action;
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  -- Confirmación fuerte para operaciones de dinero (precios).
  IF v_action.requires_strong_confirmation
     AND COALESCE(p_confirmation, '') <> 'CONFIRMAR' THEN
    RAISE EXCEPTION 'agent_execute_action: confirmación fuerte requerida';
  END IF;

  -- Concurrencia optimista de precios: no pisar un cambio ajeno.
  IF v_action.kind = 'price_update' THEN
    IF (v_action.payload->'lines') IS NULL OR jsonb_typeof(v_action.payload->'lines') <> 'array' THEN
      RAISE EXCEPTION 'agent_execute_action: payload de precio inválido';
    END IF;
    IF (v_action.payload->>'scope') = 'store' THEN
      FOR v_line IN SELECT * FROM jsonb_array_elements(v_action.payload->'lines') LOOP
        IF (v_line->>'set_purchase')::boolean THEN
          SELECT spp.purchase_price INTO v_curr_purchase
          FROM public.store_product_prices spp
          WHERE spp.store_id = (v_action.payload->>'store_id')::bigint
            AND spp.product_id = (v_line->>'product_id')::bigint;
          IF v_curr_purchase IS DISTINCT FROM (v_line->>'old_purchase_price')::numeric THEN
            UPDATE public.agent_actions
            SET status = 'failed', error = 'stale_draft'
            WHERE id = p_action;
            RETURN jsonb_build_object('ok', false, 'error', 'stale_draft');
          END IF;
        END IF;
        IF (v_line->>'set_sale')::boolean THEN
          SELECT pp.price INTO v_curr_sale
          FROM public.price_publications pp
          WHERE pp.product_id = (v_line->>'product_id')::bigint
            AND pp.store_id = (v_action.payload->>'store_id')::bigint
            AND pp.is_active;
          IF v_curr_sale IS DISTINCT FROM (v_line->>'old_sale_price')::numeric THEN
            UPDATE public.agent_actions
            SET status = 'failed', error = 'stale_draft'
            WHERE id = p_action;
            RETURN jsonb_build_object('ok', false, 'error', 'stale_draft');
          END IF;
        END IF;
      END LOOP;
    ELSE
      v_dist := public.my_distributor_id();
      IF v_dist IS NULL THEN
        RAISE EXCEPTION 'agent_execute_action: distribuidora no identificada';
      END IF;
      FOR v_line IN SELECT * FROM jsonb_array_elements(v_action.payload->'lines') LOOP
        IF (v_line->>'set_purchase')::boolean THEN
          SELECT dp.purchase_price INTO v_curr_purchase
          FROM public.distributor_products dp
          WHERE dp.distributor_id = v_dist
            AND dp.product_id = (v_line->>'product_id')::bigint;
          IF v_curr_purchase IS DISTINCT FROM (v_line->>'old_purchase_price')::numeric THEN
            UPDATE public.agent_actions
            SET status = 'failed', error = 'stale_draft'
            WHERE id = p_action;
            RETURN jsonb_build_object('ok', false, 'error', 'stale_draft');
          END IF;
        END IF;
        IF (v_line->>'set_sale')::boolean THEN
          SELECT dp.sale_price INTO v_curr_sale
          FROM public.distributor_products dp
          WHERE dp.distributor_id = v_dist
            AND dp.product_id = (v_line->>'product_id')::bigint;
          IF v_curr_sale IS DISTINCT FROM (v_line->>'old_sale_price')::numeric THEN
            UPDATE public.agent_actions
            SET status = 'failed', error = 'stale_draft'
            WHERE id = p_action;
            RETURN jsonb_build_object('ok', false, 'error', 'stale_draft');
          END IF;
        END IF;
      END LOOP;
    END IF;
  END IF;

  BEGIN
    CASE v_action.kind
      WHEN 'store_exit' THEN
        v_count := public.register_movements_bulk(
          (v_action.payload->>'store_id')::bigint,
          'exit'::public.movement_type,
          (v_action.payload->>'motive_id')::bigint,
          v_action.payload->'lines',
          (v_action.payload->>'discount')::numeric
        );
        v_result := jsonb_build_object('count', v_count);

      WHEN 'distributor_sale' THEN
        v_count := public.register_distributor_sales_bulk(
          (v_action.payload->>'store_id')::bigint,
          v_action.payload->'lines',
          (v_action.payload->>'discount')::numeric
        );
        v_result := jsonb_build_object('count', v_count);

      WHEN 'distributor_purchase' THEN
        v_count := public.register_distributor_purchases(v_action.payload->'lines');
        v_result := jsonb_build_object('count', v_count);

      WHEN 'price_update' THEN
        IF (v_action.payload->>'scope') = 'store' THEN
          v_count := public.set_store_prices_bulk(
            (v_action.payload->>'store_id')::bigint,
            v_action.payload->'lines'
          );
        ELSE
          v_count := public.set_distributor_prices_bulk(v_action.payload->'lines');
        END IF;
        v_result := jsonb_build_object('count', v_count);

      WHEN 'shortage_toggle' THEN
        PERFORM public.set_store_shortage(
          (v_action.payload->>'product_id')::bigint,
          (v_action.payload->>'store_id')::bigint,
          (v_action.payload->>'shortage')::boolean
        );
        v_result := jsonb_build_object('count', 1);

      ELSE
        RAISE EXCEPTION 'agent_execute_action: kind no soportado';
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.agent_actions
    SET status = 'failed', error = SQLERRM
    WHERE id = p_action;
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  UPDATE public.agent_actions
  SET status = 'executed', result = v_result, executed_at = now()
  WHERE id = p_action;

  RETURN v_result || jsonb_build_object('ok', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. agent_cancel_action — cancela un borrador pendiente.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_cancel_action(p_action bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_action public.agent_actions%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'agent_cancel_action: sesión requerida';
  END IF;
  SELECT * INTO v_action
  FROM public.agent_actions
  WHERE id = p_action
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_cancel_action: acción inexistente';
  END IF;
  IF v_action.user_id <> v_user THEN
    RAISE EXCEPTION 'agent_cancel_action: la acción no te pertenece';
  END IF;
  IF v_action.status <> 'pending' THEN
    RAISE EXCEPTION 'agent_cancel_action: la acción ya no está pendiente';
  END IF;
  UPDATE public.agent_actions
  SET status = 'cancelled', cancelled_at = now()
  WHERE id = p_action;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. Wrappers WhatsApp — solo service_role; fijan claims locales.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_prepare_action_for_user(
  p_user         uuid,
  p_wa_id        text,
  p_conversation bigint,
  p_kind         public.agent_action_kind,
  p_payload      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_result jsonb;
  v_code   text;
  v_id     bigint;
BEGIN
  -- Decisión de producto: precios solo en la web.
  IF p_kind = 'price_update' THEN
    RAISE EXCEPTION 'price_update solo web';
  END IF;
  IF p_wa_id IS NULL OR p_wa_id = '' THEN
    RAISE EXCEPTION 'agent_prepare_action_for_user: wa_id requerido';
  END IF;

  PERFORM public.internal_assert_wa_identity(p_user, p_wa_id);
  PERFORM public.internal_set_actor(p_user);
  v_result := public.agent_prepare_action(p_conversation, p_kind, p_payload);
  v_id := (v_result->>'action_id')::bigint;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  UPDATE public.agent_actions
  SET channel = 'whatsapp',
      wa_id = p_wa_id,
      confirmation_code = v_code
  WHERE id = v_id;

  RETURN v_result || jsonb_build_object(
    'channel', 'whatsapp',
    'confirmation_code', v_code
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_execute_action_for_user(
  p_user  uuid,
  p_wa_id text,
  p_action bigint,
  p_code  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.agent_actions a
    WHERE a.id = p_action
      AND a.user_id = p_user
      AND a.channel = 'whatsapp'
      AND a.wa_id = p_wa_id
      AND a.confirmation_code = p_code
  ) THEN
    RAISE EXCEPTION 'agent_execute_action_for_user: confirmación inválida';
  END IF;

  PERFORM public.internal_assert_wa_identity(p_user, p_wa_id);
  PERFORM public.internal_set_actor(p_user);
  RETURN public.agent_execute_action(p_action);
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_cancel_action_for_user(
  p_user  uuid,
  p_wa_id text,
  p_action bigint,
  p_code  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.agent_actions a
    WHERE a.id = p_action
      AND a.user_id = p_user
      AND a.channel = 'whatsapp'
      AND a.wa_id = p_wa_id
      AND a.confirmation_code = p_code
  ) THEN
    RAISE EXCEPTION 'agent_cancel_action_for_user: confirmación inválida';
  END IF;

  PERFORM public.internal_assert_wa_identity(p_user, p_wa_id);
  PERFORM public.internal_set_actor(p_user);
  RETURN public.agent_cancel_action(p_action);
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. Grants
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  public.agent_prepare_action(bigint, public.agent_action_kind, jsonb),
  public.agent_execute_action(bigint, text),
  public.agent_cancel_action(bigint)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.agent_prepare_action(bigint, public.agent_action_kind, jsonb),
  public.agent_execute_action(bigint, text),
  public.agent_cancel_action(bigint)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.internal_set_actor(uuid),
  public.internal_assert_wa_identity(uuid, text),
  public.agent_prepare_action_for_user(uuid, text, bigint, public.agent_action_kind, jsonb),
  public.agent_execute_action_for_user(uuid, text, bigint, text),
  public.agent_cancel_action_for_user(uuid, text, bigint, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.internal_set_actor(uuid),
  public.internal_assert_wa_identity(uuid, text),
  public.agent_prepare_action_for_user(uuid, text, bigint, public.agent_action_kind, jsonb),
  public.agent_execute_action_for_user(uuid, text, bigint, text),
  public.agent_cancel_action_for_user(uuid, text, bigint, text)
  TO service_role;

-- ----------------------------------------------------------------------------
-- Verificación manual (SQL Editor):
--   · Web: insertar un borrador como admin/operador y ejecutarlo con un JWT.
--   · Otro usuario no puede leer ni ejecutar el borrador (RLS + user_id).
--   · WhatsApp: agent_prepare_action_for_user(..., 'price_update', ...) falla.
--   · Un código incorrecto en agent_execute_action_for_user falla.
--   · Doble ejecución devuelve { ok: true, already: true }.
--   · Borrador con expires_at pasado devuelve { ok: false, error: 'expired' }.
--   · Un cambio de precio concurrente devuelve { ok: false, error: 'stale_draft' }.
-- ----------------------------------------------------------------------------
