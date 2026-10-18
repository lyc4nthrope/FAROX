-- Entity: products | Source: 20261015000002_tables_reused.sql:89-120 (CREATE TABLE + índice único + índices diferidos) · 20261015000004_functions_triggers.sql:418-421,504-507 (triggers) · 20261015000006_rls_grants.sql:33,137-158 (RLS + policies) · 20261016000011_seguridad.sql:545-546 (lockdown anon) | Order: after product_categories + brands + unit_types + users (created_by)

-- ============================================================================
-- 1. CREATE TABLE (verbatim — 20261015000002_tables_reused.sql:89-111)
-- ============================================================================

-- 2.6 products ---------------------------------------------------------------
CREATE TABLE public.products (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL,
  description     text NULL,                                -- FAROX: el .md la pide; NØSEE no la tiene
  category_id     integer NOT NULL REFERENCES public.product_categories(id) ON DELETE RESTRICT,
  brand_id        bigint NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,  -- mod: NØSEE CASCADE → RESTRICT (D14)
  unit_type_id    integer NOT NULL REFERENCES public.unit_types(id) ON DELETE RESTRICT,
  created_by      uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,     -- FAROX (D36); backfill al admin en la carga de datos
  base_quantity   numeric(12,3) NOT NULL CHECK (base_quantity > 0),
  barcode         text NULL,                                -- D6/D42: no existe SKU; el QR asocia tienda↔distribuidor
  is_active       boolean NOT NULL DEFAULT true,
  -- mod: bug corregido — coalesce evita el NULL que devolvía name ∥ description sin descripción
  search_vector   tsvector GENERATED ALWAYS AS (
                    to_tsvector('spanish', coalesce(name, '') || ' ' || coalesce(description, ''))
                  ) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_barcode_length_check
    CHECK (barcode IS NULL OR (char_length(trim(barcode)) >= 4 AND char_length(trim(barcode)) <= 64))
    -- check conservado del catálogo NØSEE (fidelidad; el doc no lo contradice)
  -- Eliminadas de NØSEE: is_admin_hidden + 6 columnas hidden_*
);

-- ============================================================================
-- 2. ÍNDICES (verbatim — 20261015000002_tables_reused.sql:113-120)
-- ============================================================================

-- Índice único funcional de barcode (§2.6 — copia del de NØSEE, normaliza
-- espacios/puntuación y permite repetidos salvo colisión tras normalizar)
CREATE UNIQUE INDEX uq_products_barcode
  ON public.products (lower(regexp_replace(barcode, '[^a-zA-Z0-9]', '', 'g')))
  WHERE barcode IS NOT NULL AND length(trim(barcode)) > 0;

-- Diferidos (§5/D22): gin(search_vector), gin(name gin_trgm_ops) + pg_trgm (~50.000 productos),
-- btree(created_by). El front nunca trae search_vector en listados (select= explícito).

-- VERIFICADO por grep en TODAS las migraciones: uq_products_barcode es el ÚNICO
-- índice (no-PK) sobre products; los GIN/btree de la nota quedaron diferidos y
-- NO se crearon (0010 solo añade idx_stock_expiry/idx_orders_expected_open/idx_alerts_store_open).

-- ============================================================================
-- 3. TRIGGERS (verbatim — 20261015000004_functions_triggers.sql)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON public.products FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();
-- 0004:418-421 · fn touch_updated_at: 0004:253-259 (compartida, NO duplicada acá)

DROP TRIGGER IF EXISTS trg_audit_products ON public.products;
CREATE TRIGGER trg_audit_products
AFTER INSERT OR UPDATE OR DELETE ON public.products FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();
-- 0004:504-507 · fn audit_diff: 0004:266-294, redefinida (R10, mismo semántica) en 20261016000010_perf.sql:283-315

-- ============================================================================
-- 4. RLS (verbatim — 20261015000006_rls_grants.sql)
-- ============================================================================

ALTER TABLE public.products           ENABLE ROW LEVEL SECURITY;
-- 0006:33 · RLS habilitado: SÍ

-- products (§8 fila 2): catálogo de uso general
-- INSERT: admin · operador con has_scope() (D37 se suma en globales).
-- UPDATE: admin · SOLO el creador (D36), con has_scope(); el WITH CHECK
--   impide transferir la propiedad (created_by debe seguir siendo el suyo).
-- DELETE: admin sobre filas ya desactivadas (soft → purge).
CREATE POLICY products_select ON public.products
  FOR SELECT TO authenticated USING (true);
CREATE POLICY products_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.my_role() = 'admin'
              OR (public.my_role() = 'operador' AND public.has_scope()));
CREATE POLICY products_update ON public.products
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin'
         OR (created_by = auth.uid() AND public.has_scope()))
  WITH CHECK (public.my_role() = 'admin'
              OR (created_by = auth.uid() AND public.has_scope()));
CREATE POLICY products_delete ON public.products
  FOR DELETE TO authenticated
  USING (public.my_role() = 'admin' AND is_active = false);
-- 0006:137-158 · Esperado: 4 policies — 0008:156

-- ============================================================================
-- 5. GRANTs / REVOKEs
-- ============================================================================
-- NO existe ningún GRANT/REVOKE de tabla o columna específico para products
-- (grep verificado de GRANT|REVOKE en 0005-0012): privilegios default de
-- Supabase para authenticated, acotados por las policies de arriba.
-- Único grant que lo cubre implícitamente (verbatim — 20261016000011_seguridad.sql:545-546):
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- ============================================================================
-- 6. RPCs que operan PRIMARIAMENTE sobre products
-- ============================================================================
-- NINGUNA (grep de INSERT|UPDATE|DELETE ... public.products: solo fixtures de
-- 0012_verify_hardening.sql:861,1204). El CRUD de products es directo vía
-- PostgREST + las 4 policies (INSERT/UPDATE/DELETE de catálogo).
-- OJO con la confusión frecuente: assign_product_to_store() NO muta products —
-- escribe en stock (0004:673-693 / 0011:361-381) y por eso vive en el entity de stock.
-- create_order solo LEE products (validación is_active: 0009:358, 0010:240).
