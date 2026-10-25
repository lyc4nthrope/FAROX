-- ============================================================================
-- FAROX — 0019: catálogo de productos por rol (tienda / distribuidor / admin).
--
-- PROBLEMA: /products mostraba el catálogo global a todos los roles. La tienda
-- y el distribuidor deben ver SOLO los productos que manejan/venden, eligiéndolos
-- del registro global que sigue siendo legible por todos (products_select USING
-- true, 0006:144-145).
--
-- MODELO (sin duplicar fuentes de verdad):
--   · Tienda (rol operador): su catálogo ES la asignación stock (producto ↔
--     tienda). El alta ya existe: assign_product_to_store (0011:361-381). Esta
--     migración agrega SOLO la baja, y únicamente cuando quantity = 0: borrar
--     una fila de stock con existencias perdería inventario.
--   · Distribuidor: no existía relación producto ↔ distribuidor. Se agrega
--     distributor_products + add/remove_distributor_product. El alcance sale del
--     JWT (my_distributor_id()), nunca de un parámetro.
--   · Admin: sin cambios de lectura; sigue viendo el catálogo global completo.
--
-- Reglas: SECURITY DEFINER + SET search_path; RLS habilitada; DML de tabla
-- revocado a authenticated (escritura solo por RPC); GRANT EXECUTE explícito
-- solo a authenticated/service_role (deny-by-default, D48).
-- Nota whitelist: +3 firmas. Re-ejecutar 0012 después dará FAIL esperado en el
-- conteo exacto de la whitelist (mismo efecto ya documentado para 0017/0018).
-- ============================================================================

-- ============================================================================
-- 1. distributor_products — catálogo propio del distribuidor
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.distributor_products (
  distributor_id bigint NOT NULL REFERENCES public.distributors (id) ON DELETE CASCADE,
  product_id     bigint NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  created_by     uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (distributor_id, product_id)
);

-- La PK cubre "catálogo de mi distribuidor"; este índice cubre "qué
-- distribuidores venden este producto".
CREATE INDEX IF NOT EXISTS idx_distributor_products_product
  ON public.distributor_products (product_id);

ALTER TABLE public.distributor_products ENABLE ROW LEVEL SECURITY;

-- Lectura: admin todo · distribuidor solo su catálogo. Sin policies de
-- INSERT/UPDATE/DELETE: el DML directo está revocado (solo RPCs de abajo).
DROP POLICY IF EXISTS distributor_products_select ON public.distributor_products;
CREATE POLICY distributor_products_select ON public.distributor_products
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'distribuidor'
             AND distributor_id = public.my_distributor_id()));

REVOKE ALL ON public.distributor_products FROM anon, authenticated;
GRANT SELECT ON public.distributor_products TO authenticated;

-- ============================================================================
-- 2. RPCs del catálogo del distribuidor
-- ============================================================================
CREATE OR REPLACE FUNCTION public.add_distributor_product(p_product bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_dist bigint := public.my_distributor_id();
BEGIN
  IF public.my_role() IS DISTINCT FROM 'distribuidor' OR v_dist IS NULL THEN
    RAISE EXCEPTION 'catalogo: solo un distribuidor activo puede agregar productos';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products WHERE id = p_product AND is_active
  ) THEN
    RAISE EXCEPTION 'catalogo: producto inexistente o inactivo';
  END IF;
  INSERT INTO public.distributor_products (distributor_id, product_id, created_by)
  VALUES (v_dist, p_product, auth.uid())
  ON CONFLICT (distributor_id, product_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_distributor_product(p_product bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_dist bigint := public.my_distributor_id();
BEGIN
  IF public.my_role() IS DISTINCT FROM 'distribuidor' OR v_dist IS NULL THEN
    RAISE EXCEPTION 'catalogo: solo un distribuidor activo puede quitar productos';
  END IF;
  DELETE FROM public.distributor_products
  WHERE distributor_id = v_dist AND product_id = p_product;
END;
$$;

-- ============================================================================
-- 3. Baja del catálogo de una tienda (stock con quantity = 0)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.unassign_product_from_store(
  p_product bigint, p_store bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');  -- '' no es rol ⇒ NOT IN rechaza
  v_qty  numeric(12,3);
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'unassign_product_from_store: solo admin/operador';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'unassign_product_from_store: tienda fuera del alcance del operador';
  END IF;
  SELECT quantity INTO v_qty
  FROM public.stock
  WHERE product_id = p_product AND store_id = p_store
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unassign_product_from_store: el producto no está asignado a la tienda';
  END IF;
  IF v_qty > 0 THEN
    RAISE EXCEPTION 'unassign_product_from_store: no se puede quitar un producto con existencias (%)', v_qty;
  END IF;
  DELETE FROM public.stock WHERE product_id = p_product AND store_id = p_store;
END;
$$;

-- ============================================================================
-- 4. Grants (deny-by-default: solo estas firmas nuevas quedan ejecutables)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.add_distributor_product(bigint),
  public.remove_distributor_product(bigint),
  public.unassign_product_from_store(bigint, bigint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.add_distributor_product(bigint),
  public.remove_distributor_product(bigint),
  public.unassign_product_from_store(bigint, bigint)
  TO authenticated, service_role;

-- INVERSE (inerte; descomentar a mano en una transacción para revertir):
-- REVOKE EXECUTE ON FUNCTION public.unassign_product_from_store(bigint, bigint) FROM authenticated, service_role;
-- REVOKE EXECUTE ON FUNCTION public.remove_distributor_product(bigint) FROM authenticated, service_role;
-- REVOKE EXECUTE ON FUNCTION public.add_distributor_product(bigint) FROM authenticated, service_role;
-- DROP FUNCTION IF EXISTS public.unassign_product_from_store(bigint, bigint);
-- DROP FUNCTION IF EXISTS public.remove_distributor_product(bigint);
-- DROP FUNCTION IF EXISTS public.add_distributor_product(bigint);
-- DROP TABLE IF EXISTS public.distributor_products;
