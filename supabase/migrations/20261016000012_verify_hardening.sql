-- ============================================================================
-- FAROX — Sprint 1 hardening, batch 4/4: VERIFY (0012)
-- Spec: sdd/sprint1-hardening — R18 (verificación) + tests negativos R1-R6/R11
-- Design: D-8 (H1-H4) + correcciones de reviews:
--   · review batch1 #445 (1): received_quantity > quantity ⇒ el CHECK de
--     order_items (0002) revienta ANTES del guard custom de confirm_delivery
--     ⇒ se assertea check_violation (23514), NO el mensaje 'excede la
--     cantidad pedida' (inalcanzable).
--   · review batch2 #447 (3): 'primer infractor' LIMIT 1 sin ORDER BY no
--     determinista ⇒ todo LIMIT de este archivo lleva ORDER BY.
--   · review batch3 #449 (9): la política elegida (D-5) es que service_role
--     CONSERVA EXECUTE (whitelist 31 + default privileges; integración n8n)
--     ⇒ H1 assertea la política ELEGIDA: service_role MAY tener EXECUTE y se
--     documenta en el output; el deny-list chequea anon Y authenticated.
--
-- QUÉ HACE: script de DIAGNÓSTICO/VERIFICACIÓN — NO modifica nada del esquema
-- ni de los datos. Extiende el patrón de 0008 con:
--   · V5 con has_function_privilege / has_table_privilege (R18): esas
--     funciones SÍ resuelven el grant a PUBLIC (oid 0). Contexto histórico:
--     el V5 pre-3444c18 de 0008 (aclexplode + join pg_roles) daba falso OK
--     (aclexplode devuelve grantee=0 para PUBLIC y el join lo descartaba);
--     el 3444c18 CORRIGIÓ el V5 de 0008 (LEFT JOIN + COALESCE(acldefault) +
--     detección de grantee=0) — hoy 0012 re-verifica lo mismo por vía
--     independiente, en pie de igualdad con el 0008 corregido.
--   · H1: grants estáticos (anon=0 exec · deny-list internal_*/job_scan_*/
--     assert_admin/triggers para anon+authenticated · whitelist post-lockdown
--     · PostGIS · tablas: anon sin DML · audit_log append-only).
--   · H2: las 31 firmas de la whitelist (0011) con EXECUTE para
--     authenticated (y service_role, política D-5).
--   · H3: tests negativos RPC por batch con SET ROLE + fixtures propias
--     (anon→update_user_role 42501 · operador→set_user_premium 'solo admin' ·
--     admin inactivo→update_user_role 'solo admin' · doble confirm ·
--     confirm sobre cancelled · received>quantity ⇒ 23514 (check del CHECK,
--     review batch1 #1) · p_items duplicado (0010) · register_entry pedido
--     de otra tienda / fuera de alcance · create_order duplicado ·
--     get_dashboard >366d · helpers ejecutables desde policies RLS).
--   · H4: re-run barato V1/V3 (FKs inválidas, RLS 25 tablas, 0 policies TO
--     anon) + stores_geo consultable como authenticated (re-grant PostGIS).
--
-- CÓMO SE LEE LA SALIDA: cada check emite RAISE NOTICE/WARNING con etiqueta
-- '0012 <sección> <id> [OK|FAIL|WARNING|SKIP] — detalle' y acumula fila en la
-- temp table _v0012_results. Al FINAL: conteo por veredicto + SELECT de todas
-- las filas. FAIL = investigar antes de dar por bueno el hardening.
--
-- APLICACIÓN (convención #444): pegar EL ARCHIVO COMPLETO en el SQL editor de
-- Supabase (corre como postgres). Requiere 0009+0010+0011 ya aplicados (misma
-- ventana de mantenimiento, nota ALTO D-3); si falta alguno, los checks
-- dependientes se SKIPean con NOTICE (degradación elegante, R19.2).
--
-- FIXTURES (requirement H4 del batch): los tests negativos crean sus propios
-- fixtures (3 usuarios vía auth.users, 2 tiendas, 1 distribuidor, 1 producto,
-- 3 pedidos, 1 crédito) DENTRO del bloque DO de H3 — UN statement ⇒ atómico.
-- Cada test vive en sub-bloque BEGIN/EXCEPTION (savepoint). Al final del
-- bloque, cleanup explícito en orden inverso de FK + assert de cero residuo
-- (H3.14). Un error NO capturado revierte el statement completo (y en el
-- editor, la transacción implícita multi-statement del paste) ⇒ cero residuo
-- por construcción. El script sólo crea objetos TEMP (session-scoped).
--
-- SMOKE MANUAL §7.11 (post-aplicación real, no automatizable acá — ver
-- checklist al final del archivo y 0008 §final).
-- R19.1: este archivo NO corrige V5 en 0008 (append-only). Sólo se edita
-- 0008 si el pre-flight 0.2 determinó que NUNCA fue aplicada a la DB real.
--
-- SIN BLOQUE INVERSE: un script de verificación no cambia nada que reversar
-- (sólo objetos TEMP de sesión + fixtures autoeliminados en H3) — el bloque
-- INVERSE no aplica por definición; se documenta explícitamente por convención.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Acumulador de resultados (temp, session-scoped; ON COMMIT DROP para no
-- dejar nada si el editor corre el paste en transacción implícita).
-- Re-runnable en la misma sesión: IF NOT EXISTS + DELETE al inicio.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS _v0012_results (
  seq      bigserial,
  seccion  text NOT NULL,
  check_id text NOT NULL,
  verdict  text NOT NULL,   -- OK | FAIL | WARNING | SKIP
  detalle  text
) ON COMMIT DROP;
DELETE FROM _v0012_results;

-- Helper de registro + output visible (NOTICE para OK/SKIP/INFO, WARNING
-- para FAIL). SIEMPRE invocarse con el rol normal (postgres) — los tests con
-- SET ROLE hacen RESET antes de registrar.
CREATE OR REPLACE FUNCTION pg_temp.v0012_rec(
  p_sec text, p_id text, p_verdict text, p_detalle text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO _v0012_results(seccion, check_id, verdict, detalle)
  VALUES (p_sec, p_id, p_verdict, p_detalle);
  IF p_verdict = 'FAIL' THEN
    RAISE WARNING '0012 % % [FAIL] — %', p_sec, p_id, COALESCE(p_detalle, '');
  ELSIF p_verdict = 'SKIP' THEN
    RAISE NOTICE '0012 % % [SKIP] — %', p_sec, p_id, COALESCE(p_detalle, '');
  ELSE
    RAISE NOTICE '0012 % % [%] — %', p_sec, p_id, p_verdict, COALESCE(p_detalle, '');
  END IF;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- H0 — Ambiente: roles Supabase, detección de lotes aplicados, seeds clave
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(r, ', ' ORDER BY r) INTO v_missing
  FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS t(r)
  WHERE pg_catalog.to_regrole(t.r) IS NULL;
  IF v_missing IS NULL THEN
    PERFORM pg_temp.v0012_rec('H0', 'H0.1', 'OK', 'roles presentes: anon, authenticated, service_role');
  ELSE
    PERFORM pg_temp.v0012_rec('H0', 'H0.1', 'FAIL', 'roles Supabase ausentes: ' || v_missing);
  END IF;
END $$;

DO $$
DECLARE
  v_9  boolean := false;
  v_10 boolean := false;
  v_11 boolean := false;
  v_det text;
BEGIN
  -- 0009: register_entry con el guard D-6 ('pertenece a la tienda')
  SELECT COALESCE(p.prosrc LIKE '%pertenece a la tienda%', false) INTO v_9
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'register_entry';
  -- 0010: dedup de p_items en confirm_delivery
  SELECT COALESCE(p.prosrc LIKE '%producto repetido en items%', false) INTO v_10
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'confirm_delivery';
  -- 0011: assert_admin() existe
  v_11 := pg_catalog.to_regprocedure('public.assert_admin()') IS NOT NULL;
  v_det := format('0009: %s · 0010: %s · 0011: %s', v_9, v_10, v_11);
  IF v_9 AND v_10 AND v_11 THEN
    PERFORM pg_temp.v0012_rec('H0', 'H0.2', 'OK', 'lotes aplicados detectados — ' || v_det);
  ELSE
    PERFORM pg_temp.v0012_rec('H0', 'H0.2', 'WARNING',
      v_det || ' — falta(ron) lote(s): los checks dependientes se SKIPean (aplicar 0009→0011 en ventana única, D-3)');
  END IF;
END $$;

DO $$
DECLARE
  v_ok  boolean := true;
  v_det text := '';
  n     integer;
BEGIN
  IF pg_catalog.to_regclass('public.roles') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H0', 'H0.3', 'SKIP', 'tabla roles ausente (0002/0005 no aplicadas)');
    RETURN;
  END IF;
  -- Seeds que los fixtures y las RPC de negocio asumen (0005)
  SELECT count(*) INTO n FROM public.roles WHERE name = 'admin';
  IF n <> 1 THEN v_ok := false; v_det := v_det || format('roles.admin=%s; ', n); END IF;
  SELECT count(*) INTO n FROM public.roles WHERE name = 'operador';
  IF n <> 1 THEN v_ok := false; v_det := v_det || format('roles.operador=%s; ', n); END IF;
  SELECT count(*) INTO n FROM public.store_types;
  IF n < 1 THEN v_ok := false; v_det := v_det || format('store_types=%s; ', n); END IF;
  SELECT count(*) INTO n FROM public.product_categories;
  IF n < 1 THEN v_ok := false; v_det := v_det || format('product_categories=%s; ', n); END IF;
  SELECT count(*) INTO n FROM public.brands;
  IF n < 1 THEN v_ok := false; v_det := v_det || format('brands=%s; ', n); END IF;
  SELECT count(*) INTO n FROM public.unit_types;
  IF n < 1 THEN v_ok := false; v_det := v_det || format('unit_types=%s; ', n); END IF;
  -- confirm_delivery busca este nombre EXACTO (0004/0010)
  SELECT count(*) INTO n FROM public.motives WHERE name = 'reabastecimiento';
  IF n <> 1 THEN v_ok := false; v_det := v_det || format('motives.reabastecimiento=%s; ', n); END IF;
  IF v_ok THEN
    PERFORM pg_temp.v0012_rec('H0', 'H0.3', 'OK', 'seeds 0005 completos (roles, catálogos, motivo reabastecimiento)');
  ELSE
    PERFORM pg_temp.v0012_rec('H0', 'H0.3', 'WARNING', 'seeds incompletos: ' || v_det || '— los fixtures de H3 se SKIPean');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- H1 — Grants estáticos (R14/R17) con has_function_privilege/has_table_privilege
-- (sí resuelven el grant a PUBLIC/oid 0. Histórico: el V5 pre-3444c18 de 0008
-- daba falso OK vía aclexplode+pg_roles; el 0008 actual ya lo detecta — este
-- H1 re-verifica lo mismo por vía independiente, en pie de igualdad).
-- Gate: si 0011 no está aplicada, los checks de lockdown se SKIPean.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n bigint; v_det text;
BEGIN
  IF pg_catalog.to_regrole('anon') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.1', 'SKIP', 'rol anon ausente');
    RETURN;
  END IF;
  IF pg_catalog.to_regprocedure('public.assert_admin()') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.1', 'SKIP', '0011 no aplicada (falta public.assert_admin) — lockdown no evaluable todavía');
    RETURN;
  END IF;
  -- Scan dinámico sobre TODO lo ejecutable en public para anon. Incluye
  -- funciones PostGIS y las heredadas vía PUBLIC — el sweep de 0011 (D-5)
  -- debe dejar exactamente CERO.
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_n = 0 THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.1', 'OK', 'anon: 0 funciones ejecutables en public (scan completo, grants PUBLIC incluidos)');
  ELSE
    SELECT string_agg(x.fn, ', ' ORDER BY x.fn) INTO v_det
    FROM (
      SELECT p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' AS fn
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      ORDER BY 1
      LIMIT 40
    ) x;
    PERFORM pg_temp.v0012_rec('H1', 'H1.1', 'FAIL',
      format('anon PUEDE ejecutar %s función(s) en public: %s%s', v_n, v_det, CASE WHEN v_n > 40 THEN ' …' ELSE '' END));
  END IF;
END $$;

DO $$
DECLARE
  r          record;
  v_anon_bad text := '';
  v_auth_bad text := '';
  v_sr       text := '';
  v_abs      text := '';
  v_n        integer := 0;
BEGIN
  IF pg_catalog.to_regprocedure('public.assert_admin()') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.2', 'SKIP', '0011 no aplicada — deny-list no evaluable todavía');
    RETURN;
  END IF;
  IF pg_catalog.to_regrole('anon') IS NULL OR pg_catalog.to_regrole('authenticated') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.2', 'SKIP', 'roles anon/authenticated ausentes');
    RETURN;
  END IF;
  -- Deny-list D-5: internal_* (5) + job_scan_* (3) + assert_admin + las 8
  -- trigger functions = 17. Se chequea anon Y authenticated; service_role NO
  -- se assertea acá (política elegida D-5/review #449: CONSERVA EXECUTE — se
  -- documenta en el output).
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'internal\_%'
           OR p.proname LIKE 'job\_scan\_%'
           OR p.proname = 'assert_admin'
           OR p.proname IN ('touch_updated_at', 'audit_diff', 'prevent_price_update',
                            'sanitize_distributor_scope', 'handle_new_user', 'sync_email',
                            'enforce_store_cap', 'touch_conversation_updated_at'))
    ORDER BY p.proname
  LOOP
    v_n := v_n + 1;
    IF pg_catalog.has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      v_anon_bad := v_anon_bad || r.proname || ', ';
    END IF;
    IF pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      v_auth_bad := v_auth_bad || r.proname || ', ';
    END IF;
    IF pg_catalog.to_regrole('service_role') IS NOT NULL
       AND pg_catalog.has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      v_sr := v_sr || r.proname || ', ';
    END IF;
  END LOOP;
  IF v_n <> 17 THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.2', 'WARNING',
      format('deny-list: %s funciones encontradas (esperadas 17) — nombres ausentes o de más; revisar detalle del scan', v_n));
  END IF;
  IF v_anon_bad <> '' OR v_auth_bad <> '' THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.2', 'FAIL',
      format('deny-list con EXECUTE — anon: [%s] · authenticated: [%s]', v_anon_bad, v_auth_bad));
  ELSIF v_n = 17 THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.2', 'OK',
      'deny-list (17): internal_*/job_scan_*/assert_admin/triggers sin EXECUTE para anon y authenticated. service_role (política elegida D-5, MAY): ' ||
      CASE WHEN v_sr = '' THEN 'NINGUNA (sin EXECUTE)' ELSE v_sr END);
  END IF;
