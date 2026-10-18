-- Entity: distributors | Source: 20261015000003_tables_farox.sql:12-24 (CREATE TABLE) · 20261015000004_functions_triggers.sql:468-471,514-517 (triggers) · 20261015000006_rls_grants.sql:38,122-135 (RLS + policies) · 20261016000011_seguridad.sql:545-546 (lockdown anon) | Order: after contact_preference (enum, 0001) — sin FKs a otras tablas de negocio

-- ============================================================================
-- 1. CREATE TABLE (verbatim — 20261015000003_tables_farox.sql:12-24)
-- ============================================================================

-- 3.2 distributors (antes que users/movements por FKs) -----------------------
CREATE TABLE public.distributors (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                text NOT NULL,
  nit                 text NOT NULL UNIQUE,      -- "NIT obligatorio" sólo se cumple con UNIQUE (corregido)
  contact_name        text,
  phone               text,
  email               text,
  contact_preference  public.contact_preference NOT NULL DEFAULT 'whatsapp',
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. ÍNDICES
-- ============================================================================
-- NO hay CREATE INDEX explícitos sobre distributors (grep verificado en todas
-- las migraciones): solo la PK (id) y el UNIQUE inline de nit (línea 16 arriba).

-- ============================================================================
-- 3. TRIGGERS (verbatim — 20261015000004_functions_triggers.sql)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_distributors_updated_at ON public.distributors;
CREATE TRIGGER trg_distributors_updated_at
BEFORE UPDATE ON public.distributors FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();
-- 0004:468-471 · fn touch_updated_at: 0004:253-259 (compartida, NO duplicada acá)

DROP TRIGGER IF EXISTS trg_audit_distributors ON public.distributors;
CREATE TRIGGER trg_audit_distributors
AFTER INSERT OR UPDATE OR DELETE ON public.distributors FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();
-- 0004:514-517 · fn audit_diff: 0004:266-294, redefinida (R10) en 20261016000010_perf.sql:283-315

-- ============================================================================
-- 4. RLS (verbatim — 20261015000006_rls_grants.sql)
-- ============================================================================

ALTER TABLE public.distributors       ENABLE ROW LEVEL SECURITY;
-- 0006:38 · RLS habilitado: SÍ

-- distributors (§8 fila 4): solo admin y operador lo ven; escritura admin
CREATE POLICY distributors_select ON public.distributors
  FOR SELECT TO authenticated
  USING (public.my_role() IN ('admin', 'operador'));
CREATE POLICY distributors_insert ON public.distributors
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'admin');
CREATE POLICY distributors_update ON public.distributors
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
CREATE POLICY distributors_delete ON public.distributors
  FOR DELETE TO authenticated
  USING (public.my_role() = 'admin' AND is_active = false);
-- 0006:122-135 · Esperado: 4 policies — 0008:156

-- ============================================================================
-- 5. GRANTs / REVOKEs
-- ============================================================================
-- NO existe ningún GRANT/REVOKE de tabla o columna específico para
-- distributors en las migraciones (grep verificado de GRANT|REVOKE en
-- 0005-0012): sus privilegios son los defaults de Supabase para
-- authenticated/select-update-delete, acotados por las policies de arriba.
-- Único grant que lo cubre implícitamente (verbatim — 20261016000011_seguridad.sql:545-546):
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- ============================================================================
-- 6. RPCs que operan PRIMARIAMENTE sobre distributors
-- ============================================================================
-- NINGUNA (verificado por grep de INSERT|UPDATE|DELETE INTO public.distributors:
-- solo aparecen fixtures de 0012_verify_hardening.sql:857). distributors se
-- muta directamente vía PostgREST + policies (admin).
-- Existen solo validaciones de existencia/estado DENTRO de otras RPC:
--   create_order → 0004:904-906 (0004); R5.2 is_active → 0009:345; 0010:214
--   my_distributor_id() lee users.distributor_id, no esta tabla (0004:58-61 / 0009:69-73)
