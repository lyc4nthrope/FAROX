-- ============================================================================
-- FAROX — 20261112202902: asistente por WhatsApp (fase 2, slice 4).
--
-- El webhook no tiene JWT de usuario: resuelve el usuario por el teléfono
-- verificado y usa estas variantes _for_user, exclusivas de service_role.
-- Cada wrapper fija las claims locales con internal_set_actor y reutiliza la
-- RPC existente (misma RLS/rol/Premium que la web).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. internal_user_for_wa_id — identidad del remitente.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.internal_user_for_wa_id(p_wa_id text)
RETURNS TABLE (
  user_id        uuid,
  role_name      text,
  premium_active boolean,
  full_name      text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.id,
         r.name,
         (r.name = 'admin'
          OR (u.premium AND (u.premium_until IS NULL OR u.premium_until > now()))),
         u.full_name
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id
  WHERE u.is_active
    AND u.phone_verified_at IS NOT NULL
    AND regexp_replace(COALESCE(u.phone_number, ''), '\D', '', 'g') = p_wa_id
  LIMIT 1;
$$;

-- ----------------------------------------------------------------------------
-- 2. Lecturas _for_user — mismas firmas que las RPC web.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_search_products_for_user(
  p_user uuid,
  p_term text
)
RETURNS TABLE (product_id bigint, name text, brand text, barcode text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.internal_set_actor(p_user);
  RETURN QUERY SELECT * FROM public.agent_search_products(p_term);
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_stock_for_user(
  p_user uuid,
  p_product bigint
)
RETURNS TABLE (store_name text, quantity numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.internal_set_actor(p_user);
  RETURN QUERY SELECT * FROM public.agent_stock(p_product);
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_last_order_for_user(
  p_user uuid,
  p_product bigint
)
RETURNS TABLE (store_name text, last_at timestamptz, days integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.internal_set_actor(p_user);
  RETURN QUERY SELECT * FROM public.agent_last_order(p_product);
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_dashboard_for_user(
  p_user uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  day            date,
  distributor_id bigint,
  entries_count  integer,
  exits_count    integer,
  entries_value  numeric,
  exits_value    numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.internal_set_actor(p_user);
  RETURN QUERY SELECT * FROM public.get_dashboard(p_from, p_to);
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_list_stores_for_user(p_user uuid)
RETURNS TABLE (id bigint, name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text;
BEGIN
  PERFORM public.internal_set_actor(p_user);
  v_role := COALESCE(public.my_role(), '');

  IF v_role = 'distribuidor' THEN
    RETURN QUERY
      SELECT sd.store_id, s.name
      FROM public.store_distributors sd
      JOIN public.stores s ON s.id = sd.store_id AND s.is_active
      WHERE sd.distributor_id = public.my_distributor_id()
      ORDER BY s.name;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT s.id, s.name
    FROM public.stores s
    WHERE s.is_active
      AND (v_role = 'admin' OR s.id = ANY (public.my_store_ids()))
    ORDER BY s.name
    LIMIT 200;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Grants — solo service_role.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  public.internal_user_for_wa_id(text),
  public.agent_search_products_for_user(uuid, text),
  public.agent_stock_for_user(uuid, bigint),
  public.agent_last_order_for_user(uuid, bigint),
  public.agent_dashboard_for_user(uuid, date, date),
  public.agent_list_stores_for_user(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.internal_user_for_wa_id(text),
  public.agent_search_products_for_user(uuid, text),
  public.agent_stock_for_user(uuid, bigint),
  public.agent_last_order_for_user(uuid, bigint),
  public.agent_dashboard_for_user(uuid, date, date),
  public.agent_list_stores_for_user(uuid)
  TO service_role;

-- ----------------------------------------------------------------------------
-- Verificación manual (SQL Editor):
--   · internal_user_for_wa_id('<telefono verificado>') ⇒ 1 fila.
--   · Un teléfono no verificado ⇒ 0 filas.
--   · agent_list_stores_for_user: admin todas; operador su alcance;
--     distribuidor solo sus tiendas vinculadas.
--   · agent_dashboard_for_user: mismo resultado que get_dashboard para el
--     usuario; un usuario no Premium ⇒ 0 filas.
--   · authenticated NO puede ejecutar ninguna de estas funciones.
-- ----------------------------------------------------------------------------
