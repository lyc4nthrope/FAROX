-- ============================================================================
-- FAROX — 0026: edición y alta de productos de una tienda en UNA llamada.
--
-- La vista de inventario unificada edita el producto de la tienda en un modal
-- (cantidad, umbral) y guarda una sola vez. Antes cada campo disparaba su
-- propia RPC (set_store_product_quantity / set_stock_threshold) y la tabla
-- mostraba un botón «Guardar» por celda.
--
--   · update_store_product: cantidad + umbral + faltante en una sola sentencia.
--   · add_store_product: asigna el producto a la tienda con la cantidad
--     inicial elegida (si ya está asignado, no pisa nada).
--
-- Ambas conservan la semántica de 0022: NO crean movimientos; re-evalúan la
-- alerta de stock. Reglas del repo: SECURITY DEFINER + SET search_path; alcance
-- desde el JWT, nunca desde parámetros; GRANT explícito.
-- ============================================================================

-- ============================================================================
-- 1. update_store_product — un solo UPDATE para todo lo editable del par.
--    p_shortage NULL conserva el valor actual.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_store_product(
  p_product bigint,
  p_store bigint,
  p_quantity numeric(12,3),
  p_threshold numeric(12,3) DEFAULT NULL,
  p_shortage boolean DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'update_store_product: solo admin/operador';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'update_store_product: tienda fuera del alcance del operador';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'update_store_product: la cantidad no puede ser negativa';
  END IF;
  IF p_threshold IS NOT NULL AND p_threshold < 0 THEN
    RAISE EXCEPTION 'update_store_product: el umbral no puede ser negativo';
  END IF;
  UPDATE public.stock s
  SET quantity = p_quantity,
      threshold = p_threshold,
      is_shortage = COALESCE(p_shortage, s.is_shortage),
      updated_at = now()
  WHERE s.store_id = p_store AND s.product_id = p_product;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_store_product: el producto % no está asignado a la tienda %',
      p_product, p_store;
  END IF;
  PERFORM public.internal_eval_stock_alert(p_store, p_product);
END;
$$;

-- ============================================================================
-- 2. add_store_product — alta con cantidad inicial en una sentencia.
--    Si el producto ya estaba asignado, ON CONFLICT DO NOTHING: la cantidad
--    existente no se pisa por accidente.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.add_store_product(
  p_product bigint,
  p_store bigint,
  p_quantity numeric(12,3) DEFAULT 0,
  p_threshold numeric(12,3) DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'add_store_product: solo admin/operador';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'add_store_product: tienda fuera del alcance del operador';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'add_store_product: la cantidad no puede ser negativa';
  END IF;
  IF p_threshold IS NOT NULL AND p_threshold < 0 THEN
    RAISE EXCEPTION 'add_store_product: el umbral no puede ser negativo';
  END IF;
  INSERT INTO public.stock (product_id, store_id, quantity, threshold)
  VALUES (p_product, p_store, p_quantity, p_threshold)
  ON CONFLICT (product_id, store_id) DO NOTHING;
  PERFORM public.internal_eval_stock_alert(p_store, p_product);
END;
$$;

-- ============================================================================
-- 3. Grants (deny-by-default: solo las firmas nuevas)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.update_store_product(bigint, bigint, numeric, numeric, boolean),
  public.add_store_product(bigint, bigint, numeric, numeric)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.update_store_product(bigint, bigint, numeric, numeric, boolean),
  public.add_store_product(bigint, bigint, numeric, numeric)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · update_store_product cambia cantidad, umbral y faltante de una vez.
--   · update_store_product sobre un producto no asignado ⇒ excepción.
--   · add_store_product asigna con cantidad inicial y umbral.
--   · add_store_product repetido NO cambia la cantidad existente.
--   · Ninguna de las dos crea filas en movements (misma regla que 0022).
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   DROP FUNCTION IF EXISTS public.update_store_product(bigint, bigint, numeric, numeric, boolean);
--   DROP FUNCTION IF EXISTS public.add_store_product(bigint, bigint, numeric, numeric);
