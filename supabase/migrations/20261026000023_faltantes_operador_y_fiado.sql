-- ============================================================================
-- FAROX - 0023: faltantes del operador y fiado del operador.
--
--   1. list_shortage_products(): el DISTRIBUIDOR deja de ver faltantes. Solo
--      admin (todas las tiendas) y operador (sus tiendas via my_store_ids()).
--      El distribuidor se entera cuando el operador le crea un pedido.
--   2. create_credit(): el operador con acceso a la tienda del pedido puede
--      crear el fiado (antes solo admin). register_payment ya lo permitia.
--
-- Ambas son CREATE OR REPLACE: los GRANT de 0022/0004 se conservan y se
-- re-otorgan abajo de forma idempotente. Reglas del repo: SECURITY DEFINER +
-- SET search_path; alcance desde el JWT, nunca desde parametros.
-- ============================================================================

-- ============================================================================
-- 1. Faltantes: admin todo, operador sus tiendas, distribuidor nada.
-- ============================================================================
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

  -- Distribuidor (u otro rol): cero filas. No es un error: la vista ya no se
  -- le ofrece y el pedido del operador es el unico canal de aviso.
  RETURN;
END;
$$;

-- ============================================================================
-- 2. Fiado: admin u operador de la tienda del pedido.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_credit(
  p_order bigint, p_due_date date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := COALESCE(public.my_role(), '');
  v_total numeric(14,2);
  v_store bigint;
  v_id    bigint;
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'create_credit: solo admin/operador';
  END IF;
  SELECT o.store_id INTO v_store FROM public.orders o WHERE o.id = p_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido inexistente: %', p_order; END IF;
  IF v_role = 'operador' AND NOT (v_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'create_credit: tienda fuera del alcance del operador';
  END IF;
  SELECT COALESCE(sum(oi.unit_price * oi.quantity), 0) INTO v_total
  FROM public.order_items oi WHERE oi.order_id = p_order;
  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'pedido sin líneas con monto > 0';
  END IF;
  IF EXISTS (SELECT 1 FROM public.credits c WHERE c.order_id = p_order AND c.status <> 'cancelled') THEN
    RAISE EXCEPTION 'el pedido % ya tiene un crédito vigente (D15)', p_order;
  END IF;
  INSERT INTO public.credits (order_id, store_id, total_amount, balance, due_date, created_by)
  VALUES (p_order, v_store, v_total, v_total, p_due_date, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ============================================================================
-- 3. Grants idempotentes (CREATE OR REPLACE conserva los previos).
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.list_shortage_products(),
  public.create_credit(bigint, date)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.list_shortage_products(),
  public.create_credit(bigint, date)
  TO authenticated, service_role;

-- INVERSE (inerte; descomentar a mano en una transaccion para revertir):
--   Restaura las versiones de 0022 (list_shortage_products con rama de
--   distribuidor) y de 0004 (create_credit solo admin). No hay DROP: ambas
--   funciones siguen existiendo.
