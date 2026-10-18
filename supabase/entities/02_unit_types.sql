-- Entity: unit_types | Source: 0002_tables_reused.sql:L28-38 (tabla), 0006_rls_grants.sql:L28 (ENABLE RLS), L66-74 (policies), 0011_seguridad.sql:L545 (REVOKE anon) | Order: after 00_foundation.sql y tras DDL cuyo helper de policies (public.my_role, 0004_functions_triggers.sql:L31-37) esté definido
-- ════════════════════════════════════════════════════════════════════════════
-- unit_types — catálogo de unidades (name UNIQUE + abbreviation UNIQUE).
-- Consumido por products.unit_type_id (ON DELETE RESTRICT, 0002:96).
-- ════════════════════════════════════════════════════════════════════════════

-- CREATE TABLE — 0002_tables_reused.sql:28-38 (VERBATIM)
-- 2.2 unit_types -------------------------------------------------------------
CREATE TABLE public.unit_types (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text NOT NULL UNIQUE,          -- mod: NØSEE no tiene UNIQUE en name; se añade (integridad de catálogo)
  abbreviation  text NOT NULL,
  category      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_unit_types_abbreviation UNIQUE (abbreviation)
  -- §2.2: "validar unicidad en seed (§7); si pasa, añadir UNIQUE (abbreviation)".
  -- La semilla es propia de FAROX (vacío) y 0008 verifica unicidad ⇒ se añade ya.
);

-- Índices — NINGUNO adicional. Grep de "CREATE INDEX|CREATE UNIQUE INDEX" en
-- supabase/migrations/ no arroja ningún índice sobre unit_types: solo la PK
-- implícita, el UNIQUE inline en name (0002:31) y uq_unit_types_abbreviation
-- (0002:35, CONSTRAINT UNIQUE dentro del CREATE TABLE — NO es un CREATE INDEX).

-- Triggers — NINGUNO. Grep de "CREATE TRIGGER" en supabase/migrations/ no
-- tiene ninguna entrada sobre unit_types (lista completa: 0004:397-537 y
-- 0009:504). Sin columna updated_at ⇒ no aplica touch_updated_at().

-- ============================================================================
-- RLS — 0006_rls_grants.sql (VERBATIM)
-- ENABLE (L28) + matriz catálogo (L66-74): lectura libre, escritura solo admin.
ALTER TABLE public.unit_types         ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalogs_select ON public.unit_types
  FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogs_insert ON public.unit_types
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_update ON public.unit_types
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_delete ON public.unit_types
  FOR DELETE TO authenticated USING (public.my_role() = 'admin');

-- GRANTs — SIN GRANT/REVOKE explícito por tabla para unit_types en ninguna
-- migración (grep "unit_types" cruzado con GRANT/REVOKE: 0 coincidencias).
-- Única sentencia de grants que la toca (0011_seguridad.sql:545, VERBATIM):
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
-- (0011:538-544: anon pierde todo acceso a tablas de public; authenticated
-- conserva los privilegios default de Supabase y RLS hace de filtro.)

-- RPC primaria sobre esta tabla — NINGUNA. Solo se lee en seeds (0005:28-32),
-- verificaciones (0008:279-310, 0012:165-166) y como FK de products.