END $$;

DO $$
DECLARE
  v_n       bigint;
  v_extra   text := '';
  v_falt    text := '';
  v_det     text;
  -- Los 34 pronames que authenticated DEBE poder ejecutar en public:
  -- whitelist 31 de 0011 (26 RPC + 5 helpers) + los 3 PostGIS re-granteados.
  v_expected constant text[] := ARRAY[
    'my_role', 'is_premium', 'my_store_ids', 'my_distributor_id', 'has_scope',
    'update_user_role', 'set_user_premium', 'set_user_active', 'assign_user_stores',
    'create_store', 'assign_product_to_store', 'set_price', 'register_entry',
    'register_exit', 'register_reverse', 'create_order', 'update_order_status',
    'confirm_delivery', 'get_order_items', 'save_route', 'mark_stop',
    'update_route_status', 'create_credit', 'cancel_credit', 'register_payment',
    'register_payment_reverse', 'mark_alert_read', 'get_stock', 'get_dashboard',
    'create_chat', 'send_message', 'st_x', 'st_y', 'geometry'];
BEGIN
  IF pg_catalog.to_regprocedure('public.assert_admin()') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.3', 'SKIP', '0011 no aplicada — conjunto ejecutable post-lockdown no evaluable todavía');
    RETURN;
  END IF;
  IF pg_catalog.to_regrole('authenticated') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.3', 'SKIP', 'rol authenticated ausente');
    RETURN;
  END IF;
  -- Deny-by-default efectivo: authenticated ejecuta EXACTAMENTE los 34 de la
  -- whitelist. Cualquier extra = grant huérfano (o PUBLIC resucitado); cualquier
  -- faltante = roto (lo cubre H2.1, acá se ve el total).
  SELECT count(*) INTO v_n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE');
  SELECT string_agg(x.fn, ', ' ORDER BY x.fn) INTO v_extra
  FROM (
    SELECT DISTINCT p.proname AS fn
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.proname <> ALL (v_expected)
  ) x;
  SELECT string_agg(e, ', ' ORDER BY e) INTO v_falt
  FROM unnest(v_expected) AS e
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = e
      AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_n = 34 AND v_extra IS NULL AND v_falt IS NULL THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.3', 'OK', 'authenticated ejecuta exactamente los 34 esperados (whitelist 31 + PostGIS 3); sin extras ni faltantes');
  ELSE
    v_det := format('ejecutables=%s (esperados 34)', v_n)
             || COALESCE(' · extras: ' || v_extra, '')
             || COALESCE(' · faltantes: ' || v_falt, '');
    PERFORM pg_temp.v0012_rec('H1', 'H1.3', 'FAIL', v_det);
  END IF;
END $$;

DO $$
DECLARE v_det text := ''; v_ok boolean := true;
BEGIN
  IF pg_catalog.to_regrole('authenticated') IS NULL OR pg_catalog.to_regrole('anon') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.4', 'SKIP', 'roles authenticated/anon ausentes');
    RETURN;
  END IF;
  BEGIN
    -- stores_geo (security_invoker) ejecuta estos 3 como CLIENTE: sin el
    -- re-grant de 0011 (D-5 paso 4) la vista revienta para authenticated.
    IF NOT pg_catalog.has_function_privilege('authenticated', 'public.st_x(public.geometry)', 'EXECUTE') THEN
      v_ok := false; v_det := v_det || 'st_x sin EXECUTE para authenticated; ';
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', 'public.st_y(public.geometry)', 'EXECUTE') THEN
      v_ok := false; v_det := v_det || 'st_y sin EXECUTE para authenticated; ';
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', 'public.geometry(public.geography)', 'EXECUTE') THEN
      v_ok := false; v_det := v_det || 'geometry(geography) sin EXECUTE para authenticated; ';
    END IF;
    IF pg_catalog.has_function_privilege('anon', 'public.st_x(public.geometry)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', 'public.st_y(public.geometry)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', 'public.geometry(public.geography)', 'EXECUTE') THEN
      v_ok := false; v_det := v_det || 'anon CON EXECUTE PostGIS; ';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Firma real distinta (open question D-5 / pre-check de 0011): no es FAIL
    -- del lockdown, es catálogo divergente — revisar con el SELECT pre-check.
    PERFORM pg_temp.v0012_rec('H1', 'H1.4', 'SKIP',
      'firma PostGIS no coincide con public.st_x(public.geometry)/st_y/geometry(geography): ' || SQLERRM ||
      ' — correr el pre-check de 0011 (SELECT sobre pg_proc) y ajustar grants');
    RETURN;
  END;
  IF v_ok THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.4', 'OK', 'PostGIS: st_x/st_y/geometry(geography) con EXECUTE para authenticated; sin EXECUTE para anon');
  ELSE
    PERFORM pg_temp.v0012_rec('H1', 'H1.4', 'FAIL', v_det);
  END IF;
