-- Entity: brands | Source: 0002_tables_reused.sql:L48-57 (tabla), 0004_functions_triggers.sql:L423-426 (trigger), 0006_rls_grants.sql:L30 (ENABLE RLS), L86-97 (policies), 0011_seguridad.sql:L545 (REVOKE anon) | Order: after 00_foundation.sql (touch_updated_at) y tras DDL cuyo helper de policies (public.my_role, 0004:L31-37) esté definido
-- ════════════════════════════════════════════════════════════════════════════
-- brands — catálogo de marcas, con updated_at mutable ⇒ trigger
-- touch_updated_at(). FK de products.brand_id (ON DELETE RESTRICT, 0002:95).
-- ════════════════════════════════════════════════════════════════════════════

-- CREATE TABLE — 0002_tables_reused.sql:48-57 (VERBATIM)
-- 2.4 brands -----------------------------------------------------------------
CREATE TABLE public.brands (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()   -- mod: updated_at añadido (mutable)
  -- Eliminadas de NØSEE: is_admin_hidden + hidden_public_at/by/reason + hidden_admin_at/by/reason
  -- (7 columnas de moderación de la app comunitaria; el doc las nombra "6 columnas").
);

-- Índices — NINGUNO adicional. Grep de "CREATE INDEX|CREATE UNIQUE INDEX" en
-- supabase/migrations/ no arroja ningún índice sobre brands: solo la PK
-- implícita y el UNIQUE inline en name (0002:51).

-- ============================================================================
-- Triggers — 0004_functions_triggers.sql:423-426 (VERBATIM) — PRESENTE (1)
-- Solo updated_at; NO tiene audit_diff (alcance D21 = 8 tablas, 0004:498-537).
DROP TRIGGER IF EXISTS trg_brands_updated_at ON public.brands;
CREATE TRIGGER trg_brands_updated_at
BEFORE UPDATE ON public.brands FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- RLS — 0006_rls_grants.sql (VERBATIM)
-- ENABLE (L30) + matriz catálogo (L86-97). DELETE = soft: solo filas
-- ya desactivadas (is_active = false).
ALTER TABLE public.brands             ENABLE ROW LEVEL SECURITY;

-- brands/motives tienen is_active ⇒ el DELETE de la matriz es soft:
-- solo purga filas ya desactivadas.
CREATE POLICY catalogs_select ON public.brands
  FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogs_insert ON public.brands
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_update ON public.brands
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_delete ON public.brands
  FOR DELETE TO authenticated
  USING (public.my_role() = 'admin' AND is_active = false);

-- GRANTs — SIN GRANT/REVOKE explícito por tabla para brands en ninguna
-- migración (grep "public\.brands" cruzado con GRANT/REVOKE: 0 coincidencias).
-- Única sentencia de grants que la toca (0011_seguridad.sql:545, VERBATIM):
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
-- (0011:538-544: anon pierde todo acceso a tablas de public.)

-- RPC primaria sobre esta tabla — NINGUNA. Solo se siembra (0005:54), se lee
-- como FK de products y se verifica en 0008:282/297-298 y 0012:163-164.
