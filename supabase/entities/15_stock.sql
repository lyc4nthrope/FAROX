-- Entity: stock | Source: 0003_tables_farox.sql:L35-55 (tabla+índice+ALTER fillfactor), 0004_functions_triggers.sql:L463-466 (trg_updated_at), L126-158 (internal_eval_stock_alert), L673-693 (assign_product_to_store), L1362-1387 (get_stock → MOVIDA a 30_negocio.sql §11), 0006_rls_grants.sql:L40 (RLS), L232-244 (policy stock_select → MOVIDA a 90_security.sql §4ter), L351-357 (REVOKE → CONSOLIDADO en 90_security.sql §4bis), 0010_perf.sql:L366-368 (idx_stock_expiry), 0011_seguridad.sql:L361-381 (assign_product_to_store final) | Order: after products, stores, alerts (eval), motives (vía movements)

-- ============================================================================
-- stock — asignación Producto ↔ Tienda (PK compuesta). La tabla con más UPDATEs
-- del sistema (1 UPDATE por movimiento). Escritura solo vía RPC (register_*,
-- assign_product_to_store); alerta stock_low evaluada en transiciones (INV-06/D24).
-- ============================================================================

-- CREATE TABLE — 0003_tables_farox.sql:36-45 (VERBATIM)
CREATE TABLE public.stock (
  product_id   bigint NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  store_id     bigint NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  quantity     numeric(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  threshold    numeric(12,3) NULL DEFAULT NULL
               CHECK (threshold IS NULL OR threshold >= 0),  -- D28: NULL = sin punto de pedido (DEFAULT 0 causaba alerta masiva)
  expiry_date  date NULL,   -- caducidad vigente del par (aproximación D30; FEFO fuera de alcance)
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, store_id)
);

-- Índice — 0003_tables_farox.sql:47-49 (VERBATIM)
-- La PK solo cubre filtros por product_id; el dashboard consulta "stock de esta tienda"
CREATE INDEX idx_stock_store ON public.stock (store_id);
-- Sin índice parcial WHERE quantity <= threshold: condición volátil (D11) — la señal se materializa en alerts.

-- Reemplaza al índice viejo sobre movements — 0010_perf.sql:366-368 (VERBATIM)
-- R8: el job diario (job_scan_expiry_soon) escanea PUBLIC.STOCK (s.expiry_date...),
-- NO movements — idx_movements_expiry (0003) jamás lo alimentaba.
DROP INDEX IF EXISTS public.idx_movements_expiry;
CREATE INDEX IF NOT EXISTS idx_stock_expiry
  ON public.stock (expiry_date) WHERE expiry_date IS NOT NULL;

-- Tuning tabla con más UPDATEs — 0003_tables_farox.sql:51-55 (VERBATIM)
ALTER TABLE public.stock SET (
  fillfactor = 85,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);  -- la tabla con más UPDATEs del sistema (1 UPDATE por movimiento)

-- Triggers — 0004_functions_triggers.sql:463-466 (VERBATIM). Solo updated_at.
-- Sin trg_audit_* : stock NO está en el alcance D21 de 8 tablas auditadas.
DROP TRIGGER IF EXISTS trg_stock_updated_at ON public.stock;
CREATE TRIGGER trg_stock_updated_at
BEFORE UPDATE ON public.stock FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- RLS — 0006_rls_grants.sql
-- ENABLE (L40). Policy (L232-244, VERBATIM): SELECT admin · operador (sus tiendas)
-- · distribuidor (tiendas de sus pedidos O de su ruta). Escritura solo RPC.
ALTER TABLE public.stock ENABLE ROW LEVEL SECURITY;

-- Policy stock_select: CONSOLIDADA en 90_security.sql (§4ter) — VERBATIM
-- 0006:232-244. El cuerpo de una policy se analiza AL CREARLA y este hace
-- EXISTS contra public.route_stops (18) y public.routes (17), posteriores a
-- esta entidad: acá rompería el paste. Ver 90_security.sql.

-- GRANTs — 0006_rls_grants.sql:351-357 (REVOKE DML, VERBATIM parcial): INSERT/UPDATE/DELETE
-- a authenticated (escritura pasa por RPC SECURITY DEFINER). SELECT no se revoca (policy stock_select).
-- REVOKE global de las 15 tablas RPC-only: CONSOLIDADO en 90_security.sql
-- (0006:351-357, VERBATIM). Acá NO se repite: en orden de entidad el bloque
-- referenciaría tablas que aun no existen (forward refs).

-- ============================================================================
-- RPCs SOBRE ESTA TABLA (estado FINAL = última migración)
-- assign_product_to_store — crea/actualiza stock + evalúa stock_low (INV-03).
-- Versión FINAL en 0011_seguridad.sql:361-381 (guard COALESCE NULL-safe D-4; supera
-- a 0004:673-693). Toca stock + alerts (vía internal_eval_stock_alert).
CREATE OR REPLACE FUNCTION public.assign_product_to_store(
  p_product bigint, p_store bigint, p_threshold numeric(12,3) DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');  -- D-4: '' no es ningún rol ⇒ NOT IN rechaza
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'assign_product_to_store: solo admin/operador';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'assign_product_to_store: tienda fuera del alcance del operador';
  END IF;
  INSERT INTO public.stock AS st (product_id, store_id, threshold)
  VALUES (p_product, p_store, p_threshold)
  ON CONFLICT (product_id, store_id) DO UPDATE
  SET threshold = COALESCE(EXCLUDED.threshold, st.threshold),  -- NULL no borra umbral existente
      updated_at = now();
  PERFORM public.internal_eval_stock_alert(p_store, p_product);
END;
$$;
-- GRANT EXECUTE assign_product_to_store(bigint, bigint, numeric(12,3)) TO authenticated, service_role — 0011:491.

-- get_stock: MOVIDA a 30_negocio.sql (§11) — es LANGUAGE sql, su cuerpo se
-- analiza AL CREARLA y referencia public.routes (17) y public.route_stops (18),
-- posteriores a esta entidad. Versión VERBATIM 0004:1362-1387 allí.
-- internal_stock_entry / register_entry / register_exit / confirm_delivery / register_reverse
-- mutan stock ⇒ MULTI-ENTIDAD, ver NEGOCIO.
