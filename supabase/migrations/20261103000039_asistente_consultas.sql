-- ============================================================================
-- FAROX — 0039: asistente (fase 1, solo consultas) + tienda de la conversación.
--
--   1. chat_conversations.store_id — contexto de tienda elegido por el usuario.
--   2. create_chat(p_title, p_store) — crea la conversación validando el alcance
--      de la tienda (admin / operador / distribuidor vinculado).
--   3. agent_search_products — búsqueda de productos sin extensiones nuevas
--      (translate para ignorar acentos; D22 sigue vigente: sin pg_trgm).
--   4. agent_stock — stock del producto según el rol (tiendas o catálogo).
--   5. agent_last_order — último pedido del producto y días sin pedirlo.
--
-- Reglas del repo: SECURITY DEFINER + SET search_path; alcance desde el JWT;
-- GRANT explícito. Estas RPC son SOLO lectura: el asistente de fase 1 no
-- escribe movimientos.
-- ============================================================================

-- ============================================================================
-- 1. Contexto de tienda de la conversación.
-- ============================================================================
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS store_id bigint NULL
  REFERENCES public.stores(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_store
  ON public.chat_conversations (store_id)
  WHERE store_id IS NOT NULL;

-- ============================================================================
-- 2. create_chat con tienda (overload de 2 argumentos; el de 1 sigue igual).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_chat(p_title text, p_store bigint)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');
  v_id   bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'create_chat: requiere sesión';
  END IF;
  IF p_store IS NOT NULL THEN
    IF NOT (
      v_role = 'admin'
      OR (v_role = 'operador' AND p_store = ANY (public.my_store_ids()))
      OR (v_role = 'distribuidor' AND EXISTS (
            SELECT 1
            FROM public.store_distributors sd
            WHERE sd.store_id = p_store
              AND sd.distributor_id = public.my_distributor_id()
          ))
    ) THEN
      RAISE EXCEPTION 'create_chat: tienda fuera del alcance';
    END IF;
  END IF;
  INSERT INTO public.chat_conversations (user_id, title, store_id)
  VALUES (auth.uid(), p_title, p_store)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ============================================================================
-- 3. agent_search_products — nombre, marca o código de barras.
--    Sin pg_trgm (D22): normalización por translate + LIKE.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.agent_search_products(p_term text)
RETURNS TABLE (product_id bigint, name text, brand text, barcode text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH term AS (
    SELECT translate(lower(btrim(COALESCE(p_term, ''))), 'áéíóúüñ', 'aeiouun') AS q
  )
  SELECT p.id, p.name, b.name, p.barcode
  FROM public.products p
  LEFT JOIN public.brands b ON b.id = p.brand_id
  CROSS JOIN term t
  WHERE p.is_active
    AND t.q <> ''
    AND (
      translate(lower(p.name), 'áéíóúüñ', 'aeiouun') LIKE '%' || t.q || '%'
      OR translate(lower(COALESCE(b.name, '')), 'áéíóúüñ', 'aeiouun') LIKE '%' || t.q || '%'
      OR COALESCE(p.barcode, '') LIKE t.q || '%'
    )
  ORDER BY p.name
  LIMIT 8;
$$;

-- ============================================================================
-- 4. agent_stock — stock visible para el rol.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.agent_stock(p_product bigint)
RETURNS TABLE (store_name text, quantity numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH rows AS (
    SELECT s.name AS store_name, st.quantity
    FROM public.stock st
    JOIN public.stores s ON s.id = st.store_id
    WHERE st.product_id = p_product
      AND (
        public.my_role() = 'admin'
        OR (public.my_role() = 'operador' AND st.store_id = ANY (public.my_store_ids()))
      )
    UNION ALL
    SELECT 'Mi catálogo'::text AS store_name, dp.quantity
    FROM public.distributor_products dp
    WHERE dp.product_id = p_product
      AND public.my_role() = 'distribuidor'
      AND dp.distributor_id = public.my_distributor_id()
  )
  SELECT rows.store_name, rows.quantity
  FROM rows
  ORDER BY rows.store_name
  LIMIT 20;
$$;

-- ============================================================================
-- 5. agent_last_order — último pedido del producto y días sin pedirlo.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.agent_last_order(p_product bigint)
RETURNS TABLE (store_name text, last_at timestamptz, days integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH scoped AS (
    SELECT o.id, o.store_id, o.created_at
    FROM public.orders o
    WHERE (
        public.my_role() = 'admin'
        OR (public.my_role() = 'operador' AND o.store_id = ANY (public.my_store_ids()))
        OR (public.my_role() = 'distribuidor'
            AND o.distributor_id = public.my_distributor_id())
      )
      AND EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.order_id = o.id AND oi.product_id = p_product
      )
  )
  SELECT s.name, max(sc.created_at) AS last_at,
         EXTRACT(DAY FROM now() - max(sc.created_at))::integer AS days
  FROM scoped sc
  JOIN public.stores s ON s.id = sc.store_id
  GROUP BY s.name
  ORDER BY max(sc.created_at) DESC
  LIMIT 10;
$$;

-- ============================================================================
-- 6. Grants
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.create_chat(text, bigint),
  public.agent_search_products(text),
  public.agent_stock(bigint),
  public.agent_last_order(bigint)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.create_chat(text, bigint),
  public.agent_search_products(text),
  public.agent_stock(bigint),
  public.agent_last_order(bigint)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · create_chat('Consulta', <tienda de otro>) ⇒ excepción de alcance.
--   · agent_search_products('arroz') ⇒ filas; con acentos ('cafe') ⇒ Café.
--   · agent_stock(<producto>) como operador ⇒ solo sus tiendas; como
--     distribuidor ⇒ «Mi catálogo».
--   · agent_last_order(<producto>) ⇒ último pedido y días.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   DROP FUNCTION IF EXISTS public.agent_last_order(bigint);
--   DROP FUNCTION IF EXISTS public.agent_stock(bigint);
--   DROP FUNCTION IF EXISTS public.agent_search_products(text);
--   DROP FUNCTION IF EXISTS public.create_chat(text, bigint);
--   DROP INDEX IF EXISTS public.idx_chat_conversations_store;
--   ALTER TABLE public.chat_conversations DROP COLUMN IF EXISTS store_id;
