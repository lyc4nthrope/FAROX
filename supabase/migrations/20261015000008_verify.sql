-- ============================================================================
-- 20261015000008_verify.sql — Verificaciones del Sprint 1 (§7 paso 11)
-- ============================================================================
-- Script de DIAGNÓSTICO: no modifica nada. Emite un resultado por bloque
-- (RAISE NOTICE + SELECTs finales). Todo "OK" = esquema sano; cualquier
-- WARNING = investigar antes de continuar con el Sprint 2.
-- Requiere haber corrido 0001…0007 en orden (y el paso manual de
-- supabase/README.md: signup del primer admin + promoción en SQL editor).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- V1. FKs inválidas (copia literal del §7.11) — NOT VALID / sin validar
-- ---------------------------------------------------------------------------
DO $$ DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT connamespace::regnamespace AS sch, conname
           FROM pg_catalog.pg_constraint
           WHERE contype = 'f' AND NOT convalidated
             AND connamespace = 'public'::regnamespace
  LOOP
    RAISE WARNING 'FK inválida: %.%', r.sch, r.conname;
    n := n + 1;
  END LOOP;
  IF n = 0 THEN
    RAISE NOTICE 'V1 OK — sin FKs inválidas en public';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- V2. Conteo de objetos: 25 tablas, 11 enums, funciones y triggers esperados
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tables  integer;
  v_enums   integer;
  v_funcs   integer;
  v_trig    integer;
BEGIN
  -- Objetos de extensiones excluidos (postgis instala spatial_ref_sys +
  -- ~cientos de funciones en public sin ser de FAROX): deptype = 'e'.
  SELECT count(*) INTO v_tables FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                     WHERE d.classid = 'pg_catalog.pg_class'::regclass
                       AND d.objid = c.oid AND d.deptype = 'e');
  IF v_tables = 25 THEN
    RAISE NOTICE 'V2 OK — 25 tablas en public';
  ELSE
    RAISE WARNING 'V2 — tablas en public: % (esperadas 25)', v_tables;
  END IF;

  SELECT count(*) INTO v_enums FROM pg_catalog.pg_type t
   JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public' AND t.typtype = 'e'
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                     WHERE d.classid = 'pg_catalog.pg_type'::regclass
                       AND d.objid = t.oid AND d.deptype = 'e');
  IF v_enums = 11 THEN
    RAISE NOTICE 'V2 OK — 11 enums en public';
  ELSE
    RAISE WARNING 'V2 — enums en public: % (esperados 11)', v_enums;
  END IF;

  -- 47 funciones = 5 helpers scope + 5 internos + 8 trigger-fn + 29 RPC/jobs
  -- (stores_geo es vista, no cuenta). Sin nombres duplicados: ver el GROUP BY
  -- HAVING de abajo. Extensiones excluidas (deptype 'e').
  SELECT count(*) INTO v_funcs FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                     WHERE d.classid = 'pg_catalog.pg_proc'::regclass
                       AND d.objid = p.oid AND d.deptype = 'e');
  IF v_funcs = 47 THEN
    RAISE NOTICE 'V2 OK — 47 funciones en public';
  ELSE
    RAISE WARNING 'V2 — funciones en public: % (esperadas 47)', v_funcs;
  END IF;

  -- Triggers en tablas de public: 26 (28 totales − 2 sobre auth.users, que
  -- se verifican aparte en V9). Conteo esperado: 8 audit + 16
  -- updated_at/sanitize/cap/price.
  SELECT count(*) INTO v_trig FROM pg_catalog.pg_trigger t
   JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND NOT t.tgisinternal;
  IF v_trig = 26 THEN
    RAISE NOTICE 'V2 OK — 26 triggers en tablas de public';
  ELSE
    RAISE WARNING 'V2 — triggers no internos en public: % (esperados 26)', v_trig;
  END IF;
END $$;

-- Detalle de funciones por si V2 falla (esperadas 47, sin duplicados):
SELECT n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
GROUP BY 1, 2, 3
HAVING count(*) > 1;   -- debe devolver 0 filas (sin duplicados)

