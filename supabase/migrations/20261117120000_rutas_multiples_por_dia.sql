-- ============================================================================
-- FAROX — 20261117120000: varias rutas por día (0057).
--
--   1. Se elimina uq_routes_distributor_day: el mismo distribuidor puede tener
--      más de una ruta no cancelada en una fecha (mañana/tarde, recorridos
--      distintos).
--   2. create_route: crea SIEMPRE una ruta nueva con sus paradas. save_route
--      queda como compatibilidad para el front ya desplegado; el front nuevo
--      usa create_route/update_route_stops.
--   3. update_route_stops: reemplaza las paradas de una ruta planned. Una ruta
--      active/completed/cancelled no se edita: reemplazar paradas de una activa
--      reinicia el avance y una completada perdería el historial de visitas.
--
--   Seguridad: mismas reglas que save_route — admin, o distribuidor dueño; las
--   paradas deben ser tiendas vinculadas al distribuidor (store_distributors),
--   porque una parada habilita leer el stock de la tienda.
--
--   Re-ejecutable: DROP INDEX IF EXISTS + CREATE OR REPLACE.
--   Rollback: recrear uq_routes_distributor_day; restaurar update_route_stops
--   y create_route no existen antes de 0057. save_route no se toca.
-- ============================================================================

DROP INDEX IF EXISTS public.uq_routes_distributor_day;

CREATE OR REPLACE FUNCTION public.create_route(
  p_distributor bigint, p_route_date date, p_stops jsonb DEFAULT '[]'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := COALESCE(public.my_role(), '');
  v_route bigint;
  it      record;
BEGIN
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor' AND p_distributor = public.my_distributor_id() THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'create_route: solo admin, o distribuidor sobre su propia ruta';
  END IF;
  IF p_route_date IS NULL THEN
    RAISE EXCEPTION 'create_route: route_date requerida';
  END IF;
  IF p_stops IS NULL OR jsonb_typeof(p_stops) <> 'array' THEN
    RAISE EXCEPTION 'create_route: p_stops debe ser un array';
  END IF;

  INSERT INTO public.routes (distributor_id, route_date)
  VALUES (p_distributor, p_route_date)
  RETURNING id INTO v_route;

  FOR it IN
    SELECT x.store_id, x.stop_order, x.estimated_time
    FROM jsonb_to_recordset(p_stops)
      AS x(store_id bigint, stop_order smallint, estimated_time time)
  LOOP
    IF it.stop_order IS NULL OR it.stop_order <= 0 THEN
      RAISE EXCEPTION 'create_route: stop_order debe ser > 0';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.store_distributors sd
                   WHERE sd.store_id = it.store_id AND sd.distributor_id = p_distributor) THEN
      RAISE EXCEPTION 'create_route: la tienda % no está vinculada a este distribuidor', it.store_id;
    END IF;
    INSERT INTO public.route_stops (route_id, store_id, stop_order, estimated_time)
    VALUES (v_route, it.store_id, it.stop_order, it.estimated_time);
  END LOOP;

  RETURN v_route;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_route_stops(
  p_route bigint, p_stops jsonb DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');
  r      public.routes%ROWTYPE;
  it     record;
BEGIN
  SELECT * INTO r FROM public.routes WHERE id = p_route FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_route_stops: ruta inexistente %', p_route;
  END IF;
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor' AND r.distributor_id = public.my_distributor_id() THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'update_route_stops: sin alcance sobre la ruta %', p_route;
  END IF;
  IF r.status <> 'planned' THEN
    RAISE EXCEPTION 'update_route_stops: solo se edita una ruta planificada (estado "%")', r.status;
  END IF;
  IF p_stops IS NULL OR jsonb_typeof(p_stops) <> 'array' THEN
    RAISE EXCEPTION 'update_route_stops: p_stops debe ser un array';
  END IF;

  DELETE FROM public.route_stops WHERE route_id = p_route;

  FOR it IN
    SELECT x.store_id, x.stop_order, x.estimated_time
    FROM jsonb_to_recordset(p_stops)
      AS x(store_id bigint, stop_order smallint, estimated_time time)
  LOOP
    IF it.stop_order IS NULL OR it.stop_order <= 0 THEN
      RAISE EXCEPTION 'update_route_stops: stop_order debe ser > 0';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.store_distributors sd
                   WHERE sd.store_id = it.store_id AND sd.distributor_id = r.distributor_id) THEN
      RAISE EXCEPTION 'update_route_stops: la tienda % no está vinculada a este distribuidor', it.store_id;
    END IF;
    INSERT INTO public.route_stops (route_id, store_id, stop_order, estimated_time)
    VALUES (p_route, it.store_id, it.stop_order, it.estimated_time);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.create_route(bigint, date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_route(bigint, date, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_route_stops(bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_route_stops(bigint, jsonb) TO authenticated, service_role;
