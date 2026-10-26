-- ============================================================================
-- FAROX — 0020: el operador con acceso a la tienda gestiona el vínculo QR.
--
-- 0017 autorizaba get_store_link_code / regenerate_store_link_code /
-- unlink_distributor solo al creador de la tienda (stores.created_by) o a un
-- admin. Un operador asignado por user_stores (por ejemplo, un trabajador de
-- la tienda) veía el error aunque tuviera el alcance real sobre la tienda.
--
-- Esta migración reemplaza SOLO el helper: las firmas de las RPC, los GRANT y
-- la protección de stores.link_code (sin SELECT directo) no cambian.
--
-- SECURITY DEFINER + SET search_path; el alcance sale del JWT, nunca de un
-- parámetro. Re-ejecutable (CREATE OR REPLACE).
--
-- COALESCE: `NULL = ANY(array)` es NULL y las RPC hacen `IF NOT helper THEN
-- RAISE`, así que `IF NOT NULL` no entra. Sin el COALESCE, un p_store NULL
-- (p. ej. una URL con un id no numérico) o un usuario sin rol activo
-- (my_role() NULL) saltaría el guard y la RPC respondería como si tuviera
-- permiso. El COALESCE cierra ambos casos con `false`.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.internal_can_manage_store(p_store bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(
    public.my_role() = 'admin'
    OR EXISTS (SELECT 1 FROM public.stores s
               WHERE s.id = p_store AND s.created_by = auth.uid() AND public.my_role() IS NOT NULL)
    OR (public.my_role() = 'operador' AND p_store = ANY (public.my_store_ids())),
    false
  );
$$;

-- INVERSE (inerte; descomentar a mano en una transacción para revertir):
-- CREATE OR REPLACE FUNCTION public.internal_can_manage_store(p_store bigint)
-- RETURNS boolean
-- LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
--   SELECT public.my_role() = 'admin'
--       OR EXISTS (SELECT 1 FROM public.stores s
--                  WHERE s.id = p_store AND s.created_by = auth.uid() AND public.my_role() IS NOT NULL);
-- $$;