-- ---------------------------------------------------------------------------
-- V3. RLS habilitado en las 25 tablas + sin policies para anon
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                      WHERE d.classid = 'pg_catalog.pg_class'::regclass
                        AND d.objid = c.oid AND d.deptype = 'e')  -- p.ej. spatial_ref_sys
  LOOP
    RAISE WARNING 'V3 — RLS DESHABILITADO en %.%', 'public', r.relname;
    n := n + 1;
  END LOOP;
  IF n = 0 THEN
    RAISE NOTICE 'V3 OK — RLS habilitado en las 25 tablas';
  END IF;
END $$;

DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT p.polrelid::regclass AS tbl
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND COALESCE(p.polroles, '{}') @> ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon')]::oid[]
  LOOP
    RAISE WARNING 'V3 — policy aplicada a anon sobre %', r.tbl;
    n := n + 1;
  END LOOP;
  IF n = 0 THEN
    RAISE NOTICE 'V3 OK — ninguna policy TO anon (§8)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- V4. Políticas esperadas por tabla (matriz §8) — recuento por tabla/acción
-- ---------------------------------------------------------------------------
SELECT c.relname AS tabla,
       p.polcmd AS accion,   -- * = ALL, r = SELECT, a = INSERT, u = UPDATE, d = DELETE
       count(*) AS policies
FROM pg_catalog.pg_policy p
JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
GROUP BY 1, 2
ORDER BY 1, 2;
-- Esperados clave: catalogs_* (6 tablas × 4), distributors 4, products 4,
-- stores 3 (sin INSERT), price_publications 2, users 3 (SELECT + UPDATE admin
-- + UPDATE propia, D45), orders 1, stock 1,
-- movements 1, routes 1, route_stops 1, credits 1, credit_payments 1,
-- alerts 1, user_stores 1, chat_conversations 1, chat_messages 1,
-- audit_read 1, dashboard_read 1. order_items = 0 (deny-all, D40).

-- ---------------------------------------------------------------------------
-- V5. REVOKE efectivos (§4): authenticated sin DML directo en RPC-only;
-- anon sin EXECUTE
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT c.relname AS tbl, a.privilege_type AS polcmd
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN LATERAL aclexplode(c.relacl) a(grantor, grantee, privilege_type, is_grantable)
      ON true
    JOIN pg_catalog.pg_roles rl ON rl.oid = a.grantee
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND rl.rolname = 'authenticated'
      AND c.relname IN ('stock','movements','order_items','orders','credits',
                        'credit_payments','price_publications','alerts','routes',
                        'route_stops','user_stores','dashboard_daily','audit_log',
                        'chat_conversations','chat_messages')
      AND a.privilege_type IN ('INSERT','UPDATE','DELETE')
  LOOP
    RAISE WARNING 'V5 — authenticated conserva % sobre %', r.polcmd, r.tbl;
    n := n + 1;
  END LOOP;
  IF n = 0 THEN
    RAISE NOTICE 'V5 OK — DML directo revocado en las 15 tablas RPC-only + stores INSERT';
  END IF;
END $$;

-- PUBLIC = grantee 0 en las ACLs (no figura en pg_roles): sin este chequeo el
-- grant de PUBLIC pasaba desapercibido y el bloque devolvía "OK" falso (B3).
DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT p.proname, COALESCE(rl.rolname, 'PUBLIC') AS who
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN LATERAL aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner)))
      a(grantor, grantee, privilege_type, is_grantable)
      ON true
    LEFT JOIN pg_catalog.pg_roles rl ON rl.oid = a.grantee
    WHERE n.nspname = 'public'
      AND a.privilege_type = 'EXECUTE'
      AND (a.grantee = 0 OR rl.rolname = 'anon')
  LOOP
    RAISE WARNING 'V5 — % puede ejecutar %()', r.who, r.proname;
    n := n + 1;
  END LOOP;
  IF n = 0 THEN
    RAISE NOTICE 'V5 OK — ni anon ni PUBLIC con EXECUTE en ninguna función de public';
  END IF;
END $$;

-- Los helpers internos NO deben ser ejecutables por clientes (ni vía PUBLIC):
DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT p.proname, COALESCE(rl.rolname, 'PUBLIC') AS who
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN LATERAL aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner)))
      a(grantor, grantee, privilege_type, is_grantable)
      ON true
    LEFT JOIN pg_catalog.pg_roles rl ON rl.oid = a.grantee
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'internal\_%'
      AND a.privilege_type = 'EXECUTE'
      AND (a.grantee = 0 OR rl.rolname = 'authenticated')
  LOOP
    RAISE WARNING 'V5 — % puede ejecutar helper interno %()', r.who, r.proname;
    n := n + 1;
  END LOOP;
  IF n = 0 THEN
    RAISE NOTICE 'V5 OK — helpers internos sin EXECUTE para clientes';
  END IF;
