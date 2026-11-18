-- ============================================================================
-- Prueba 0057: varias rutas por día, creación/edición separadas y alcance.
-- Correr con scripts/db-test.sh. Todo se revierte.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;
\ir _fixtures.sql

-- La tienda 990002 todavía NO está vinculada al distribuidor 990001.
INSERT INTO public.store_distributors (store_id, distributor_id, created_by)
VALUES (990002, 990002, '00000000-0000-0000-0000-000000990001');

-- T1. El distribuidor crea DOS rutas para la misma fecha.
DO $$
DECLARE v_r1 bigint; v_r2 bigint; v_count int;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  v_r1 := public.create_route(990001, DATE '2026-11-19',
                              '[{"store_id":990001,"stop_order":1}]'::jsonb);
  v_r2 := public.create_route(990001, DATE '2026-11-19',
                              '[{"store_id":990001,"stop_order":1}]'::jsonb);
  RESET ROLE;
  ASSERT v_r1 <> v_r2, 'T1: create_route devolvió el mismo id';
  SELECT count(*) INTO v_count FROM public.routes
  WHERE distributor_id = 990001 AND route_date = DATE '2026-11-19' AND status <> 'cancelled';
  ASSERT v_count = 2, format('T1: se esperaban 2 rutas, hay %s', v_count);
  ASSERT NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_routes_distributor_day'),
         'T1: sigue existiendo el índice único por día';
  RAISE NOTICE 'PASS T1 dos rutas por día';
END $$;

-- T2. Una tienda no vinculada rechaza la creación completa (sin ruta a medias).
DO $$
DECLARE v_msg text; v_count int;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.create_route(990001, DATE '2026-11-20',
                                '[{"store_id":990002,"stop_order":1}]'::jsonb);
  EXCEPTION WHEN raise_exception THEN v_msg := SQLERRM;
  END;
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.routes
  WHERE distributor_id = 990001 AND route_date = DATE '2026-11-20';
  ASSERT v_msg LIKE '%no está vinculada%', format('T2: mensaje inesperado: %s', v_msg);
  ASSERT v_count = 0, format('T2: quedó una ruta creada a medias (%s)', v_count);
  RAISE NOTICE 'PASS T2 tienda no vinculada rechazada';
END $$;

-- Desde acá la tienda 990002 queda vinculada al distribuidor 990001.
INSERT INTO public.store_distributors (store_id, distributor_id, created_by)
VALUES (990002, 990001, '00000000-0000-0000-0000-000000990001');

-- T3. update_route_stops reemplaza las paradas de una ruta planned.
DO $$
DECLARE v_route bigint; v_store bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  SELECT id INTO v_route FROM public.routes
  WHERE distributor_id = 990001 AND route_date = DATE '2026-11-19'
  ORDER BY id LIMIT 1;
  PERFORM public.update_route_stops(v_route,
                                    '[{"store_id":990002,"stop_order":1}]'::jsonb);
  RESET ROLE;
  SELECT store_id INTO v_store FROM public.route_stops WHERE route_id = v_route;
  ASSERT v_store = 990002, format('T3: la parada quedó en %s', v_store);
  ASSERT (SELECT status FROM public.routes WHERE id = v_route) = 'planned',
         'T3: la ruta dejó de estar planned';
  RAISE NOTICE 'PASS T3 edición de paradas planned';
END $$;

-- T4. update_route_stops rechaza una ruta active o completed.
DO $$
DECLARE v_route bigint; v_msg text; v_active boolean := false; v_completed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  SELECT id INTO v_route FROM public.routes
  WHERE distributor_id = 990001 AND route_date = DATE '2026-11-19'
  ORDER BY id LIMIT 1;
  PERFORM public.update_route_status(v_route, 'active');
  BEGIN
    PERFORM public.update_route_stops(v_route, '[]'::jsonb);
  EXCEPTION WHEN raise_exception THEN v_msg := SQLERRM; v_active := true;
  END;
  PERFORM public.update_route_status(v_route, 'completed');
  BEGIN
    PERFORM public.update_route_stops(v_route, '[]'::jsonb);
  EXCEPTION WHEN raise_exception THEN v_msg := SQLERRM; v_completed := true;
  END;
  RESET ROLE;
  ASSERT v_active, 'T4: se pudo editar una ruta activa';
  ASSERT v_completed, 'T4: se pudo editar una ruta completada';
  ASSERT v_msg LIKE '%solo se edita una ruta planificada%', format('T4: mensaje inesperado: %s', v_msg);
  RAISE NOTICE 'PASS T4 active/completed no se editan';
END $$;

-- T5. Un distribuidor no edita la ruta de otro; el admin sí.
DO $$
DECLARE v_route bigint; v_store bigint; v_denied boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990001'), true);
  SET LOCAL ROLE authenticated;
  v_route := public.create_route(990002, DATE '2026-11-19',
                                 '[{"store_id":990002,"stop_order":1}]'::jsonb);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.update_route_stops(v_route,
                                      '[{"store_id":990002,"stop_order":1}]'::jsonb);
  EXCEPTION WHEN raise_exception THEN v_denied := true;
  END;
  RESET ROLE;
  ASSERT v_denied, 'T5: el distribuidor 990001 editó la ruta del 990002';

  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990001'), true);
  SET LOCAL ROLE authenticated;
  PERFORM public.update_route_stops(v_route,
                                    '[{"store_id":990002,"stop_order":1}]'::jsonb);
  RESET ROLE;
  SELECT store_id INTO v_store FROM public.route_stops WHERE route_id = v_route;
  ASSERT v_store = 990002, 'T5: el admin no pudo editar la ruta';
  RAISE NOTICE 'PASS T5 alcance de edición';
END $$;

ROLLBACK;
