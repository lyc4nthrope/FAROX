-- ============================================================================
-- Prueba 0056: el distribuidor inicia y termina su ruta; las paradas exigen
-- tienda vinculada; una ruta completada no se replanifica.
-- Correr con scripts/db-test.sh. Todo se revierte.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;
\ir _fixtures.sql

-- La tienda 990002 está vinculada a OTRO distribuidor (990002): el vínculo
-- tiene que ser con el distribuidor de la ruta, no con cualquiera.
INSERT INTO public.store_distributors (store_id, distributor_id, created_by)
VALUES (990002, 990002, '00000000-0000-0000-0000-000000990005');

-- Ruta ajena (distribuidor 990002) para probar el alcance.
INSERT INTO public.routes (id, distributor_id, route_date) OVERRIDING SYSTEM VALUE
VALUES (990002, 990002, DATE '2026-11-16');

-- T1. El distribuidor arma su ruta con su tienda vinculada, la inicia y la termina.
DO $$
DECLARE v_route bigint; v_status text;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  v_route := public.save_route(990001, DATE '2026-11-16',
                               '[{"store_id":990001,"stop_order":1}]'::jsonb);
  PERFORM public.update_route_status(v_route, 'active');
  PERFORM public.update_route_status(v_route, 'completed');
  RESET ROLE;
  SELECT status INTO v_status FROM public.routes WHERE id = v_route;
  ASSERT v_status = 'completed', format('T1: estado final %s', v_status);
  RAISE NOTICE 'PASS T1 el distribuidor inicia y termina su ruta';
END $$;

-- T2. Una ruta completada no se replanifica: las paradas quedan intactas.
DO $$
DECLARE v_msg text; v_stops int;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990001'), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.save_route(990001, DATE '2026-11-16', '[]'::jsonb);
  EXCEPTION WHEN raise_exception THEN v_msg := SQLERRM;
  END;
  RESET ROLE;
  SELECT count(*) INTO v_stops FROM public.route_stops rs
  JOIN public.routes r ON r.id = rs.route_id
  WHERE r.distributor_id = 990001 AND r.route_date = DATE '2026-11-16';
  ASSERT v_msg LIKE '%completada%', format('T2: mensaje inesperado: %s', v_msg);
  ASSERT v_stops = 1, format('T2: quedaron %s paradas (esperado 1)', v_stops);
  RAISE NOTICE 'PASS T2 ruta completada protegida';
END $$;

-- T3. Ni el distribuidor ni el admin agregan como parada una tienda no vinculada.
DO $$
DECLARE u uuid; v_msg text;
BEGIN
  FOREACH u IN ARRAY ARRAY['00000000-0000-0000-0000-000000990003',
                           '00000000-0000-0000-0000-000000990001']::uuid[] LOOP
    v_msg := NULL;
    PERFORM set_config('request.jwt.claims', pg_temp.claims(u), true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.save_route(990001, DATE '2026-11-17',
                                '[{"store_id":990002,"stop_order":1}]'::jsonb);
    EXCEPTION WHEN raise_exception THEN v_msg := SQLERRM;
    END;
    RESET ROLE;
    ASSERT v_msg LIKE '%no está vinculada%', format('T3: %s pudo agregar una tienda ajena (%s)', u, v_msg);
  END LOOP;
  ASSERT NOT EXISTS (SELECT 1 FROM public.routes
                     WHERE distributor_id = 990001 AND route_date = DATE '2026-11-17'),
         'T3: quedó una ruta creada a medias';
  RAISE NOTICE 'PASS T3 parada en tienda no vinculada rechazada';
END $$;

-- T4. El distribuidor no inicia rutas ajenas ni cancela.
DO $$
DECLARE v_other boolean := false; v_cancel boolean := false; v_route bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.claims('00000000-0000-0000-0000-000000990003'), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.update_route_status(990002, 'active');
  EXCEPTION WHEN raise_exception THEN v_other := true;
  END;
  v_route := public.save_route(990001, DATE '2026-11-18',
                               '[{"store_id":990001,"stop_order":1}]'::jsonb);
  BEGIN
    PERFORM public.update_route_status(v_route, 'cancelled');
  EXCEPTION WHEN raise_exception THEN v_cancel := true;
  END;
  RESET ROLE;
  ASSERT v_other, 'T4: el distribuidor inició una ruta ajena';
  ASSERT v_cancel, 'T4: el distribuidor canceló su ruta (solo admin)';
  RAISE NOTICE 'PASS T4 alcance del distribuidor intacto';
END $$;

ROLLBACK;