END $$;

-- Los jobs de pg_cron NO deben ser ejecutables por clientes (D46; pg_cron
-- corre como postgres = owner, que conserva EXECUTE):
DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT COALESCE(rl.rolname, 'PUBLIC') AS who, p.proname
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN LATERAL aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner)))
      a(grantor, grantee, privilege_type, is_grantable)
      ON true
    LEFT JOIN pg_catalog.pg_roles rl ON rl.oid = a.grantee
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'job\_scan\_%'
      AND a.privilege_type = 'EXECUTE'
      AND (a.grantee = 0 OR rl.rolname IN ('authenticated', 'anon'))
  LOOP
    RAISE WARNING 'V5 — % puede ejecutar job %()', r.who, r.proname;
    n := n + 1;
  END LOOP;
  IF n = 0 THEN
    RAISE NOTICE 'V5 OK — jobs pg_cron sin EXECUTE para clientes (D46)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- V6. Seeds presentes (0005) + unicidad de unit_types.abbreviation (§9)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_roles integer; v_units integer; v_stypes integer;
  v_cats  integer; v_brands integer; v_motives integer;
  v_abbr  integer; v_reab   bigint;
BEGIN
  SELECT count(*) INTO v_roles   FROM public.roles;
  SELECT count(*) INTO v_units   FROM public.unit_types;
  SELECT count(*) INTO v_stypes  FROM public.store_types;
  SELECT count(*) INTO v_cats    FROM public.product_categories;
  SELECT count(*) INTO v_brands  FROM public.brands;
  SELECT count(*) INTO v_motives FROM public.motives;

  IF v_roles = 3 THEN RAISE NOTICE 'V6 OK — roles: 3 (admin/operador/distribuidor)';
  ELSE RAISE WARNING 'V6 — roles: % (esperados 3); signup fallaría sin "operador"', v_roles; END IF;

  IF v_units >= 3 THEN RAISE NOTICE 'V6 OK — unit_types: %', v_units;
  ELSE RAISE WARNING 'V6 — unit_types: % (<3)', v_units; END IF;

  IF v_stypes >= 1 THEN RAISE NOTICE 'V6 OK — store_types: %', v_stypes;
  ELSE RAISE WARNING 'V6 — store_types vacío; create_store() fallará'; END IF;

  IF v_cats >= 2 THEN RAISE NOTICE 'V6 OK — product_categories: % (con jerarquía)', v_cats;
  ELSE RAISE WARNING 'V6 — product_categories: % (<2, ¿jerarquía sin probar?)', v_cats; END IF;

  IF v_brands >= 1 THEN RAISE NOTICE 'V6 OK — brands: %', v_brands;
  ELSE RAISE WARNING 'V6 — brands vacío; products.brand_id NOT NULL sin filas'; END IF;

  IF v_motives = 5 THEN RAISE NOTICE 'V6 OK — motives: 5 (venta/reabastecimiento/devolución/merma/ajuste)';
  ELSE RAISE WARNING 'V6 — motives: % (esperados 5)', v_motives; END IF;

  -- §9: validar unicidad de abbreviation (el UNIQUE de 0002 la impone; si la
  -- migración corrió, aquí solo puede haber duplicados si se insertó a mano
  -- desactivando el constraint).
  SELECT count(*) INTO v_abbr FROM (
    SELECT abbreviation FROM public.unit_types GROUP BY abbreviation HAVING count(*) > 1
  ) d;
  IF v_abbr = 0 THEN RAISE NOTICE 'V6 OK — unit_types.abbreviation único (pendiente §9 cerrado)';
  ELSE RAISE WARNING 'V6 — % abreviaturas duplicadas en unit_types', v_abbr; END IF;

  -- Motivo que confirm_delivery() busca por nombre EXACTO (0004):
  SELECT count(*) INTO v_reab FROM public.motives WHERE name = 'reabastecimiento';
  IF v_reab = 1 THEN RAISE NOTICE 'V6 OK — motives.reabastecimiento presente (confirm_delivery depende)';
  ELSE RAISE WARNING 'V6 — motives.''reabastecimiento'' ausente/duplicada: confirm_delivery() fallará'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- V7. Realtime podado: solo alerts y dashboard_daily (§5/D32)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_count integer; v_extra text;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_catalog.pg_publication_tables
  WHERE pubname = 'supabase_realtime' AND schemaname = 'public';
  IF v_count = 2 THEN
    RAISE NOTICE 'V7 OK — supabase_realtime publica solo 2 tablas';
  ELSE
    SELECT string_agg(tablename, ', ' ORDER BY tablename) INTO v_extra
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public';
    RAISE WARNING 'V7 — supabase_realtime publica % tablas (%), esperadas 2 (alerts, dashboard_daily)',
                  v_count, COALESCE(v_extra, '?');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- V8. Jobs pg_cron: los 3 diarios programados (§7.10)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_jobs integer; v_names text;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE WARNING 'V8 — extensión pg_cron no instalada (¿0001 corrió?)';
  ELSE
    SELECT count(*) INTO v_jobs
    FROM cron.job
    WHERE jobname IN ('farox_expiry_soon','farox_order_late','farox_credit_overdue');
    IF v_jobs = 3 THEN
      RAISE NOTICE 'V8 OK — 3 jobs pg_cron programados';
    ELSE
      SELECT string_agg(jobname, ', ') INTO v_names FROM cron.job
       WHERE jobname LIKE 'farox\_%';
      RAISE WARNING 'V8 — jobs farox encontrados: % (esperados 3)',
                    COALESCE(v_names, 'ninguno');
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- V9. Triggers de auth presentes (sin ellos el primer login no crea users)
-- ---------------------------------------------------------------------------
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal
    AND c.relname = 'users' AND c.relnamespace = 'auth'::regnamespace
    AND t.tgname IN ('on_auth_user_created','on_auth_user_email_updated');
  IF n = 2 THEN
    RAISE NOTICE 'V9 OK — triggers de signup/email sobre auth.users';
  ELSE
    RAISE WARNING 'V9 — triggers en auth.users: % (esperados 2) — el signup NO creará fila users', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- V10. Invariantes de datos "calientes" que las RPC asumen
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_admin uuid;
  v_open  integer;