END $$;

DO $$
DECLARE
  t        text;
  v_bad    text := '';
  v_aus    text := '';
  v_seqbad text := '';
  v_tables constant text[] := ARRAY[
    'roles', 'unit_types', 'store_types', 'brands', 'product_categories',
    'users', 'products', 'stores', 'price_publications', 'orders', 'order_items',
    'distributors', 'motives', 'stock', 'routes', 'route_stops', 'movements',
    'credits', 'credit_payments', 'alerts', 'user_stores', 'chat_conversations',
    'chat_messages', 'dashboard_daily', 'audit_log'];
BEGIN
  IF pg_catalog.to_regrole('anon') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.5', 'SKIP', 'rol anon ausente');
    RETURN;
  END IF;
  FOREACH t IN ARRAY v_tables LOOP
    IF pg_catalog.to_regclass('public.' || t) IS NULL THEN
      v_aus := v_aus || t || ', ';
      CONTINUE;
    END IF;
    IF pg_catalog.has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR pg_catalog.has_table_privilege('anon', 'public.' || t, 'UPDATE')
       OR pg_catalog.has_table_privilege('anon', 'public.' || t, 'DELETE') THEN
      v_bad := v_bad || t || ', ';
    END IF;
  END LOOP;
  -- R17.1 también cubre sequences (serial/identity)
  SELECT string_agg(s.sequencename, ', ' ORDER BY s.sequencename) INTO v_seqbad
  FROM pg_catalog.pg_sequences s
  WHERE s.schemaname = 'public'
    AND pg_catalog.has_sequence_privilege('anon', format('%I.%I', s.schemaname, s.sequencename)::regclass, 'USAGE');
  IF v_bad = '' AND v_aus = '' AND v_seqbad IS NULL THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.5', 'OK', 'anon sin SELECT/INSERT/UPDATE/DELETE en las 25 tablas y sin USAGE en sequences de public');
  ELSE
    PERFORM pg_temp.v0012_rec('H1', 'H1.5', 'FAIL',
      format('anon CON privilegios sobre tablas: [%s] sequences: [%s] — tablas ausentes (informativo): [%s]',
             v_bad, COALESCE(v_seqbad, ''), v_aus));
  END IF;
END $$;

DO $$
BEGIN
  IF pg_catalog.to_regrole('service_role') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.6', 'SKIP', 'rol service_role ausente');
    RETURN;
  END IF;
  IF pg_catalog.to_regclass('public.audit_log') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.6', 'SKIP', 'tabla audit_log ausente (0003 no aplicada)');
    RETURN;
  END IF;
  -- R17.2 / 0011 L539: service_role pierde UPDATE/DELETE (append-only);
  -- conserva SELECT (audit_read) e INSERT (eventos de integración n8n).
  IF pg_catalog.has_table_privilege('service_role', 'public.audit_log', 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.audit_log', 'DELETE') THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.6', 'FAIL',
      format('service_role en audit_log: UPDATE=%s DELETE=%s (esperado false/false; política append-only 0011)',
             pg_catalog.has_table_privilege('service_role', 'public.audit_log', 'UPDATE'),
             pg_catalog.has_table_privilege('service_role', 'public.audit_log', 'DELETE')));
  ELSIF NOT pg_catalog.has_table_privilege('service_role', 'public.audit_log', 'SELECT')
        OR NOT pg_catalog.has_table_privilege('service_role', 'public.audit_log', 'INSERT') THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.6', 'WARNING',
      'service_role perdió SELECT/INSERT en audit_log (política 0011: conservarlos — revisar si el sweep fue más allá)');
  ELSE
    PERFORM pg_temp.v0012_rec('H1', 'H1.6', 'OK',
      'audit_log append-only: service_role sin UPDATE/DELETE; con SELECT/INSERT (política elegida 0011/D-5)');
  END IF;
END $$;

-- R17.2 runtime: el privilegio negado revienta ANTES de tocar filas (WHERE
-- false no lo esquiva) — confirma el estático H1.6 con un intento real.
DO $$
DECLARE v_upd text; v_del text; v_sel text := '';
BEGIN
  IF pg_catalog.to_regrole('service_role') IS NULL
     OR pg_catalog.to_regclass('public.audit_log') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.7', 'SKIP', 'service_role o audit_log ausente');
    RETURN;
  END IF;
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.audit_log SET diff = diff WHERE false;
    v_upd := 'SIN DENEGACIÓN (error)';
  EXCEPTION WHEN insufficient_privilege THEN
    v_upd := 'denegado (42501)';
  END;
  BEGIN
    DELETE FROM public.audit_log WHERE false;
    v_del := 'SIN DENEGACIÓN (error)';
  EXCEPTION WHEN insufficient_privilege THEN
    v_del := 'denegado (42501)';
  END;
  BEGIN
    PERFORM count(*) FROM public.audit_log;
    v_sel := 'SELECT OK';
  EXCEPTION WHEN OTHERS THEN
    v_sel := 'SELECT falló: ' || SQLERRM;
  END;
  RESET ROLE;
  IF v_upd = 'denegado (42501)' AND v_del = 'denegado (42501)' AND v_sel = 'SELECT OK' THEN
    PERFORM pg_temp.v0012_rec('H1', 'H1.7', 'OK',
      'runtime service_role sobre audit_log: UPDATE ' || v_upd || ' · DELETE ' || v_del || ' · ' || v_sel);
  ELSE
    PERFORM pg_temp.v0012_rec('H1', 'H1.7', 'FAIL',
      'runtime service_role sobre audit_log: UPDATE ' || v_upd || ' · DELETE ' || v_del || ' · ' || v_sel);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- H2 — Las 31 firmas exactas de la whitelist (0011 L465-497) con EXECUTE para
-- authenticated (H2.1) y service_role (H2.2, política elegida D-5: la
-- conserva para la integración n8n). H1.3 ya cubre el conjunto TOTAL por
-- proname; H2 afirma firma-por-firma (un cambio de argumentos se ve acá aunque
-- el nombre siga igual). Lookup en DOS pasos por firma:
--   1) to_regprocedure con la firma EXACTA (typmods incluidos, tal cual 0011).
--   2) si no resuelve, firma con typmods stripped — una diferencia de
--      rendering del catálogo no debe dar falso FAIL; un cambio REAL de
--      argumentos falla ambos pasos ⇒ ausente ⇒ FAIL.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sigs constant text[] := ARRAY[
    'public.my_role()',
    'public.is_premium()',
    'public.my_store_ids()',
    'public.my_distributor_id()',
    'public.has_scope()',
    'public.update_user_role(uuid, text, bigint)',
    'public.set_user_premium(uuid, boolean)',
    'public.set_user_active(uuid, boolean)',
    'public.assign_user_stores(uuid, bigint[])',
    'public.create_store(text, integer, text, text, text, public.geography(Point,4326), text, char(2))',
    'public.assign_product_to_store(bigint, bigint, numeric(12,3))',
    'public.set_price(bigint, bigint, numeric(12,2), char(3))',
    'public.register_entry(bigint, bigint, numeric(12,3), bigint, bigint, date)',
    'public.register_exit(bigint, bigint, numeric(12,3), bigint, bigint)',
    'public.register_reverse(bigint, text)',
    'public.create_order(bigint, bigint, jsonb, timestamptz, text)',
    'public.update_order_status(bigint, public.order_status, text)',
    'public.confirm_delivery(bigint, jsonb)',
    'public.get_order_items(bigint)',
    'public.save_route(bigint, date, jsonb)',
    'public.mark_stop(bigint, public.stop_status, timestamptz)',
    'public.update_route_status(bigint, public.route_status)',
    'public.create_credit(bigint, date)',
    'public.cancel_credit(bigint, text)',
    'public.register_payment(bigint, numeric(14,2), public.payment_method)',
    'public.register_payment_reverse(bigint, text)',
    'public.mark_alert_read(bigint)',
    'public.get_stock(bigint, integer)',
    'public.get_dashboard(date, date)',
    'public.create_chat(text)',
    'public.send_message(bigint, text)'
  ];
  sig            text;
  v_oid          oid;
  v_inner        text;
  v_absent       text := '';
  v_noauth       text := '';
  v_nosr         text := '';
  v_fallback_use integer := 0;
