-- Entity: foundation (PostGIS + pg_cron + 11 enums + scope/security helpers + trigger fns) | Source: 0001_extensions_enums.sql:L1-104 (ext+enums), 20261016000009_negocio.sql:L32-89 (helpers de alcance, versión FINAL con is_active enforced), 20261016000011_seguridad.sql:L36-68 (assert_admin, versión FINAL), 0004_functions_triggers.sql:L250-259 (touch_updated_at), 20261016000010_perf.sql:L274-315 (audit_diff FINAL R10) | Order: MUST RUN FIRST — antes que TODOS los demás supabase/entities/*.sql
-- ⚠ Este archivo debe ejecutarse primero: los catálogos 01-06 dependen de los
--   enums (motives usa movement_type), de touch_updated_at() (triggers de
--   brands y product_categories) y de los helpers de alcance consolidados acá
--   en su versión FINAL: las policies de TODAS las entidades llaman
--   my_role() · is_premium() · has_scope() · my_store_ids() ·
--   my_distributor_id(); los guards RPC llaman assert_admin(); los
--   trg_audit_* (07-13, 19-20) ejecutan audit_diff() (versión final 0010).

-- check_function_bodies: los helpers SQL-language (my_role, is_premium,
-- my_store_ids, my_distributor_id, has_scope) referencian tablas (users,
-- roles, user_stores) que todavía NO existen cuando corre este archivo en la
-- secuencia 00..25 — sin este SET, CREATE FUNCTION fallaría al validar el
-- body contra el catálogo. Los cuerpos se resuelven en RUNTIME (cuando las
-- tablas ya existen). Se restaura al final del archivo: los archivos 01..25
-- crean sus funciones DESPUÉS de sus tablas, así que vuelven al
-- comportamiento default de validación.
SET check_function_bodies = off;

-- ============================================================================
-- 1. Extensiones — VERBATIM 0001_extensions_enums.sql:6-12
-- ============================================================================
-- 1. Extensiones -------------------------------------------------------------
-- FAROX solo trae pg_stat_statements/pgcrypto/uuid-ossp; PostGIS es necesario
-- para stores.location (D12) y pg_cron para los jobs diarios de alertas (§7.10).
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- NO pg_trgm todavía (D22): se añade junto a los GIN de búsqueda (~50.000 productos).
-- NOTA (batch catálogos): la consigna nombraba solo PostGIS; pg_cron se copia
-- VERBATIM de 0001:10 porque 0007_realtime_jobs.sql lo necesita y `IF NOT EXISTS`
-- lo hace idempotente si otro batch también lo declara.

-- ============================================================================
-- 2. Enums — VERBATIM 0001_extensions_enums.sql:14-104 (los 11 tipos nativos)
-- ============================================================================
-- 2. Enums (§1) — 11 tipos nativos -------------------------------------------
-- Protocolo enum (§1): cada migración corre en 1 transacción ⇒ ALTER TYPE
-- ADD VALUE puede añadirse pero no usarse en la misma migración.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'movement_type' AND n.nspname = 'public') THEN
    CREATE TYPE public.movement_type AS ENUM ('entry', 'exit');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'order_status' AND n.nspname = 'public') THEN
    CREATE TYPE public.order_status AS ENUM ('pending', 'in_route', 'delivered', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'order_item_status' AND n.nspname = 'public') THEN
    CREATE TYPE public.order_item_status AS ENUM ('pending', 'received', 'partial');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'route_status' AND n.nspname = 'public') THEN
    CREATE TYPE public.route_status AS ENUM ('planned', 'active', 'completed', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'stop_status' AND n.nspname = 'public') THEN
    CREATE TYPE public.stop_status AS ENUM ('pending', 'arrived', 'completed', 'skipped');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'credit_status' AND n.nspname = 'public') THEN
    CREATE TYPE public.credit_status AS ENUM ('pending', 'paid', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'payment_method' AND n.nspname = 'public') THEN
    CREATE TYPE public.payment_method AS ENUM ('cash', 'transfer', 'card', 'other');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'alert_type' AND n.nspname = 'public') THEN
    CREATE TYPE public.alert_type AS ENUM ('stock_low', 'expiry_soon', 'order_late', 'credit_overdue');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'chat_role' AND n.nspname = 'public') THEN
    CREATE TYPE public.chat_role AS ENUM ('user', 'assistant', 'tool');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'audit_action' AND n.nspname = 'public') THEN
    CREATE TYPE public.audit_action AS ENUM ('insert', 'update', 'delete');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'contact_preference' AND n.nspname = 'public') THEN
    CREATE TYPE public.contact_preference AS ENUM ('whatsapp', 'phone', 'email');
  END IF;
END $$;

-- ============================================================================
-- 3. Scope/security helpers (versión FINAL — consolidados de 0009/0011)
-- ============================================================================
-- Los 5 helpers STABLE de alcance son los ÚNICOS invocados desde las RLS
-- policies (el rol consultante los ejecuta, por eso reciben GRANT a
-- authenticated — whitelist 0011:480-485) y assert_admin() es el guard
-- NULL-safe unificado de las RPC solo-admin (D-4). Consolidarlos acá (en su
-- lugar) resuelve el bug de orden: las policies de 01..25 NO se pueden crear
-- si estas funciones no existen todavía. Cuerpos VERBATIM de la migración
-- final que los define (0009 para los 5 helpers; 0011 para assert_admin).

-- 3.1 my_role() — VERBATIM 20261016000009_negocio.sql:40-46 (redef. de 0004:31-37;
--     0009 añade el predicado u.is_active — R3/D-3: inactivo ⇒ NULL ⇒ guard no pasa).
-- Nombre del rol del JWT; helper de todas las validaciones.
CREATE OR REPLACE FUNCTION public.my_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.name
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id
  WHERE u.id = auth.uid() AND u.is_active;  -- R3/D-3: inactivo ⇒ NULL ⇒ guard no pasa
$$;

-- 3.2 is_premium() — VERBATIM 20261016000009_negocio.sql:49-57 (redef. de 0004:40-48).
-- premium OR rol = admin (D7), leído de users — nunca del JWT.
CREATE OR REPLACE FUNCTION public.is_premium() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = auth.uid() AND u.is_active AND (u.premium OR r.name = 'admin')  -- R3/D-3
  );
$$;

-- 3.3 my_store_ids() — VERBATIM 20261016000009_negocio.sql:60-67 (redef. de 0004:51-56;
--     0009 añade el EXISTS de is_active). Movido de 11_user_stores.sql (bug de
--     orden: policies de 09-15 la referencian antes de que 11 corra).
-- Alcance del operador, evaluado 1 vez por query (no subconsulta correlacionada por fila).
CREATE OR REPLACE FUNCTION public.my_store_ids() RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(array_agg(us.store_id), '{}'::bigint[])
  FROM public.user_stores us
  WHERE us.user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.users u  -- R3/D-3: inactivo ⇒ alcance vacío
                WHERE u.id = auth.uid() AND u.is_active);
$$;

-- 3.4 my_distributor_id() — VERBATIM 20261016000009_negocio.sql:69-73 (redef. de 0004:58-63).
CREATE OR REPLACE FUNCTION public.my_distributor_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.distributor_id FROM public.users u
  WHERE u.id = auth.uid() AND u.is_active;  -- R3/D-3: inactivo ⇒ NULL
$$;

-- 3.5 has_scope() — VERBATIM 20261016000009_negocio.sql:77-89 (redef. de 0004:65-76).
-- Gate de "todas las acciones" (D37): admin · rol distribuidor con
-- distributor_id · cualquier usuario con >=1 fila en user_stores.
CREATE OR REPLACE FUNCTION public.has_scope() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = auth.uid()
      AND u.is_active  -- R3/D-3
      AND (r.name = 'admin'
           OR u.distributor_id IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.user_stores us WHERE us.user_id = u.id))
  );
$$;

-- 3.6 assert_admin() — VERBATIM 20261016000011_seguridad.sql:47-68 (creado en 0011,
--     sin redefiniciones previas). Guard NULL-safe unificado de las RPC solo-admin.
CREATE OR REPLACE FUNCTION public.assert_admin() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_ok boolean;
BEGIN
  -- CRÍTICO: session_user, NO current_user. Dentro de SECURITY DEFINER,
  -- current_user SIEMPRE es el owner (postgres) ⇒ "current_user='postgres'"
  -- dejaría pasar a TODOS (bypass total del guard). En PostgREST,
  -- session_user = 'authenticator' (nunca 'postgres') ⇒ anon y clientes
  -- jamás toman el bypass; la sesión del SQL editor/MCP (session_user =
  -- 'postgres', sin JWT ⇒ auth.uid() IS NULL) sí, preservando el bootstrap
  -- del primer admin (C2, R16.3).
  IF session_user() = 'postgres' AND auth.uid() IS NULL THEN
    RETURN;  -- sesión del SQL editor: bootstrap del primer admin (C2)
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.users u JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = auth.uid() AND r.name = 'admin' AND u.is_active
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'solo admin'; END IF;
END;
$$;

-- ============================================================================
-- 4. Trigger fns compartidas — touch_updated_at VERBATIM 0004:250-259;
--    audit_diff VERBATIM 0010_perf.sql:283-315 (versión FINAL R10)
-- =============================================================================
-- BEFORE UPDATE de todas las tablas mutables con updated_at.
-- (No aplica a append-only: movements, credit_payments, audit_log, chat_messages,
--  y a tablas sin updated_at: motives, route_stops, alerts, user_stores.)
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Auditoría DML (D10/D21): SOLO columnas cambiadas en UPDATE; alcance = 8
-- tablas (users, price_publications, orders, credits, credit_payments,
-- distributors, products, stores). NO audita movements (ya es el asiento
-- forense) ni chat_* (volumen máximo). Los SELECT no se auditan con triggers
-- DML (M8: la trazabilidad de tools del chatbot la lleva n8n).
-- Versión FINAL (R10): VERBATIM 20261016000010_perf.sql:283-315 — to_jsonb(OLD)
-- cacheado en v_old (1 serialización por trigger en vez de 1+N claves+1);
-- semántica idéntica a 0004:266-294 (mismas ramas, mismo diff, search_vector
-- excluido, row_id COALESCE). Vive en foundation (no en 25_audit_log.sql) para
-- que los trg_audit_* de 07-13/19-20 puedan referenciarla con orden garantizado.
CREATE OR REPLACE FUNCTION public.audit_diff() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_diff   jsonb;
  v_row_id text;
  v_old    jsonb;  -- R10: cache de to_jsonb(OLD); NULL en INSERT
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old := to_jsonb(OLD);  -- R10: evaluación única (antes: 1 + N claves + 1)
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(jsonb_object_agg(n.key, n.value), '{}'::jsonb)
      INTO v_diff
    FROM jsonb_each(to_jsonb(NEW)) AS n(key, value)
    WHERE n.value IS DISTINCT FROM v_old -> n.key;  -- R10: usa el cache
    IF v_diff = '{}'::jsonb THEN
      RETURN NEW;  -- update sin cambios reales: no auditar
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_diff := to_jsonb(NEW) - 'search_vector';  -- tsvector derivado: ruido + peso
  ELSE
    v_diff := v_old - 'search_vector';
  END IF;

  -- row_id text (no bigint): users.id es uuid — sin esto los cambios de
  -- rol/premium (los más críticos de SEC-01) quedaban con row_id NULL (B10)
  v_row_id := COALESCE(to_jsonb(NEW) ->> 'id', v_old ->> 'id');

  INSERT INTO public.audit_log (created_by, table_name, action, row_id, diff)
  VALUES (auth.uid(), TG_TABLE_NAME, lower(TG_OP)::public.audit_action, v_row_id, v_diff);
  RETURN NEW;
END;
$$;
-- NOTA de orden: audit_diff() escribe en public.audit_log (0003_tables_farox.sql)
-- — el cuerpo se resuelve en runtime, pero audit_log debe existir antes del
-- PRIMER INSERT/UPDATE/DELETE sobre una tabla auditada.
-- Ninguno de los 6 catálogos de este batch (01-06) lleva trigger audit_diff
-- (alcance D21 = 8 tablas, ver 0004:498-537).

-- Restaurar la validación default: los archivos 01..25 crean sus funciones
-- DESPUÉS de sus tablas (y de foundation), así que la validación de bodies
-- vuelve a estar activa para todo el resto de la secuencia. El off solo
-- cubrió el window de foundation (helpers SQL-language con forward refs).
SET check_function_bodies = on;
