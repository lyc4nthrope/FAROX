-- Entity: product_categories | Source: 0002_tables_reused.sql:L59-67 (tabla), 0004_functions_triggers.sql:L428-431 (trigger), 0006_rls_grants.sql:L31 (ENABLE RLS), L110-120 (policies), 0011_seguridad.sql:L545 (REVOKE anon) | Order: after 00_foundation.sql (touch_updated_at) y tras DDL cuyo helper de policies (public.my_role, 0004:L31-37) esté definido
-- ════════════════════════════════════════════════════════════════════════════
-- product_categories — catálogo jerárquico auto-referente (parent_id SET NULL,
-- D5). FK de products.category_id (ON DELETE RESTRICT, 0002:94). NO tiene
-- is_active ⇒ el DELETE de policy es duro (protegido por las FK RESTRICT).
-- ════════════════════════════════════════════════════════════════════════════

-- CREATE TABLE — 0002_tables_reused.sql:59-67 (VERBATIM)
-- 2.5 product_categories -----------------------------------------------------
CREATE TABLE public.product_categories (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  description text,
  parent_id   integer NULL REFERENCES public.product_categories(id) ON DELETE SET NULL,  -- FAROX (D5): nullable ⇒ funciona plana
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Índices — NINGUNO adicional. Grep de "CREATE INDEX|CREATE UNIQUE INDEX" en
-- supabase/migrations/ no arroja ningún índice sobre product_categories: solo
-- la PK implícita, el UNIQUE inline en name (0002:62) y la FK auto-referente
-- parent_id (0002:64) — PG NO crea índice para una FK con ON DELETE SET NULL.

-- ============================================================================
-- Triggers — 0004_functions_triggers.sql:428-431 (VERBATIM) — PRESENTE (1)
-- Solo updated_at; NO tiene audit_diff (alcance D21 = 8 tablas, 0004:498-537).
DROP TRIGGER IF EXISTS trg_product_categories_updated_at ON public.product_categories;
CREATE TRIGGER trg_product_categories_updated_at
BEFORE UPDATE ON public.product_categories FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- RLS — 0006_rls_grants.sql (VERBATIM)
-- ENABLE (L31) + matriz catálogo (L110-120).
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

-- product_categories no tiene is_active (catálogo jerárquico; las FK RESTRICT
-- de products y el SET NULL de parent_id protegen las filas con historial).
CREATE POLICY catalogs_select ON public.product_categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogs_insert ON public.product_categories
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_update ON public.product_categories
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_delete ON public.product_categories
  FOR DELETE TO authenticated USING (public.my_role() = 'admin');

-- GRANTs — SIN GRANT/REVOKE explícito por tabla para product_categories en
-- ninguna migración (grep "public\.product_categories" cruzado con
-- GRANT/REVOKE: 0 coincidencias). Única sentencia de grants que la toca
-- (0011_seguridad.sql:545, VERBATIM):
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
-- (0011:538-544: anon pierde todo acceso a tablas de public.)

-- RPC primaria sobre esta tabla — NINGUNA. Solo se siembra (0005:43-50, padres
-- antes que hijos), se lee como FK de products y se verifica en
-- 0008:281/294-295 y 0012:161-162.