BEGIN
  IF pg_catalog.to_regprocedure('public.assert_admin()') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H2', 'H2.1', 'SKIP', '0011 no aplicada — whitelist no evaluable todavía');
    RETURN;
  END IF;
  IF pg_catalog.to_regrole('authenticated') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H2', 'H2.1', 'SKIP', 'rol authenticated ausente');
    RETURN;
  END IF;
  FOREACH sig IN ARRAY v_sigs LOOP
    v_oid := pg_catalog.to_regprocedure(sig);
    IF v_oid IS NULL THEN
      -- paso 2: quitar typmods de la lista de args — numeric(12,3) → numeric,
      -- char(2) → char (bpchar), geography(Point,4326) → geography
      v_inner := substring(sig from position('(' in sig) + 1
                           for length(sig) - position('(' in sig) - 1);
      v_oid := pg_catalog.to_regprocedure(
                 substring(sig from 1 for position('(' in sig))
                 || regexp_replace(v_inner, '\([^)]*\)', '', 'g') || ')');
      IF v_oid IS NOT NULL THEN v_fallback_use := v_fallback_use + 1; END IF;
    END IF;
    IF v_oid IS NULL THEN
      v_absent := v_absent || sig || '; ';
      CONTINUE;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_noauth := v_noauth || sig || '; ';
    END IF;
    IF pg_catalog.to_regrole('service_role') IS NOT NULL
       AND NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      v_nosr := v_nosr || sig || '; ';
    END IF;
  END LOOP;
  IF v_absent <> '' THEN
    PERFORM pg_temp.v0012_rec('H2', 'H2.1', 'FAIL',
      format('firmas ausentes del catálogo (ni exactas ni stripped; ¿0011 a medias?): %s', v_absent));
  ELSIF v_noauth <> '' THEN
    PERFORM pg_temp.v0012_rec('H2', 'H2.1', 'FAIL',
      format('whitelist con firmas sin EXECUTE para authenticated: %s', v_noauth));
  ELSE
    PERFORM pg_temp.v0012_rec('H2', 'H2.1', 'OK',
      format('31/31 firmas con EXECUTE para authenticated (%s resueltas vía fallback sin typmods)',
             v_fallback_use));
  END IF;
  IF v_absent <> '' THEN
    PERFORM pg_temp.v0012_rec('H2', 'H2.2', 'SKIP', 'firmas ausentes del catálogo — ver H2.1');
  ELSIF v_nosr <> '' THEN
    PERFORM pg_temp.v0012_rec('H2', 'H2.2', 'FAIL',
      format('service_role sin EXECUTE en firmas de la whitelist (política elegida D-5, integración n8n): %s', v_nosr));
  ELSE
    PERFORM pg_temp.v0012_rec('H2', 'H2.2', 'OK',
      '31/31 firmas con EXECUTE para service_role (política elegida D-5: la conserva para n8n)');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- H3 — Tests negativos RPC (R1-R6/R11) con SET ROLE + JWT claims + fixtures