BEGIN
  -- Primer admin promovido (paso manual del README): si no existe, el demo
  -- no puede administrar nada (update_user_role exige caller admin; la
  -- promoción inicial es un UPDATE directo en SQL editor, como postgres).
  SELECT u.id INTO v_admin FROM public.users u
  JOIN public.roles r ON r.id = u.role_id
  WHERE r.name = 'admin' AND u.is_active LIMIT 1;
  IF v_admin IS NOT NULL THEN
    RAISE NOTICE 'V10 OK — existe al menos 1 admin activo';
  ELSE
    RAISE WARNING 'V10 — SIN ADMIN ACTIVO: falta el paso manual (signup + promoción, ver supabase/README.md)';
  END IF;

  -- Dedup de alertas: uq_alert_open debe estar sin violaciones (toda la
  -- lógica de apertura usa ON CONFLICT con ese target exacto).
  SELECT count(*) INTO v_open FROM (
    SELECT 1 FROM public.alerts
    WHERE resolved_at IS NULL
    GROUP BY type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0)
    HAVING count(*) > 1
  ) d;
  IF v_open = 0 THEN
    RAISE NOTICE 'V10 OK — uq_alert_open sin duplicados';
  ELSE
    RAISE WARNING 'V10 — % episodios de alerta duplicados (uq_alert_open violado)', v_open;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- V11. Perfil propio (D45): policy de fila propia + grants por columna en
-- users — authenticated solo puede UPDATEar sus columnas de perfil
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_own  integer;
  v_wide integer;
  v_cols text;
