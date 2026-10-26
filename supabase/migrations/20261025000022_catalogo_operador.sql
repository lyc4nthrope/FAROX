-- ============================================================================
-- FAROX - 0022: catalogo del operador.
--
-- La vista /products del operador lista `stock` (producto asignado + cantidad).
-- Faltaban cuatro operaciones que hoy no existen en la DB:
--
--   1. editar la cantidad SIN movimiento (pedido explicito del usuario: el
--      ledger no cambia; tradeoff aceptado, ver odd/tasks/operador-catalogo.md)
--   2. quitar un producto con existencias, con confirmacion explicita
--   3. marcar/desmarcar un producto como faltante
--   4. que el distribuidor vinculado vea los faltantes de sus tiendas
--
-- Faltante = public.stock.is_shortage (no una tabla nueva): la baja del
-- catalogo lo elimina solo y el operador lo lee en el mismo select paginado.
--
-- Reglas del repo: SECURITY DEFINER + SET search_path; alcance desde el JWT,
-- nunca desde parametros; GRANT explicito solo a authenticated/service_role.
-- ============================================================================

-- ============================================================================
-- 1. Columna + indice parcial
-- ============================================================================
ALTER TABLE public.stock
  ADD COLUMN IF NOT EXISTS is_shortage boolean NOT NULL DEFAULT false;

-- Solo interesan las filas marcadas (el distribuidor consulta por tienda).
CREATE INDEX IF NOT EXISTS idx_stock_shortage
  ON public.stock (store_id)
  WHERE is_shortage;

