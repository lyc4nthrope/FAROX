-- Entity: roles | Source: 0002_tables_reused.sql:L40-46 (tabla), 0006_rls_grants.sql:L27 (ENABLE RLS), L56-64 (policies), 0011_seguridad.sql:L545 (REVOKE anon) | Order: after 00_foundation.sql y tras DDL cuyo helper de policies (public.my_role, 0004_functions_triggers.sql:L31-37) esté definido; seed en 0005:18
-- ════════════════════════════════════════════════════════════════════════════
-- roles — catálogo de roles (admin/operador/distribuidor, seed 0005:18).
-- FK de users.role_id (ON DELETE RESTRICT, 0002:73). Es la columna que toda
-- policy RLS resuelve vía public.my_role().
-- ════════════════════════════════════════════════════════════════════════════

-- CREATE TABLE — 0002_tables_reused.sql:40-46 (VERBATIM)
-- 2.3 roles ------------------------------------------------------------------
CREATE TABLE public.roles (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Índices — NINGUNO adicional. Grep de "CREATE INDEX|CREATE UNIQUE INDEX" en
-- supabase/migrations/ no arroja ningún índice sobre roles: solo la PK
-- implícita y el UNIQUE inline en name (0002:43).

-- Triggers — NINGUNO. Grep de "CREATE TRIGGER" en supabase/migrations/ no
-- tiene ninguna entrada sobre roles (lista completa: 0004:397-537, 0009:504).
-- Sin columna updated_at ⇒ no aplica touch_updated_at(). La auditoría
-- audit_diff() tampoco la cubre (alcance D21 = 8 tablas, 0004:498-537).

-- ============================================================================
-- RLS — 0006_rls_grants.sql (VERBATIM)
-- ENABLE (L27) + matriz catálogo (L56-64): lectura libre, escritura solo admin.
ALTER TABLE public.roles              ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalogs_select ON public.roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogs_insert ON public.roles
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_update ON public.roles
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_delete ON public.roles
  FOR DELETE TO authenticated USING (public.my_role() = 'admin');

-- GRANTs — SIN GRANT/REVOKE explícito por tabla para roles en ninguna
-- migración (grep "public\.roles" cruzado con GRANT/REVOKE: 0 coincidencias).
-- Única sentencia de grants que la toca (0011_seguridad.sql:545, VERBATIM):
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
-- (0011:538-544: anon pierde todo acceso a tablas de public.)

-- Funciones que operan sobre esta tabla — NINGUNA RPC la MUTA (las filas se
-- siembran en 0005:18; update_user_role() escribe users, no roles). Lectoras:
--   · my_role()           0004_functions_triggers.sql:31-37 (redef. 0009:40-46)
--   · is_premium()        0004:40-48 (redef. 0009:49-57)
--   · has_scope()         0004:65-76 (redef. 0009:77-89)
--   · sanitize_distributor_scope() 0004:310-325 (trigger de users, lee roles)
--   · handle_new_user()   0004:330-348 (exige rol "operador" sembrado)
--   · update_user_role()  0004:544-569 · versión final 0011_seguridad.sql:85-108
--   · assert_admin()      0011_seguridad.sql:47 (JOIN roles en :63)
