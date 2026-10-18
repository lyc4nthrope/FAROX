-- Entity: store_types | Source: 0002_tables_reused.sql:L19-26 (tabla+COMMENT), 0006_rls_grants.sql:L29 (ENABLE RLS), L76-84 (policies), 0011_seguridad.sql:L545 (REVOKE anon) | Order: after 00_foundation.sql y tras DDL de tablas cuyo helper de policies (public.my_role, 0004_functions_triggers.sql:L31-37) esté definido
-- ════════════════════════════════════════════════════════════════════════════
-- store_types — catálogo exigido por stores.store_type_id NOT NULL (§2.1).
-- Solo lectura para clientes; escritura solo admin (policy catalogs_*).
-- ════════════════════════════════════════════════════════════════════════════

-- CREATE TABLE + COMMENT — 0002_tables_reused.sql:19-26 (VERBATIM)
-- 2.1 store_types ------------------------------------------------------------
CREATE TABLE public.store_types (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.store_types IS 'Catálogo requerido por stores.store_type_id NOT NULL (§2.1)';

-- Índices — NINGUNO adicional. Grep de "CREATE INDEX|CREATE UNIQUE INDEX" en
-- supabase/migrations/ no arroja ningún índice sobre store_types: solo la PK
-- implícita y el UNIQUE inline en name (0002:22).

-- Triggers — NINGUNO. Grep de "CREATE TRIGGER" en supabase/migrations/ no
-- tiene ninguna entrada sobre store_types (la lista completa está en
-- 0004_functions_triggers.sql:397-537 y en 0009_negocio.sql:504). La tabla
-- tampoco tiene columna updated_at ⇒ no aplica touch_updated_at().

-- ============================================================================
-- RLS — 0006_rls_grants.sql (VERBATIM)
-- ENABLE (L29) + matriz catálogo (L76-84): lectura libre, escritura solo admin.
ALTER TABLE public.store_types        ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalogs_select ON public.store_types
  FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogs_insert ON public.store_types
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_update ON public.store_types
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_delete ON public.store_types
  FOR DELETE TO authenticated USING (public.my_role() = 'admin');

-- GRANTs — SIN GRANT/REVOKE explícito por tabla para store_types en ninguna
-- migración (grep de "store_types" cruzado con GRANT/REVOKE: 0 coincidencias). Hereda los
-- privilegios default de Supabase para authenticated/anon y RLS hace de filtro.
-- Única sentencia de grants que la toca (0011_seguridad.sql:545, VERBATIM):
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
-- (0011:538-544 documenta que anon pierde todo acceso a tablas de public.)

-- RPC primaria sobre esta tabla — NINGUNA. create_store()
-- (0004_functions_triggers.sql:655) solo valida existencia
-- (SELECT 1 FROM public.store_types WHERE id = p_store_type_id); su tabla
-- principal es stores, no store_types.
