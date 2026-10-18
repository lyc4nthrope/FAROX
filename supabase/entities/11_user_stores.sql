-- Entity: user_stores | Source: 20261015000003_tables_farox.sql:199-207 (CREATE TABLE) · 20261015000006_rls_grants.sql:47,303-310,351-357,371-373 (RLS + policies + grants) · 20261015000004_functions_triggers.sql:50-56,609-629,661-663 (RPCs) · 20261016000009_negocio.sql:59-67 (my_store_ids final → MOVIDA a 00_foundation.sql §3.3) · 20261016000011_seguridad.sql:143-159,483,489-490,547 (RPC final + grants) | Order: after users + stores

-- ============================================================================
-- 1. CREATE TABLE (verbatim — 20261015000003_tables_farox.sql:199-207)
-- ============================================================================

-- 3.10 user_stores — alcance del operador (D16) ------------------------------
-- Única fuente de alcance; el dueño se auto-asocia en create_store() (D35).
-- PK compuesta indexa ambas direcciones.
CREATE TABLE public.user_stores (
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  store_id   bigint NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, store_id)
);

-- ============================================================================
-- 2. ÍNDICES
-- ============================================================================
-- NO hay CREATE INDEX explícitos (grep verificado en todas las migraciones):
-- la PK compuesta (user_id, store_id) cubre ambas direcciones de consulta
-- (nota 0003:201).

-- ============================================================================
-- 3. TRIGGERS
-- ============================================================================
-- NINGUNO (verificado por grep de CREATE TRIGGER sobre public.user_stores en
-- 0001-0012: cero resultados). Además user_stores NO tiene columna updated_at,
-- por lo que tocara fuera del alcance de touch_updated_at — el propio 0004
-- lo declara en el comentario de la fn (verbatim, 0004:250-252):
--   -- BEFORE UPDATE de todas las tablas mutables con updated_at.
--   -- (No aplica a append-only: movements, credit_payments, audit_log, chat_messages,
--   --  y a tablas sin updated_at: motives, route_stops, alerts, user_stores.)
-- Tampoco hay trigger de auditoría (el alcance D21 son 8 tablas; user_stores no está).

-- ============================================================================
-- 4. RLS (verbatim — 20261015000006_rls_grants.sql)
-- ============================================================================

ALTER TABLE public.user_stores        ENABLE ROW LEVEL SECURITY;
-- 0006:47 · RLS habilitado: SÍ

-- user_stores (§8 fila 14): policy "fila propia, admin" creada según §8, pero
-- §4 revoca SELECT (lectura canónica = my_store_ids()) ⇒ inactiva a propósito.
-- Escritura exclusiva de assign_user_stores() (A1: auto-escalada de alcance).
CREATE POLICY user_stores_select ON public.user_stores
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.my_role() = 'admin');
-- 0006:303-310 · Esperado: 1 policy — 0008:160
-- SIN policies de INSERT/UPDATE/DELETE (el DML directo está revocado abajo).

-- ============================================================================
-- 5. GRANTs / REVOKEs (verbatim)
-- ============================================================================

-- Tablas mutables por RPC/trigger (nunca directo desde el cliente):
REVOKE INSERT, UPDATE, DELETE ON
  public.stock, public.movements, public.order_items, public.orders,
  public.credits, public.credit_payments, public.price_publications,
  public.alerts, public.routes, public.route_stops, public.user_stores,
  public.dashboard_daily, public.audit_log,
  public.chat_conversations, public.chat_messages
FROM authenticated;
-- 20261015000006_rls_grants.sql:351-357 (user_stores está en la lista)

-- Lecturas selectivas: user_stores e order_items se leen solo por RPC
-- (my_store_ids, get_order_items con D40). chat_* NO se revoca — ver (1).
REVOKE SELECT ON public.user_stores, public.order_items FROM authenticated;
-- 20261015000006_rls_grants.sql:371-373

-- Contradicción (2) del encabezado de 0006 (verbatim, 0006:16-19):
--  (2) §4 revoca SELECT sobre user_stores (lectura vía my_store_ids()) pero
--      §8 define policy "fila propia, admin": se crea la policy (§8) y se
--      aplica el REVOKE (§4) — la policy queda inactiva a propósito y se
--      activa si algún día se grantea SELECT.

-- Hardening anon (verbatim — 20261016000011_seguridad.sql:545-549):
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE SELECT ON public.user_stores, public.order_items FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
-- (0011:607 es la línea equivalente COMMENTADA del bloque INVERSE de rollback, no se ejecuta)

-- Verificación V5 (0008:179-189): user_stores debe estar sin INSERT/UPDATE/DELETE
-- para authenticated — "V5 OK — DML directo revocado en las 15 tablas RPC-only + stores INSERT".

-- ============================================================================
-- 6. RPCs que operan PRIMARIAMENTE sobre user_stores (nombre + ubicación)
-- ============================================================================

-- 6.1 assign_user_stores — cuerpo FINAL (verbatim — 20261016000011_seguridad.sql:141-159;
--     original en 0004:609-629 con guard my_role() IS DISTINCT FROM 'admin').
-- Única escritura de user_stores (A1): sin esto un operador podría
-- auto-insertarse filas y escalar su propio alcance RLS.
-- NOTA (consolidación scope): se queda ACÁ, NO en 00_foundation.sql — es una
-- RPC admin (guard assert_admin(), DML sobre user_stores, granted vía
-- whitelist 0011:489 como RPC), no un helper de alcance evaluado desde RLS.
-- Los 5 helpers que SÍ invocan las policies (my_role · is_premium ·
-- my_store_ids · my_distributor_id · has_scope — 0011:480-485) viven en
-- foundation; assign_user_stores jamás se llama desde una policy.
CREATE OR REPLACE FUNCTION public.assign_user_stores(
  p_user uuid, p_stores bigint[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.assert_admin();  -- D-4
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'usuario inexistente: %', p_user;
  END IF;
  -- 1 transacción: borra los ausentes, inserta los nuevos
  DELETE FROM public.user_stores us
  WHERE us.user_id = p_user AND NOT (us.store_id = ANY (COALESCE(p_stores, '{}'::bigint[])));
  INSERT INTO public.user_stores (user_id, store_id)
  SELECT p_user, s FROM unnest(COALESCE(p_stores, '{}'::bigint[])) AS s
  ON CONFLICT DO NOTHING;
END;
$$;

-- 6.2 my_store_ids() — MOVIDA a 00_foundation.sql §3.3 (bug de orden: policies de
--     09-15 llaman my_store_ids() y esta entidad corre después). Cuerpo FINAL
--     VERBATIM 20261016000009_negocio.sql:60-67 (redef. de 0004:51-56; 0009 añade
--     el EXISTS de is_active — R3/D-3). GRANT whitelist: 0011:483.

-- 6.3 create_store(...) — tabla primaria stores; inserta la fila del dueño
--     (verbatim, 0004:661-663):
--   -- D35: el dueño obtiene alcance con el mecanismo RLS existente (user_stores)
--   INSERT INTO public.user_stores (user_id, store_id) VALUES (auth.uid(), v_id)
--   ON CONFLICT DO NOTHING;

-- GRANT EXECUTE (whitelist 0011:480-512, TO authenticated, service_role):
--   my_store_ids()        → 0011:483
--   assign_user_stores()  → 0011:489
--   create_store()        → 0011:490

-- INSERT/UPDATE/DELETE directos desde clientes: revocados (arriba). Los únicos
-- escritores son assign_user_stores() y create_store() (ambas SECURITY DEFINER).