-- ============================================================================
-- 2. Cantidad sin movimiento (S4)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_store_product_quantity(
  p_product bigint, p_store bigint, p_quantity numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'stock: solo admin/operador pueden ajustar la cantidad';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'stock: tienda fuera del alcance del operador';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'stock: la cantidad no puede ser negativa';
  END IF;

  UPDATE public.stock
     SET quantity = p_quantity
   WHERE product_id = p_product AND store_id = p_store;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock: el producto no esta asignado a la tienda';
  END IF;

  -- A proposito NO se llama a internal_stock_entry: no hay fila en movements.
  -- La alerta de stock si se re-evalua para que el panel no quede mentiroso.
  PERFORM public.internal_eval_stock_alert(p_store, p_product);
END;
$$;

-- ============================================================================
-- 3. Baja del catalogo, con confirmacion si hay existencias (S5)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.remove_store_product(
  p_product bigint, p_store bigint, p_confirm_stock boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role   text := COALESCE(public.my_role(), '');
  v_qty    numeric(12,3);
  v_motive bigint;
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'remove_store_product: solo admin/operador';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'remove_store_product: tienda fuera del alcance del operador';
  END IF;

  SELECT quantity INTO v_qty
  FROM public.stock
  WHERE product_id = p_product AND store_id = p_store
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remove_store_product: el producto no esta asignado a la tienda';
  END IF;

  IF v_qty > 0 THEN
    IF NOT COALESCE(p_confirm_stock, false) THEN
      RAISE EXCEPTION 'remove_store_product: el producto tiene existencias (%) y exige confirmacion', v_qty;
    END IF;
    -- Descartar stock deja rastro: salida con motivo 'ajuste'. Sin esto el
    -- ledger perderia v_qty unidades en silencio.
    SELECT id INTO v_motive FROM public.motives WHERE name = 'ajuste' LIMIT 1;
    PERFORM public.internal_stock_entry(
      'exit', p_product, p_store, v_qty, v_motive, NULL, NULL, NULL, NULL,
      auth.uid(), NULL
    );
  END IF;

  DELETE FROM public.stock WHERE product_id = p_product AND store_id = p_store;

  -- La alerta de stock bajo de un producto que ya no esta en el catalogo no
  -- debe quedar abierta (internal_stock_entry la pudo haber creado al llegar a 0).
  UPDATE public.alerts
     SET resolved_at = now()
   WHERE store_id = p_store AND product_id = p_product
     AND type = 'stock_low' AND resolved_at IS NULL;
END;
$$;

-- ============================================================================
-- 4. Marcar / desmarcar faltante (S6)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_store_shortage(
  p_product bigint, p_store bigint, p_shortage boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'shortage: solo admin/operador pueden marcar faltantes';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'shortage: tienda fuera del alcance del operador';
  END IF;

  UPDATE public.stock
     SET is_shortage = COALESCE(p_shortage, false)
   WHERE product_id = p_product AND store_id = p_store;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shortage: el producto no esta asignado a la tienda';
  END IF;
END;
$$;

-- ============================================================================
-- 5. Faltantes que ve el distribuidor (S7)
-- ============================================================================
-- La policy stock_select solo le da al distribuidor las tiendas con pedido o
-- ruta, asi que una tienda vinculada sin pedido no seria visible. Esta RPC
-- valida el vinculo (store_distributors) y devuelve todo en una sola tabla
-- agrupable por tienda. admin ve todo; operador, sus tiendas.
CREATE OR REPLACE FUNCTION public.list_shortage_products()
RETURNS TABLE (
  store_id      bigint,
  store_name    text,
  product_id    bigint,
  name          text,
  brand         text,
  unit          text,
  category      text,
  quantity      numeric,
  base_quantity numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');
BEGIN
  IF v_role = 'admin' THEN
    RETURN QUERY
      SELECT s.store_id, st.name, s.product_id, p.name,
             b.name, u.name, c.name, s.quantity, p.base_quantity
      FROM public.stock s
      JOIN public.stores st      ON st.id = s.store_id
      JOIN public.products p     ON p.id = s.product_id
      LEFT JOIN public.brands b  ON b.id = p.brand_id
      JOIN public.unit_types u   ON u.id = p.unit_type_id
      JOIN public.product_categories c ON c.id = p.category_id
      WHERE s.is_shortage
      ORDER BY st.name, p.name;
    RETURN;
  END IF;

  IF v_role = 'operador' THEN
    RETURN QUERY
      SELECT s.store_id, st.name, s.product_id, p.name,
             b.name, u.name, c.name, s.quantity, p.base_quantity
      FROM public.stock s
      JOIN public.stores st      ON st.id = s.store_id
      JOIN public.products p     ON p.id = s.product_id
      LEFT JOIN public.brands b  ON b.id = p.brand_id
      JOIN public.unit_types u   ON u.id = p.unit_type_id
      JOIN public.product_categories c ON c.id = p.category_id
      WHERE s.is_shortage AND s.store_id = ANY (public.my_store_ids())
      ORDER BY st.name, p.name;
    RETURN;
  END IF;

  IF v_role = 'distribuidor' AND public.my_distributor_id() IS NOT NULL THEN
    RETURN QUERY
      SELECT s.store_id, st.name, s.product_id, p.name,
             b.name, u.name, c.name, s.quantity, p.base_quantity
      FROM public.stock s
      JOIN public.stores st      ON st.id = s.store_id
      JOIN public.products p     ON p.id = s.product_id
      LEFT JOIN public.brands b  ON b.id = p.brand_id
      JOIN public.unit_types u   ON u.id = p.unit_type_id
      JOIN public.product_categories c ON c.id = p.category_id
      JOIN public.store_distributors sd
        ON sd.store_id = s.store_id
       AND sd.distributor_id = public.my_distributor_id()
      WHERE s.is_shortage
      ORDER BY st.name, p.name;
    RETURN;
  END IF;

  RAISE EXCEPTION 'shortage: sin alcance para ver faltantes';
END;
$$;

-- ============================================================================
-- 6. Grants (deny-by-default: solo estas firmas quedan ejecutables)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.set_store_product_quantity(bigint, bigint, numeric),
  public.remove_store_product(bigint, bigint, boolean),
  public.set_store_shortage(bigint, bigint, boolean),
  public.list_shortage_products()
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.set_store_product_quantity(bigint, bigint, numeric),
  public.remove_store_product(bigint, bigint, boolean),
  public.set_store_shortage(bigint, bigint, boolean),
  public.list_shortage_products()
  TO authenticated, service_role;

-- INVERSE (inerte; descomentar a mano en una transaccion para revertir):
-- REVOKE EXECUTE ON FUNCTION public.set_store_product_quantity(bigint, bigint, numeric) FROM authenticated, service_role;
-- REVOKE EXECUTE ON FUNCTION public.remove_store_product(bigint, bigint, boolean) FROM authenticated, service_role;
-- REVOKE EXECUTE ON FUNCTION public.set_store_shortage(bigint, bigint, boolean) FROM authenticated, service_role;
-- REVOKE EXECUTE ON FUNCTION public.list_shortage_products() FROM authenticated, service_role;
-- DROP FUNCTION IF EXISTS public.set_store_product_quantity(bigint, bigint, numeric);
-- DROP FUNCTION IF EXISTS public.remove_store_product(bigint, bigint, boolean);
-- DROP FUNCTION IF EXISTS public.set_store_shortage(bigint, bigint, boolean);
-- DROP FUNCTION IF EXISTS public.list_shortage_products();
-- DROP INDEX IF EXISTS public.idx_stock_shortage;
-- ALTER TABLE public.stock DROP COLUMN IF EXISTS is_shortage;