-- propios. Un ÚNICO bloque DO ⇒ un solo statement ⇒ atómico: si algo revienta
-- sin capturar, la transacción implícita del editor revierte TODO (fixtures
-- incluidos) ⇒ cero residuo por construcción.
--
-- Mecánica anti-bypass (crítico): assert_admin() tiene el bypass
-- `session_user() = 'postgres' AND auth.uid() IS NULL`. Como el editor corre
-- con session_user = 'postgres', CADA test setea request.jwt.claims (sub del
-- usuario fixture) para que auth.uid() NO sea NULL y el guard evalúe de
-- verdad. SET LOCAL es transaccional: el sub-bloque BEGIN/EXCEPTION (savepoint)
-- lo revierte al capturar el error esperado, y el RESET ROLE / set_config NULL
-- posteriores cubren el camino de éxito. Después de cada test: RESET ROLE.
--
-- Tests (fixtures: 3 usuarios vía auth.users → trigger handle_new_user; 2
-- tiendas; 1 distribuidor; 1 producto; 3 pedidos; 1 crédito):
--   H3.1  anon → update_user_role ⇒ 42501 'permission denied for function'
--   H3.2  authenticated → job_scan_expiry_soon / internal_alert_open ⇒ 42501
--   H3.3  get_dashboard rango > 366d ⇒ 'excede el máximo de 366'
--   H3.0  fixtures creados (gate posterior a H3.1-H3.3)
--   H3.4  operador → set_user_premium ⇒ 'solo admin' (assert_admin, D-4)
--   H3.5  admin INACTIVO → update_user_role ⇒ 'solo admin' (is_active, D-3)
--   H3.6  doble confirm_delivery ⇒ 'no admite recepción' + estado "delivered"
--   H3.7  confirm sobre cancelled ⇒ 'no admite recepción' + "cancelled"
--   H3.8  received_quantity > quantity ⇒ CHECK 23514 (NO el mensaje custom:
--         guard inalcanzable — review batch1 #445-1)
--   H3.9  confirm_delivery con product_id repetido ⇒ 'producto repetido'
--   H3.10 create_order con product_id repetido ⇒ 'producto repetido' (0010)
--   H3.11 register_entry con pedido de OTRA tienda ⇒ 'pertenece a la tienda'
--   H3.12 register_entry tienda fuera de alcance ⇒ 'fuera del alcance'
--   H3.13 helpers ejecutables desde policies RLS (SELECT como authenticated:
--         orders_select/credits_select invocan my_role/my_store_ids; además se
--         assertea scope: ve su tienda, NO la ajena)
--   H3.14 cero residuo tras cleanup explícito en orden inverso de FK
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_u_adm     uuid := gen_random_uuid();
  v_u_op      uuid := gen_random_uuid();
  v_u_off     uuid := gen_random_uuid();  -- admin inactivo
  v_stores    bigint[];
  v_dist      bigint;
  v_prod      bigint;
  v_motive    bigint;
  v_o1        bigint;  -- tienda A, pending (H3.6/H3.8/H3.9)
  v_o2        bigint;  -- tienda A, cancelled (H3.7)
  v_o3        bigint;  -- tienda B, pending (H3.11)
  v_audit_max bigint;
  v_mov_max   bigint;
  v_alert_max bigint;
  v_has_9     boolean := false;
  v_has_10    boolean := false;
  v_has_11    boolean := false;
  v_has_366   boolean := false;
  v_state     text;
  v_errm      text;
  v_sqlstate  text;
  v_n         bigint;
  v_n1        bigint;
  v_n3        bigint;
BEGIN
  -- Detección de lotes (gates de H3.4-H3.13)
  SELECT COALESCE(bool_or(p.prosrc LIKE '%pertenece a la tienda%'), false) INTO v_has_9
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'register_entry';
  SELECT COALESCE(bool_or(p.prosrc LIKE '%producto repetido en items%'), false) INTO v_has_10
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('confirm_delivery', 'create_order');
  v_has_11 := pg_catalog.to_regprocedure('public.assert_admin()') IS NOT NULL;

  IF pg_catalog.to_regrole('authenticated') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.1', 'SKIP', 'rol authenticated ausente — todos los tests H3 SKIP');
    RETURN;
  END IF;

  -- ===== H3.1 — anon NO puede ejecutar update_user_role (42501) =====
  -- Gate 0011 (review #451 D2a): sin el REVOKE EXECUTE de 0011, anon aún
  -- tiene el grant PUBLIC (CRIT-1) y el test NO es evaluable con seguridad:
  -- el body DEFINER correría de verdad (session_user sigue siendo postgres).
  IF NOT v_has_11 THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.1', 'SKIP',
      '0011 no aplicada (falta public.assert_admin) — deny de anon no evaluable');
  ELSIF pg_catalog.to_regrole('anon') IS NULL
     OR pg_catalog.to_regprocedure('public.update_user_role(uuid, text, bigint)') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.1', 'SKIP', 'rol anon o update_user_role ausente');
  ELSE
    v_state := NULL; v_sqlstate := NULL; v_errm := NULL;
    SET LOCAL ROLE anon;
    BEGIN
      PERFORM public.update_user_role(v_u_op, 'operador');
      v_state := 'SIN DENEGACIÓN';
    EXCEPTION WHEN insufficient_privilege THEN
      v_state := 'denegado'; v_sqlstate := SQLSTATE; v_errm := SQLERRM;
    WHEN OTHERS THEN
      -- Regresión real (R14.1/R16.1): anon SÍ PUEDE ejecutar ⇒ el body corre
      -- como DEFINER y revienta adentro (p. ej. 'usuario inexistente', P0001,
      -- porque los fixtures recién se crean en H3.0). NUNCA sin capturar: un
      -- error no capturado mata el statement DO y con él H3.2-H4 + resumen
      -- (review #451 D2b). Captura raise_exception (P0001) y cualquier otro.
      v_state := 'EJECUTÓ'; v_sqlstate := SQLSTATE; v_errm := SQLERRM;
    END;
    RESET ROLE;
    IF v_state = 'denegado' AND v_sqlstate = '42501' AND v_errm LIKE '%permission denied for function%' THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.1', 'OK',
        'anon → update_user_role: 42501 permission denied for function (EXECUTE revocado, 0011)');
    ELSIF v_state = 'EJECUTÓ' THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.1', 'FAIL',
        format('anon EJECUTÓ el body (SQLSTATE % %) — el deny de 0011 no está activo',
               v_sqlstate, v_errm));
    ELSE
      PERFORM pg_temp.v0012_rec('H3', 'H3.1', 'FAIL',
        format('anon → update_user_role esperaba 42501; estado=%s sqlstate=%s errm=%s',
               v_state, v_sqlstate, v_errm));
    END IF;
  END IF;

  -- ===== H3.2 — deny-list runtime: authenticated sin EXECUTE sobre jobs e internal_* =====
  -- Gate 0011 (review #451 D3): sin el deny, ambas funciones corren DE VERDAD
  -- como authenticated — internal_alert_open (SECURITY DEFINER) INSERTA una
  -- alerta POR DEBAJO de v_alert_max (marca que se toma recién en H3.0) ⇒
  -- sobrevive al cleanup y rompe el contrato de cero residuo. Con 0011
  -- aplicado, el 42501 revienta ANTES del body ⇒ el test es seguro.
  IF NOT v_has_11 THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.2', 'SKIP',
      '0011 no aplicada (falta public.assert_admin) — deny de authenticated no evaluable');
  ELSIF pg_catalog.to_regprocedure('public.job_scan_expiry_soon()') IS NULL
     OR pg_catalog.to_regprocedure('public.internal_alert_open(public.alert_type, bigint, bigint, bigint, bigint, text, jsonb)') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.2', 'SKIP', 'job_scan_expiry_soon o internal_alert_open ausentes');
  ELSE
    v_state := ''; v_errm := NULL;
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.job_scan_expiry_soon();
      v_state := v_state || 'job_scan SIN denegación; ';
    EXCEPTION WHEN insufficient_privilege THEN
      v_state := v_state || 'job_scan 42501; ';
    END;
    BEGIN
      PERFORM public.internal_alert_open('stock_low'::public.alert_type, NULL::bigint, NULL::bigint,
                                         NULL::bigint, NULL::bigint, 'v0012');
      v_state := v_state || 'internal_alert SIN denegación';
    EXCEPTION WHEN insufficient_privilege THEN
      v_state := v_state || 'internal_alert 42501';
    END;
    RESET ROLE;
    IF v_state = 'job_scan 42501; internal_alert 42501' THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.2', 'OK',
        'authenticated → deny-list runtime denegada: job_scan_expiry_soon 42501 · internal_alert_open 42501');
    ELSE
      PERFORM pg_temp.v0012_rec('H3', 'H3.2', 'FAIL', 'deny-list runtime: ' || v_state);
    END IF;
  END IF;

  -- ===== H3.3 — get_dashboard rechaza rangos > 366 días (R11) =====
  IF pg_catalog.to_regprocedure('public.get_dashboard(date, date)') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.3', 'SKIP', 'get_dashboard ausente');
  ELSE
    -- Gate por contenido (review #451 D-nb1): el RAISE de 366 lo agrega 0010;
    -- sin ese lote get_dashboard (desde 0004) devuelve filas en vez de
    -- revientar ⇒ el test daría FAIL en modo degradado en vez de SKIP.
    SELECT COALESCE(bool_or(p.prosrc LIKE '%366%'), false) INTO v_has_366
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_dashboard';
    IF NOT v_has_366 THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.3', 'SKIP',
        'get_dashboard sin el raise de 366 días (0010 no aplicada) — guard no evaluable');
    ELSE
      v_state := NULL; v_errm := NULL;
      SET LOCAL ROLE authenticated;
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_u_op::text, 'role', 'authenticated')::text, true);
      BEGIN
        PERFORM count(*) FROM public.get_dashboard(CURRENT_DATE - 500, CURRENT_DATE);
        v_state := 'SIN DENEGACIÓN';
      EXCEPTION WHEN raise_exception THEN
        v_state := 'denegado'; v_errm := SQLERRM;
      END;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', NULL, true);
      IF v_state = 'denegado' AND v_errm LIKE '%excede el máximo de 366%' THEN
        PERFORM pg_temp.v0012_rec('H3', 'H3.3', 'OK',
          'get_dashboard(500 días) ⇒ ''rango de 500 días excede el máximo de 366'' (R11/AC 11.2)');
      ELSE
        PERFORM pg_temp.v0012_rec('H3', 'H3.3', 'FAIL',
          format('get_dashboard(500 días) esperaba RAISE de rango; estado=%s errm=%s', v_state, v_errm));
      END IF;
    END IF;
  END IF;

  -- ===== H3.0 — fixtures (gate de H3.4-H3.14) =====
  IF NOT v_has_11
     OR pg_catalog.to_regclass('public.stores') IS NULL
     OR pg_catalog.to_regclass('auth.users') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'auth' AND c.relname = 'users' AND t.tgname = 'on_auth_user_created')
     OR NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'operador')
     OR NOT EXISTS (SELECT 1 FROM public.motives WHERE name = 'reabastecimiento') THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.0', 'SKIP',
      'fixtures no creables (falta 0011, tablas, trigger de signup o seeds) — H3.4-H3.14 SKIP');
    PERFORM pg_temp.v0012_rec('H3', 'H3.4', 'SKIP', 'fixtures ausentes');
    PERFORM pg_temp.v0012_rec('H3', 'H3.5', 'SKIP', 'fixtures ausentes');
    PERFORM pg_temp.v0012_rec('H3', 'H3.6', 'SKIP', 'fixtures ausentes');
    PERFORM pg_temp.v0012_rec('H3', 'H3.7', 'SKIP', 'fixtures ausentes');
    PERFORM pg_temp.v0012_rec('H3', 'H3.8', 'SKIP', 'fixtures ausentes');
    PERFORM pg_temp.v0012_rec('H3', 'H3.9', 'SKIP', 'fixtures ausentes');
    PERFORM pg_temp.v0012_rec('H3', 'H3.10', 'SKIP', 'fixtures ausentes');
    PERFORM pg_temp.v0012_rec('H3', 'H3.11', 'SKIP', 'fixtures ausentes');
    PERFORM pg_temp.v0012_rec('H3', 'H3.12', 'SKIP', 'fixtures ausentes');
    PERFORM pg_temp.v0012_rec('H3', 'H3.13', 'SKIP', 'fixtures ausentes');
    PERFORM pg_temp.v0012_rec('H3', 'H3.14', 'SKIP', 'fixtures ausentes');
    RETURN;
  END IF;

  BEGIN
    -- Marcas para residuos tabulares (movimientos/alertas/audit); el cleanup
    -- borra TODO lo nuevo por encima de estas.
    SELECT COALESCE(max(id), 0) INTO v_audit_max FROM public.audit_log;
    SELECT COALESCE(max(id), 0) INTO v_mov_max   FROM public.movements;
    SELECT COALESCE(max(id), 0) INTO v_alert_max FROM public.alerts;

    -- 3 usuarios vía auth.users: el trigger on_auth_user_created (0004) crea
    -- la fila users con rol operador; después se promueven/inactivan.
    INSERT INTO auth.users
      (instance_id, id, aud, role, email, encrypted_password,
       raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
    VALUES
      ('00000000-0000-0000-0000-000000000000', v_u_adm, 'authenticated', 'authenticated',
       'v0012_adm@farox.test', 'v0012-dummy-hash',
       '{"provider":"email","providers":["email"]}', '{"full_name":"V0012 Admin"}',
       now(), now(), now()),
      ('00000000-0000-0000-0000-000000000000', v_u_op, 'authenticated', 'authenticated',
       'v0012_op@farox.test', 'v0012-dummy-hash',
       '{"provider":"email","providers":["email"]}', '{"full_name":"V0012 Operador"}',
       now(), now(), now()),
      ('00000000-0000-0000-0000-000000000000', v_u_off, 'authenticated', 'authenticated',
       'v0012_off@farox.test', 'v0012-dummy-hash',
       '{"provider":"email","providers":["email"]}', '{"full_name":"V0012 Admin Inactivo"}',
       now(), now(), now());

    UPDATE public.users SET role_id = (SELECT id FROM public.roles WHERE name = 'admin')
    WHERE id = v_u_adm;
    UPDATE public.users SET premium = true WHERE id = v_u_op;  -- H3.11/H3.12 requieren premium (D39)
    UPDATE public.users
    SET role_id = (SELECT id FROM public.roles WHERE name = 'admin'), is_active = false
    WHERE id = v_u_off;  -- H3.5: admin inactivo pierde el guard (D-3)

    INSERT INTO public.stores (store_type_id, name, address, city, country, location, created_by)
    SELECT st.id, x.name, x.address, 'Bogotá', 'CO',
           ST_SetSRID(ST_MakePoint(x.lng, x.lat), 4326)::public.geography, v_u_adm
    FROM (VALUES ('V0012 Tienda A', 'Calle 1 # 1-1', -74.0721, 4.7110, 1),
                 ('V0012 Tienda B', 'Calle 2 # 2-2', -74.0810, 4.7220, 2)) AS x(name, address, lng, lat, ord),
         LATERAL (SELECT id FROM public.store_types ORDER BY id LIMIT 1) st
    ORDER BY x.ord;

    SELECT array_agg(id ORDER BY name) INTO v_stores
    FROM public.stores WHERE name IN ('V0012 Tienda A', 'V0012 Tienda B');

    INSERT INTO public.distributors (name, nit, is_active)
    VALUES ('V0012 Distribuidor', 'V0012-NIT-0001', true)
    RETURNING id INTO v_dist;

    INSERT INTO public.products (name, category_id, brand_id, unit_type_id, created_by, base_quantity)
    SELECT 'V0012 Producto', c.id, b.id, u.id, v_u_adm, 1
    FROM LATERAL (SELECT id FROM public.product_categories ORDER BY id LIMIT 1) c,
         LATERAL (SELECT id FROM public.brands ORDER BY id LIMIT 1) b,
         LATERAL (SELECT id FROM public.unit_types ORDER BY id LIMIT 1) u
    RETURNING id INTO v_prod;

    INSERT INTO public.price_publications (product_id, store_id, created_by, price)
    VALUES (v_prod, v_stores[1], v_u_adm, 2500), (v_prod, v_stores[2], v_u_adm, 2600);

    INSERT INTO public.user_stores (user_id, store_id) VALUES (v_u_op, v_stores[1]);

    INSERT INTO public.orders (distributor_id, store_id, created_by, status, notes)
    VALUES (v_dist, v_stores[1], v_u_adm, 'pending', 'V0012-O1')
    RETURNING id INTO v_o1;
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_o1, v_prod, 5, 2500);

    INSERT INTO public.orders (distributor_id, store_id, created_by, status,
                               cancelled_at, cancelled_reason, notes)
    VALUES (v_dist, v_stores[1], v_u_adm, 'cancelled', now(), 'V0012 fixture', 'V0012-O2')
    RETURNING id INTO v_o2;

    INSERT INTO public.orders (distributor_id, store_id, created_by, status, notes)
    VALUES (v_dist, v_stores[2], v_u_adm, 'pending', 'V0012-O3')
    RETURNING id INTO v_o3;
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_o3, v_prod, 3, 2600);

    INSERT INTO public.credits (order_id, store_id, total_amount, balance, due_date, created_by)
    VALUES (v_o1, v_stores[1], 12500, 12500, CURRENT_DATE + 30, v_u_adm);

    SELECT id INTO v_motive FROM public.motives WHERE name = 'reabastecimiento';
  EXCEPTION WHEN OTHERS THEN
    -- Atómico: el savepoint revierte los fixtures parciales; el DO completa y
    -- el editor no ve error (se reporta como check).
    PERFORM pg_temp.v0012_rec('H3', 'H3.0', 'FAIL',
      format('fixtures revientan: %s — %s (H3.4-H3.14 SKIP)', SQLSTATE, SQLERRM));
    PERFORM pg_temp.v0012_rec('H3', 'H3.4', 'SKIP', 'fixtures fallaron');
    PERFORM pg_temp.v0012_rec('H3', 'H3.5', 'SKIP', 'fixtures fallaron');
    PERFORM pg_temp.v0012_rec('H3', 'H3.6', 'SKIP', 'fixtures fallaron');
    PERFORM pg_temp.v0012_rec('H3', 'H3.7', 'SKIP', 'fixtures fallaron');
    PERFORM pg_temp.v0012_rec('H3', 'H3.8', 'SKIP', 'fixtures fallaron');
    PERFORM pg_temp.v0012_rec('H3', 'H3.9', 'SKIP', 'fixtures fallaron');
    PERFORM pg_temp.v0012_rec('H3', 'H3.10', 'SKIP', 'fixtures fallaron');
    PERFORM pg_temp.v0012_rec('H3', 'H3.11', 'SKIP', 'fixtures fallaron');
    PERFORM pg_temp.v0012_rec('H3', 'H3.12', 'SKIP', 'fixtures fallaron');
    PERFORM pg_temp.v0012_rec('H3', 'H3.13', 'SKIP', 'fixtures fallaron');
    PERFORM pg_temp.v0012_rec('H3', 'H3.14', 'SKIP', 'fixtures fallaron');
    RETURN;
  END;

  PERFORM pg_temp.v0012_rec('H3', 'H3.0', 'OK',
    'fixtures creados: 3 usuarios (auth.users → handle_new_user), 2 tiendas, 1 distribuidor, 1 producto, 3 pedidos, 1 crédito');

  -- ===== H3.4 — operador → set_user_premium ⇒ 'solo admin' (D-4/D47) =====
  IF NOT v_has_11 THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.4', 'SKIP', '0011 no aplicada (assert_admin ausente)');
  ELSE
    v_state := NULL; v_errm := NULL;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_u_op::text, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.set_user_premium(v_u_op, true);
      v_state := 'SIN DENEGACIÓN';
    EXCEPTION WHEN raise_exception THEN
      v_state := 'denegado'; v_errm := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF v_state = 'denegado' AND v_errm LIKE '%solo admin%' THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.4', 'OK',
        'operador → set_user_premium: ''solo admin'' (guard unificado assert_admin, D-4)');
    ELSE
      PERFORM pg_temp.v0012_rec('H3', 'H3.4', 'FAIL',
        format('operador → set_user_premium esperaba ''solo admin''; estado=%s errm=%s', v_state, v_errm));
    END IF;
  END IF;

  -- ===== H3.5 — admin INACTIVO → update_user_role ⇒ 'solo admin' (D-3) =====
  IF NOT v_has_11 THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.5', 'SKIP', '0011 no aplicada (assert_admin ausente)');
  ELSE
    v_state := NULL; v_errm := NULL;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_u_off::text, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.update_user_role(v_u_op, 'operador');
      v_state := 'SIN DENEGACIÓN';
    EXCEPTION WHEN raise_exception THEN
      v_state := 'denegado'; v_errm := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF v_state = 'denegado' AND v_errm LIKE '%solo admin%' THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.5', 'OK',
        'admin inactivo → update_user_role: ''solo admin'' (is_active enforced en helpers, D-3)');
    ELSE
      PERFORM pg_temp.v0012_rec('H3', 'H3.5', 'FAIL',
        format('admin inactivo → update_user_role esperaba ''solo admin''; estado=%s errm=%s', v_state, v_errm));
    END IF;
  END IF;

  -- ===== H3.6 — doble confirm_delivery ⇒ 'no admite recepción' + "delivered" =====
  IF NOT v_has_9 THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.6', 'SKIP', '0009 no aplicada (guard de estado ausente)');
  ELSE
    v_state := NULL; v_errm := NULL;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_u_op::text, 'role', 'authenticated')::text, true);
    BEGIN
      -- 1ª entrega: OK (se revierte con el savepoint al fallar la 2ª)
      PERFORM public.confirm_delivery(v_o1,
        format('[{"product_id": %s, "received_quantity": 5}]', v_prod)::jsonb);
      PERFORM public.confirm_delivery(v_o1,
        format('[{"product_id": %s, "received_quantity": 5}]', v_prod)::jsonb);
      v_state := 'SIN DENEGACIÓN (doble confirm aceptado)';
    EXCEPTION WHEN raise_exception THEN
      v_state := 'denegado'; v_errm := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF v_state = 'denegado' AND v_errm LIKE '%no admite recepción%' AND v_errm LIKE '%"delivered"%' THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.6', 'OK',
        'doble confirm_delivery: ''ya confirmado; estado "delivered" no admite recepción'' (R1.2)');
    ELSE
      PERFORM pg_temp.v0012_rec('H3', 'H3.6', 'FAIL',
        format('doble confirm esperaba guard de estado; estado=%s errm=%s', v_state, v_errm));
    END IF;
  END IF;

  -- ===== H3.7 — confirm sobre cancelled ⇒ 'no admite recepción' + "cancelled" =====
  IF NOT v_has_9 THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.7', 'SKIP', '0009 no aplicada (guard de estado ausente)');
  ELSE
    v_state := NULL; v_errm := NULL;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_u_op::text, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.confirm_delivery(v_o2,
        format('[{"product_id": %s, "received_quantity": 1}]', v_prod)::jsonb);
      v_state := 'SIN DENEGACIÓN';
    EXCEPTION WHEN raise_exception THEN
      v_state := 'denegado'; v_errm := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF v_state = 'denegado' AND v_errm LIKE '%no admite recepción%' AND v_errm LIKE '%"cancelled"%' THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.7', 'OK',
        'confirm sobre cancelled: ''estado "cancelled" no admite recepción'' (R1.3)');
    ELSE
      PERFORM pg_temp.v0012_rec('H3', 'H3.7', 'FAIL',
        format('confirm sobre cancelled esperaba guard de estado; estado=%s errm=%s', v_state, v_errm));
    END IF;
  END IF;

  -- ===== H3.8 — received > quantity ⇒ CHECK 23514, NO el guard custom =====
  -- El CHECK received_quantity <= quantity (0002) es inmediato: el UPDATE
  -- revienta ANTES del IF v_rq > v_qty de confirm_delivery (inalcanzable).
  -- Review batch1 #445-1: assertear check_violation, no el mensaje.
  IF pg_catalog.to_regprocedure('public.confirm_delivery(bigint, jsonb)') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.8', 'SKIP', 'confirm_delivery ausente');
  ELSE
    v_state := NULL; v_errm := NULL; v_sqlstate := NULL;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_u_op::text, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.confirm_delivery(v_o1,
        format('[{"product_id": %s, "received_quantity": 10}]', v_prod)::jsonb);  -- quantity = 5
      v_state := 'SIN DENEGACIÓN';
    EXCEPTION WHEN check_violation THEN
      v_state := 'check_violation'; v_sqlstate := SQLSTATE; v_errm := SQLERRM;
    WHEN OTHERS THEN
      v_state := 'otro error'; v_sqlstate := SQLSTATE; v_errm := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF v_state = 'check_violation' AND v_sqlstate = '23514'
       AND v_errm NOT LIKE '%excede la cantidad pedida%' THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.8', 'OK',
        'received 10 > quantity 5 ⇒ check_violation 23514 del CHECK de order_items (guard custom R1.5 inalcanzable — review #445-1)');
    ELSE
      PERFORM pg_temp.v0012_rec('H3', 'H3.8', 'FAIL',
        format('received > quantity esperaba 23514; estado=%s sqlstate=%s errm=%s', v_state, v_sqlstate, v_errm));
    END IF;
  END IF;

  -- ===== H3.9 — confirm_delivery con product_id duplicado ⇒ 'producto repetido' =====
  IF NOT v_has_10 THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.9', 'SKIP', '0010 no aplicada (dedup de p_items ausente)');
  ELSE
    v_state := NULL; v_errm := NULL;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_u_op::text, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.confirm_delivery(v_o1, format(
        '[{"product_id": %s, "received_quantity": 2}, {"product_id": %s, "received_quantity": 3}]',
        v_prod, v_prod)::jsonb);
      v_state := 'SIN DENEGACIÓN';
    EXCEPTION WHEN raise_exception THEN
      v_state := 'denegado'; v_errm := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF v_state = 'denegado' AND v_errm LIKE '%producto repetido en items%' THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.9', 'OK',
        'confirm_delivery con product_id repetido: ''producto repetido en items'' (review batch1 #2, 0010)');
    ELSE
      PERFORM pg_temp.v0012_rec('H3', 'H3.9', 'FAIL',
        format('dup en confirm esperaba dedup RAISE; estado=%s errm=%s', v_state, v_errm));
    END IF;
  END IF;

  -- ===== H3.10 — create_order con product_id duplicado ⇒ 'producto repetido' =====
  IF NOT v_has_10 THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.10', 'SKIP', '0010 no aplicada (dedup de p_items ausente)');
  ELSE
    v_state := NULL; v_errm := NULL;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_u_op::text, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.create_order(v_dist, v_stores[1], format(
        '[{"product_id": %s, "quantity": 2}, {"product_id": %s, "quantity": 3}]',
        v_prod, v_prod)::jsonb, NULL, 'V0012 dup');
      v_state := 'SIN DENEGACIÓN';
    EXCEPTION WHEN raise_exception THEN
      v_state := 'denegado'; v_errm := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF v_state = 'denegado' AND v_errm LIKE '%producto repetido en items%' THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.10', 'OK',
        'create_order con product_id repetido: ''producto repetido en items'' (R12, 0010)');
    ELSE
      PERFORM pg_temp.v0012_rec('H3', 'H3.10', 'FAIL',
        format('dup en create_order esperaba dedup RAISE; estado=%s errm=%s', v_state, v_errm));
    END IF;
  END IF;

  -- ===== H3.11 — register_entry con pedido de OTRA tienda ⇒ 'pertenece a la tienda' =====
  IF NOT v_has_9 THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.11', 'SKIP', '0009 no aplicada (guard D-6 ausente)');
  ELSE
    v_state := NULL; v_errm := NULL;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_u_op::text, 'role', 'authenticated')::text, true);
    BEGIN
      -- pedido v_o3 pertenece a la tienda B; p_store = A (en alcance del op)
      PERFORM public.register_entry(v_prod, v_stores[1], 1, v_motive, v_o3);
      v_state := 'SIN DENEGACIÓN';
    EXCEPTION WHEN raise_exception THEN
      v_state := 'denegado'; v_errm := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF v_state = 'denegado' AND v_errm LIKE '%pertenece a la tienda%' THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.11', 'OK',
        'register_entry con pedido de otra tienda: ''pertenece a la tienda'' (R2.2/D-6, check muerto corregido)');
    ELSE
      PERFORM pg_temp.v0012_rec('H3', 'H3.11', 'FAIL',
        format('register_entry tienda ajena esperaba guard D-6; estado=%s errm=%s', v_state, v_errm));
    END IF;
  END IF;

  -- ===== H3.12 — register_entry fuera del alcance del operador ⇒ 'fuera del alcance' =====
  IF NOT v_has_9 THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.12', 'SKIP', '0009 no aplicada (guard D-6 ausente)');
  ELSE
    v_state := NULL; v_errm := NULL;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_u_op::text, 'role', 'authenticated')::text, true);
    BEGIN
      -- operador con alcance SOLO en tienda A; p_store = B
      PERFORM public.register_entry(v_prod, v_stores[2], 1, v_motive, NULL);
      v_state := 'SIN DENEGACIÓN';
    EXCEPTION WHEN raise_exception THEN
      v_state := 'denegado'; v_errm := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF v_state = 'denegado' AND v_errm LIKE '%fuera del alcance%' THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.12', 'OK',
        'register_entry fuera de alcance: ''tienda fuera del alcance del operador'' (R4.2/D-6)');
    ELSE
      PERFORM pg_temp.v0012_rec('H3', 'H3.12', 'FAIL',
        format('register_entry fuera de alcance esperaba guard; estado=%s errm=%s', v_state, v_errm));
    END IF;
  END IF;

  -- ===== H3.13 — helpers ejecutables desde policies RLS (runtime D-5) =====
  -- orders_select (0006) y credits_select (0009) invocan my_role()/
  -- my_store_ids() COMO authenticated: si 0011 les hubiese revocado EXECUTE,
  -- el SELECT revienta con 42501 dentro de la policy. Además se assertea el
  -- scope: el operador ve su tienda (O1) y NO la ajena (O3).
  IF NOT v_has_11 THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.13', 'SKIP', '0011 no aplicada (lockdown no evaluable)');
  ELSE
    v_state := NULL; v_errm := NULL; v_n1 := NULL; v_n3 := NULL;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_u_op::text, 'role', 'authenticated')::text, true);
    BEGIN
      SELECT count(*) FILTER (WHERE notes = 'V0012-O1'),
             count(*) FILTER (WHERE notes = 'V0012-O3')
      INTO v_n1, v_n3
      FROM public.orders;  -- RLS orders_select: my_role() + my_store_ids()
      PERFORM count(*) FROM public.credits;  -- RLS credits_select (0009)
      v_state := 'ok';
    EXCEPTION WHEN OTHERS THEN
      v_state := 'error'; v_sqlstate := SQLSTATE; v_errm := SQLERRM;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF v_state = 'ok' AND v_n1 = 1 AND v_n3 = 0 THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.13', 'OK',
        'helpers desde policies: orders_select/credits_select evalúan my_role/my_store_ids como authenticated; scope correcto (ve O1, no O3)');
    ELSIF v_state = 'ok' THEN
      PERFORM pg_temp.v0012_rec('H3', 'H3.13', 'FAIL',
        format('RLS respondió pero scope inesperado: O1 visible=%s (esperado 1), O3 visible=%s (esperado 0)', v_n1, v_n3));
    ELSE
      PERFORM pg_temp.v0012_rec('H3', 'H3.13', 'FAIL',
        format('policy RLS revienta (¿EXECUTE de helpers revocado en 0011?): %s — %s', v_sqlstate, v_errm));
    END IF;
  END IF;

  -- ===== Cleanup de fixtures: orden inverso de FK (RESTRICT en la mayoría) =====
  DELETE FROM public.order_items         WHERE order_id IN (v_o1, v_o2, v_o3);
  DELETE FROM public.credits             WHERE order_id IN (v_o1, v_o2, v_o3);
  DELETE FROM public.stock               WHERE product_id = v_prod;
  DELETE FROM public.movements           WHERE id > v_mov_max;
  DELETE FROM public.alerts              WHERE id > v_alert_max;
  DELETE FROM public.dashboard_daily     WHERE day = CURRENT_DATE AND distributor_id = v_dist;
  DELETE FROM public.orders              WHERE id IN (v_o1, v_o2, v_o3);
  DELETE FROM public.price_publications  WHERE product_id = v_prod;
  DELETE FROM public.products            WHERE id = v_prod;
  DELETE FROM public.user_stores         WHERE user_id IN (v_u_adm, v_u_op, v_u_off);
  DELETE FROM public.stores              WHERE name IN ('V0012 Tienda A', 'V0012 Tienda B');
  DELETE FROM public.distributors        WHERE id = v_dist;
  DELETE FROM public.users               WHERE id IN (v_u_adm, v_u_op, v_u_off);
  DELETE FROM auth.users                 WHERE id IN (v_u_adm, v_u_op, v_u_off);
  -- audit_log AL FINAL: los DELETE de las 8 tablas con audit_diff generan
  -- filas nuevas por encima de la marca; este barrido las limpia.
  DELETE FROM public.audit_log           WHERE id > v_audit_max;

  -- ===== H3.14 — cero residuo =====
  SELECT COALESCE(sum(x.n), 0) INTO v_n
  FROM (
    SELECT count(*) AS n FROM auth.users                 WHERE id IN (v_u_adm, v_u_op, v_u_off)
    UNION ALL SELECT count(*) FROM public.users          WHERE id IN (v_u_adm, v_u_op, v_u_off)
    UNION ALL SELECT count(*) FROM public.user_stores    WHERE user_id IN (v_u_adm, v_u_op, v_u_off)
    UNION ALL SELECT count(*) FROM public.stores         WHERE name IN ('V0012 Tienda A', 'V0012 Tienda B')
    UNION ALL SELECT count(*) FROM public.distributors   WHERE id = v_dist
    UNION ALL SELECT count(*) FROM public.products       WHERE id = v_prod
    UNION ALL SELECT count(*) FROM public.stock          WHERE product_id = v_prod
    UNION ALL SELECT count(*) FROM public.price_publications WHERE product_id = v_prod
    UNION ALL SELECT count(*) FROM public.orders         WHERE id IN (v_o1, v_o2, v_o3)
    UNION ALL SELECT count(*) FROM public.order_items    WHERE order_id IN (v_o1, v_o2, v_o3)
    UNION ALL SELECT count(*) FROM public.credits        WHERE order_id IN (v_o1, v_o2, v_o3)
    UNION ALL SELECT count(*) FROM public.movements      WHERE id > v_mov_max
    UNION ALL SELECT count(*) FROM public.alerts         WHERE id > v_alert_max
    UNION ALL SELECT count(*) FROM public.audit_log      WHERE id > v_audit_max
  ) x;
  IF v_n = 0 THEN
    PERFORM pg_temp.v0012_rec('H3', 'H3.14', 'OK',
      'cero residuo: fixtures eliminados en orden inverso de FK; sin movimientos/alertas/audit nuevos');
  ELSE
    PERFORM pg_temp.v0012_rec('H3', 'H3.14', 'FAIL',
      format('%s fila(s) de fixture residuales tras el cleanup — revisar orden de FK y triggers', v_n));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- H4 — Re-runs baratos post-lockdown (D-8 H4): FKs, RLS/policies y runtime
