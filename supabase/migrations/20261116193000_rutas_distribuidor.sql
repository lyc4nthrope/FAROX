-- ============================================================================
-- FAROX — 20261116193000: rutas del distribuidor (0056).
--
--   1. update_route_status: el distribuidor puede iniciar (planned → active)
--      su propia ruta. Antes solo el admin la iniciaba, y como el distribuidor
--      solo puede terminar una ruta activa, su ruta del día quedaba bloqueada.
--   2. save_route: cada parada debe ser una tienda vinculada al distribuidor
--      (store_distributors). Las paradas habilitan leer el stock de la tienda,
--      así que una parada en una tienda ajena exponía su inventario.
--   3. save_route: una ruta completada no se replanifica (borraba sus paradas
--      y el registro de visitas).
--
--   Re-ejecutable: CREATE OR REPLACE (conserva los GRANT de 0004/0006).
--   Rollback: restaurar ambas funciones desde 20261015000004_functions_triggers.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_route(
  p_distributor bigint, p_route_date date, p_stops jsonb DEFAULT '[]'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := public.my_role();
  v_route  bigint;
  v_status public.route_status;
  it       record;
BEGIN
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor' AND p_distributor = public.my_distributor_id() THEN
    NULL;  -- paradas propias
  ELSE
    RAISE EXCEPTION 'save_route: solo admin, o distribuidor sobre su propia ruta';
  END IF;
  IF p_route_date IS NULL THEN RAISE EXCEPTION 'save_route: route_date requerida'; END IF;
  SELECT id, status INTO v_route, v_status FROM public.routes
  WHERE distributor_id = p_distributor AND route_date = p_route_date AND status <> 'cancelled'
  FOR UPDATE;
  -- 0056: reemplazar las paradas de una ruta cerrada borraba su historial.
  IF FOUND AND v_status = 'completed' THEN
    RAISE EXCEPTION 'save_route: la ruta del % ya está completada; no se puede replanificar', p_route_date;
  END IF;
  IF FOUND THEN
    DELETE FROM public.route_stops WHERE route_id = v_route;  -- reemplaza el listado completo
  ELSE
    INSERT INTO public.routes (distributor_id, route_date)
    VALUES (p_distributor, p_route_date)
    RETURNING id INTO v_route;
  END IF;
  FOR it IN
    SELECT x.store_id, x.stop_order, x.estimated_time
    FROM jsonb_to_recordset(COALESCE(p_stops, '[]'::jsonb))
      AS x(store_id bigint, stop_order smallint, estimated_time time)
  LOOP
    IF it.stop_order IS NULL OR it.stop_order <= 0 THEN
      RAISE EXCEPTION 'save_route: stop_order debe ser > 0';
    END IF;
    -- 0056: las paradas habilitan al distribuidor a leer el stock de la tienda
    -- (stock_select / get_stock); solo tiendas vinculadas a él.
    IF NOT EXISTS (SELECT 1 FROM public.store_distributors sd
                   WHERE sd.store_id = it.store_id AND sd.distributor_id = p_distributor) THEN
      RAISE EXCEPTION 'save_route: la tienda % no está vinculada a este distribuidor', it.store_id;
    END IF;
    INSERT INTO public.route_stops (route_id, store_id, stop_order, estimated_time)
    VALUES (v_route, it.store_id, it.stop_order, it.estimated_time);
  END LOOP;
  RETURN v_route;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_route_status(
  p_route bigint, p_status public.route_status
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := public.my_role();
  r      public.routes%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.routes WHERE id = p_route FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ruta inexistente: %', p_route; END IF;
  IF v_role = 'admin' THEN
    NULL;
  -- 0056: el distribuidor inicia y termina su propia ruta; cancelar sigue
  -- siendo del admin.
  ELSIF v_role = 'distribuidor'
        AND r.distributor_id = public.my_distributor_id()
        AND ((r.status = 'planned' AND p_status = 'active') OR
             (r.status = 'active'  AND p_status = 'completed')) THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'update_route_status: rol/estado no permitido (% → %)', r.status, p_status;
  END IF;
  IF NOT ((r.status = 'planned'   AND p_status IN ('active', 'cancelled')) OR
          (r.status = 'active'    AND p_status IN ('completed', 'cancelled'))) THEN
    RAISE EXCEPTION 'update_route_status: transición inválida % → %', r.status, p_status;
  END IF;
  UPDATE public.routes SET status = p_status WHERE id = p_route;
END;
$$;
