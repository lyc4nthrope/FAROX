-- ============================================================================
-- FAROX — 20261113000052: wrappers de WhatsApp marcados VOLATILE.
--
-- plpgsql_check detecta que las cinco variantes *_for_user están marcadas
-- STABLE pero llaman a internal_set_actor(), que es VOLATILE (fija las
-- claims locales de la sesión). La anotación correcta es VOLATILE.
--
-- No cambia firmas, cuerpo, seguridad ni grants; solo la volatilidad.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.agent_search_products_for_user(
  p_user uuid,
  p_term text
)
RETURNS TABLE (product_id bigint, name text, brand text, barcode text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.internal_set_actor(p_user);
  RETURN QUERY SELECT * FROM public.get_dashboard(p_from, p_to);
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_list_stores_for_user(p_user uuid)
RETURNS TABLE (id bigint, name text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