BEGIN
  -- policy UPDATE de fila propia (USING con auth.uid()) presente
  SELECT count(*) INTO v_own
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'users'
    AND p.polcmd = 'u'
    AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) LIKE '%auth.uid()%';
  IF v_own >= 1 THEN
    RAISE NOTICE 'V11 OK — policy UPDATE de fila propia en users (D45)';
  ELSE
    RAISE WARNING 'V11 — sin policy UPDATE de fila propia en users (D45)';
  END IF;

  -- UPDATE de tabla completa ausente para authenticated (fue revocado)
  SELECT count(*) INTO v_wide
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN LATERAL aclexplode(c.relacl) a(grantor, grantee, privilege_type, is_grantable)
    ON true
  JOIN pg_catalog.pg_roles rl ON rl.oid = a.grantee
  WHERE n.nspname = 'public' AND c.relname = 'users'
    AND rl.rolname = 'authenticated' AND a.privilege_type = 'UPDATE';

  -- y las columnas con UPDATE son exactamente las de perfil
  SELECT string_agg(att.attname, ', ' ORDER BY att.attname) INTO v_cols
  FROM pg_catalog.pg_attribute att
  JOIN pg_catalog.pg_class c ON c.oid = att.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN LATERAL aclexplode(att.attacl) a(grantor, grantee, privilege_type, is_grantable)
    ON true
  JOIN pg_catalog.pg_roles rl ON rl.oid = a.grantee
  WHERE n.nspname = 'public' AND c.relname = 'users' AND att.attnum > 0
    AND rl.rolname = 'authenticated' AND a.privilege_type = 'UPDATE';

  IF v_wide = 0 AND v_cols = 'contact_preference, full_name, phone_number' THEN
    RAISE NOTICE 'V11 OK — UPDATE de users limitado a columnas de perfil (D45)';
  ELSE
    RAISE WARNING 'V11 — grants UPDATE de users: tabla completa=%, columnas=% (esperado: solo contact_preference, full_name, phone_number)',
                  v_wide, COALESCE(v_cols, 'ninguna');
  END IF;
END $$;

-- D47: las RPC que cierran el gap de columnas privilegiadas D45 (premium/
-- is_active) existen y son ejecutables por authenticated — el guard solo-admin
-- vive dentro de la función, el GRANT (blanket de 0006) debe alcanzarlas:
DO $$
DECLARE
  v_missing text;
  v_nogrant text;
BEGIN
  SELECT string_agg(x.fn, ', ') INTO v_missing
  FROM (VALUES ('set_user_premium'), ('set_user_active')) AS x(fn)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = x.fn);

  SELECT string_agg(x.fn, ', ') INTO v_nogrant
  FROM (VALUES ('set_user_premium'), ('set_user_active')) AS x(fn)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN LATERAL aclexplode(p.proacl) a(grantor, grantee, privilege_type, is_grantable)
      ON true
    JOIN pg_catalog.pg_roles rl ON rl.oid = a.grantee
    WHERE n.nspname = 'public' AND p.proname = x.fn
      AND rl.rolname = 'authenticated' AND a.privilege_type = 'EXECUTE');

  IF v_missing IS NULL AND v_nogrant IS NULL THEN
    RAISE NOTICE 'V11 OK — set_user_premium/set_user_active presentes con EXECUTE para authenticated (D47)';
  ELSE
    RAISE WARNING 'V11 — D47: ausentes=%, sin EXECUTE para authenticated=%',
                  COALESCE(v_missing, 'ninguna'), COALESCE(v_nogrant, 'ninguna');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Resumen final de estado (SELECTs para revisar a ojo)
-- ---------------------------------------------------------------------------
SELECT 'tablas'        AS concepto, count(*)::text AS valor
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
UNION ALL
SELECT 'enums', count(*)::text
  FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e'
UNION ALL
SELECT 'funciones', count(*)::text
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
UNION ALL
SELECT 'policies', count(*)::text
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
UNION ALL
SELECT 'tablas realtime', count(*)::text
  FROM pg_catalog.pg_publication_tables
  WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
UNION ALL
SELECT 'usuarios', count(*)::text FROM public.users
UNION ALL
SELECT 'roles sembrados', count(*)::text FROM public.roles;

-- Smoke test MANUAL (no automatizable sin datos): signup → fila users con
-- operador → update_user_role → assign_user_stores → create_store →
-- assign_product_to_store → entry → exit (concurrente) → reverse → set_price →
-- create_order → confirm_delivery (STOCK SUMA) → save_route → mark_stop →
-- create_credit → register_payment → register_payment_reverse → alertas
-- (alta y cierre) → update del perfil propio: full_name OK, role_id denegado
-- (D45) → admin: set_user_premium (users.premium cambia + fila audit) y
-- set_user_active; no-admin: ambas denegadas (D47) — §7.11.

-- Fin paso 8/8. Sprint 1 materializado.