-- PostGIS como authenticated (complementa el chequeo estático H1.4).
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT connamespace::regnamespace AS sch, conname
           FROM pg_catalog.pg_constraint
           WHERE contype = 'f' AND NOT convalidated
             AND connamespace = 'public'::regnamespace
  LOOP
    PERFORM pg_temp.v0012_rec('H4', 'H4.1', 'FAIL', format('FK inválida (NOT VALID): %s.%s', r.sch, r.conname));
    n := n + 1;
  END LOOP;
  IF n = 0 THEN
    PERFORM pg_temp.v0012_rec('H4', 'H4.1', 'OK', 'sin FKs NOT VALID en public (re-run de V1 de 0008)');
  END IF;
END $$;

DO $$
DECLARE
  -- Mismo array de 25 tablas canónicas de H1.5 (L382-387): la aserción es POR
  -- NOMBRE, nunca por conteo global (review #451 D1).
  v_tables constant text[] := ARRAY[
    'roles', 'unit_types', 'store_types', 'brands', 'product_categories',
    'users', 'products', 'stores', 'price_publications', 'orders', 'order_items',
    'distributors', 'motives', 'stock', 'routes', 'route_stops', 'movements',
    'credits', 'credit_payments', 'alerts', 'user_stores', 'chat_conversations',
    'chat_messages', 'dashboard_daily', 'audit_log'];
  t         text;
  v_rls     boolean;
  v_missing text := '';
  v_no_rls  text := '';
  v_extra   text := '';
  v_anon_pol text := '';
  v_anon    oid;
BEGIN
  IF pg_catalog.to_regrole('anon') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H4', 'H4.2', 'SKIP', 'rol anon ausente');
    RETURN;
  END IF;
  SELECT oid INTO v_anon FROM pg_catalog.pg_roles WHERE rolname = 'anon';
  -- RLS por nombre: to_regclass + relrowsecurity para CADA una de las 25.
  FOREACH t IN ARRAY v_tables LOOP
    IF pg_catalog.to_regclass('public.' || t) IS NULL THEN
      v_missing := v_missing || t || ', ';
      CONTINUE;
    END IF;
    SELECT c.relrowsecurity INTO v_rls
    FROM pg_catalog.pg_class c
    WHERE c.oid = pg_catalog.to_regclass('public.' || t);
    IF NOT v_rls THEN
      v_no_rls := v_no_rls || t || ', ';
    END IF;
  END LOOP;
  -- Tablas EXTRA en public: sólo informativo (NUNCA FAIL por conteo global).
  -- 0001 L9 crea postgis SIN clausula schema ⇒ spatial_ref_sys (relocatable =
  -- false) cae en public como relkind='r': un DB limpio canónico tiene 26 y
  -- debe PASS (R18.1); el conteo 26 <> 25 era un falso FAIL (review #451 D1).
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_extra
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND NOT (c.relname::text = ANY (v_tables));
  -- Policy TO anon o TO PUBLIC (polroles vacío = PUBLIC) en public
  SELECT string_agg(n.nspname || '.' || c.relname || '.' || p.polname, ', ') INTO v_anon_pol
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND (p.polroles = '{}'::oid[] OR v_anon = ANY (p.polroles));
  IF v_missing <> '' OR v_no_rls <> '' THEN
    PERFORM pg_temp.v0012_rec('H4', 'H4.2', 'FAIL',
      format('RLS por nombre (las 25 de H1.5): ausentes=[%s] sin RLS=[%s] — re-run de V2/V3 de 0008',
             v_missing, v_no_rls));
  ELSIF v_anon_pol IS NOT NULL THEN
    PERFORM pg_temp.v0012_rec('H4', 'H4.2', 'FAIL', 'policies aplicadas a anon/PUBLIC: ' || v_anon_pol);
  ELSIF v_extra IS NOT NULL THEN
    PERFORM pg_temp.v0012_rec('H4', 'H4.2', 'WARNING',
      format('25 tablas canónicas con RLS + 0 policies TO anon/PUBLIC; tablas extra en public: %s (informativo — spatial_ref_sys es PostGIS esperado, 0001 L9 sin schema; no bloquea)',
             v_extra));
  ELSE
    PERFORM pg_temp.v0012_rec('H4', 'H4.2', 'OK',
      '25 tablas con RLS + 0 policies TO anon/PUBLIC (re-run de V3 de 0008)');
  END IF;
END $$;

DO $$
DECLARE v_n bigint; v_errm text := NULL;
BEGIN
  IF pg_catalog.to_regclass('public.stores_geo') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H4', 'H4.3', 'SKIP', 'vista stores_geo ausente (0004 no aplicada)');
    RETURN;
  END IF;
  IF pg_catalog.to_regrole('authenticated') IS NULL THEN
    PERFORM pg_temp.v0012_rec('H4', 'H4.3', 'SKIP', 'rol authenticated ausente');
    RETURN;
  END IF;
  -- security_invoker = true ⇒ el cliente ejecuta st_x/st_y/geometry(geography)
  -- COMO authenticated: sin el re-grant PostGIS de 0011 la vista revienta.
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO v_n FROM public.stores_geo;
  EXCEPTION WHEN OTHERS THEN
    v_errm := SQLERRM;
  END;
  RESET ROLE;
  IF v_errm IS NULL THEN
    PERFORM pg_temp.v0012_rec('H4', 'H4.3', 'OK',
      format('stores_geo como authenticated: %s fila(s) visibles (RLS security_invoker + PostGIS ejecutado como cliente)', v_n));
  ELSE
    PERFORM pg_temp.v0012_rec('H4', 'H4.3', 'FAIL',
      'stores_geo revienta para authenticated (¿re-grant PostGIS de 0011 faltando?): ' || v_errm);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Resumen final: conteo por veredicto + detalle completo ordenado.
-- FAIL = investigar ANTES de dar por bueno el hardening.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_ok integer; v_fail integer; v_warn integer; v_skip integer;
BEGIN
  SELECT count(*) FILTER (WHERE verdict = 'OK'),
         count(*) FILTER (WHERE verdict = 'FAIL'),
         count(*) FILTER (WHERE verdict = 'WARNING'),
         count(*) FILTER (WHERE verdict = 'SKIP')
  INTO v_ok, v_fail, v_warn, v_skip
  FROM _v0012_results;
  RAISE NOTICE '0012 RESUMEN — total: % · OK: % · FAIL: % · WARNING: % · SKIP: %',
    v_ok + v_fail + v_warn + v_skip, v_ok, v_fail, v_warn, v_skip;
  IF v_fail > 0 THEN
    RAISE WARNING '0012 — % check(s) FAIL: el hardening NO está verificado; ver filas FAIL del SELECT siguiente', v_fail;
  ELSE
    RAISE NOTICE '0012 — sin FAIL: grants, whitelist, tests negativos y RLS consistentes (H1-H4)';
  END IF;
END $$;

SELECT seccion, check_id, verdict, detalle
FROM _v0012_results
ORDER BY seq;

-- Smoke test MANUAL §7.11 (post-aplicación real; no automatizable acá: exige
-- signup vía GoTrue, tráfico concurrente y datos de negocio — ver checklist de
-- 0008 §final): signup → fila users con operador → update_user_role →
-- assign_user_stores → create_store → assign_product_to_store → entry → exit
-- (concurrente) → reverse → set_price → create_order → confirm_delivery (STOCK
-- SUMA) → save_route → mark_stop → create_credit → register_payment →
-- register_payment_reverse → alertas (alta y cierre) → perfil propio:
-- full_name OK, role_id denegado (D45) → admin: set_user_premium (users.premium
-- cambia + fila audit) y set_user_active; no-admin: ambas denegadas (D47).

-- Fin batch 4 (0012). Sprint 1 hardening completo: 0009 → 0010 → 0011 → 0012.
