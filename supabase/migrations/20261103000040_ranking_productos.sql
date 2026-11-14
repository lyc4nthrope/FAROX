-- ============================================================================
-- FAROX — 0040: ranking de productos por ventas para el ticket de movimientos.
--
-- La lista de productos del ticket se ordena por unidades vendidas en una
-- ventana (90 días por defecto), así lo que más rota aparece primero. Los
-- productos sin ventas conservan el orden alfabético del front.
--
-- Alcance desde el JWT, igual que el resto:
--   · admin/operador: salidas (type = 'exit') de la tienda pedida.
--   · distribuidor: sus ventas (type = 'entry' con su distributor_id).
-- Se excluyen los movimientos ya revertidos.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.movement_product_ranking(
  p_store bigint,
  p_days  integer DEFAULT 90
) RETURNS TABLE (product_id bigint, quantity numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH params AS (
    SELECT now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days, 90), 365))) AS since
  )
  SELECT m.product_id, sum(m.quantity) AS quantity
  FROM public.movements m
  CROSS JOIN params p
  WHERE m.created_at >= p.since
    AND NOT EXISTS (
      SELECT 1 FROM public.movements r WHERE r.reverso_of_id = m.id
    )
    AND (
      (
        public.my_role() IN ('admin', 'operador')
        AND p_store IS NOT NULL
        AND m.store_id = p_store
        AND m.type = 'exit'
        AND (public.my_role() = 'admin' OR p_store = ANY (public.my_store_ids()))
      )
      OR (
        public.my_role() = 'distribuidor'
        AND p_store IS NULL
        AND m.distributor_id = public.my_distributor_id()
        AND m.type = 'entry'
      )
    )
  GROUP BY m.product_id
  ORDER BY sum(m.quantity) DESC
  LIMIT 200;
$$;

REVOKE EXECUTE ON FUNCTION
  public.movement_product_ranking(bigint, integer)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.movement_product_ranking(bigint, integer)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · Como operador: movement_product_ranking(<mi tienda>) devuelve los
--     productos con más salidas primero.
--   · Como distribuidor: movement_product_ranking(NULL) devuelve sus ventas.
--   · movement_product_ranking(<tienda ajena>) ⇒ vacío (no excepción).
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   DROP FUNCTION IF EXISTS public.movement_product_ranking(bigint, integer);
