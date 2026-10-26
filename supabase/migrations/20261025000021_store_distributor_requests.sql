-- ============================================================================
-- FAROX — 0021: solicitudes de productos a distribuidores vinculados.
--
-- El operador (dueño de una tienda) ya podía vincular distribuidores por QR
-- (0017/0020), pero /pedidos/nuevo le mostraba TODOS los distribuidores y
-- TODOS los productos con precio de la tienda. La regla de negocio nueva es:
--
--   · solo se pide a un distribuidor VINCULADO a la tienda;
--   · solo se piden productos que estén a la vez en el catálogo del
--     distribuidor (distributor_products) y en el catálogo de la tienda
--     (stock);
--   · el precio sigue saliendo de price_publications de la tienda.
--
-- El administrador conserva el flujo global: no se le restringe el vínculo ni
-- la intersección. La UI filtra, pero el backend repite las validaciones.
--
-- Reglas: SECURITY DEFINER + SET search_path; alcance desde el JWT, nunca desde
-- parámetros; GRANT explícito solo a authenticated/service_role.
-- ============================================================================

-- ============================================================================
-- 1. Productos solicitables: intersección stock × distributor_products
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_store_distributor_products(
  p_store bigint, p_distributor bigint
) RETURNS TABLE (product_id bigint, name text, price numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'list_store_distributor_products: solo admin u operador';
  END IF;
  IF p_store IS NULL OR p_distributor IS NULL THEN
    RAISE EXCEPTION 'list_store_distributor_products: tienda y distribuidor son obligatorios';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'list_store_distributor_products: tienda fuera del alcance del operador';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.distributors d
    WHERE d.id = p_distributor AND d.is_active
  ) THEN
    RAISE EXCEPTION 'list_store_distributor_products: distribuidor inactivo o inexistente';
  END IF;
  IF v_role = 'operador' AND NOT EXISTS (
    SELECT 1 FROM public.store_distributors sd
    WHERE sd.store_id = p_store AND sd.distributor_id = p_distributor
  ) THEN
    RAISE EXCEPTION 'list_store_distributor_products: distribuidor no está vinculado a la tienda';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, pp.price
  FROM public.distributor_products dp
  JOIN public.products p
    ON p.id = dp.product_id AND p.is_active
  JOIN public.stock s
    ON s.store_id = p_store AND s.product_id = dp.product_id
  LEFT JOIN public.price_publications pp
    ON pp.store_id = p_store AND pp.product_id = p.id AND pp.is_active
  WHERE dp.distributor_id = p_distributor
  ORDER BY p.name;
END;
$$;

-- ============================================================================
-- 2. create_order: vínculo + intersección para el operador
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_order(
  p_distributor bigint, p_store bigint, p_items jsonb,
  p_expected_at timestamptz DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := public.my_role();
  v_order bigint;
  v_dup   boolean;
  v_pid   bigint;                -- product_id del primer infractor por pass
  v_qty   numeric(12,3);
  v_count integer := 0;
BEGIN
  -- D43: admin · operador con tienda en scope (sin premium)
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'operador' AND (p_store = ANY (public.my_store_ids())) THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'create_order: solo admin, u operador con la tienda en su alcance (D43)';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'create_order: items vacíos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND is_active) THEN  -- R5.3
    RAISE EXCEPTION 'tienda inactiva o inexistente: %', p_store;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.distributors WHERE id = p_distributor AND is_active) THEN  -- R5.2
    RAISE EXCEPTION 'distribuidor inactivo o inexistente: %', p_distributor;
  END IF;
  -- 0021: el operador solo pide a un distribuidor vinculado a su tienda.
  IF v_role = 'operador' AND NOT EXISTS (
    SELECT 1 FROM public.store_distributors sd
    WHERE sd.store_id = p_store AND sd.distributor_id = p_distributor
  ) THEN
    RAISE EXCEPTION 'create_order: el distribuidor % no está vinculado a la tienda %',
      p_distributor, p_store;
  END IF;
  -- R12: sin duplicados (1 sentencia). GROUP BY agrupa también los NULL ⇒
  -- un product_id NULL único pasa acá y lo captura el pass de producto.
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
    GROUP BY x.product_id
    HAVING count(*) > 1
  ) INTO v_dup;
  IF v_dup THEN
    RAISE EXCEPTION 'create_order: producto repetido en items';
  END IF;
  -- R12: quantity > 0 — primer infractor (set-based; paridad de mensaje con
  -- el loop de 0009)
  SELECT x.product_id, x.quantity INTO v_pid, v_qty
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
  WHERE x.quantity IS NULL OR x.quantity <= 0
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'create_order: quantity debe ser > 0 (producto %)', v_pid;
  END IF;
  -- R5.3: producto activo — primer infractor (soft-delete no es borrado)
  SELECT x.product_id INTO v_pid
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
  LEFT JOIN public.products p ON p.id = x.product_id AND p.is_active
  WHERE p.id IS NULL
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'producto inactivo o inexistente: %', v_pid;
  END IF;
  -- 0021: intersección de catálogos para el operador. El admin conserva el
  -- flujo global. Se valida set-based y se reporta el primer infractor.
  IF v_role = 'operador' THEN
    SELECT x.product_id INTO v_pid
    FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
    LEFT JOIN public.distributor_products dp
      ON dp.distributor_id = p_distributor AND dp.product_id = x.product_id
    WHERE dp.product_id IS NULL
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'create_order: producto % no está en el catálogo del distribuidor %',
        v_pid, p_distributor;
    END IF;

    SELECT x.product_id INTO v_pid
    FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
    LEFT JOIN public.stock s
      ON s.store_id = p_store AND s.product_id = x.product_id
    WHERE s.product_id IS NULL
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'create_order: producto % no está en el catálogo de la tienda %',
        v_pid, p_store;
    END IF;
  END IF;
  -- D40: precio activo de la tienda — primer infractor
  SELECT x.product_id INTO v_pid
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
  LEFT JOIN public.price_publications pp
    ON pp.product_id = x.product_id AND pp.store_id = p_store AND pp.is_active
  WHERE pp.product_id IS NULL
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'sin precio activo para producto % en tienda %; use set_price() primero', v_pid, p_store;
  END IF;
  INSERT INTO public.orders (distributor_id, store_id, created_by, expected_at, notes)
  VALUES (p_distributor, p_store, auth.uid(), p_expected_at, p_notes)
  RETURNING id INTO v_order;
  -- R12: UNA sola sentencia — unit_price congelado = pp.price del catálogo
  -- activo (≤1 fila por uq_price_store_product_active ⇒ 1 línea por item)
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
  SELECT v_order, x.product_id, x.quantity, pp.price
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric(12,3))
  JOIN public.price_publications pp
    ON pp.product_id = x.product_id AND pp.store_id = p_store AND pp.is_active;
  GET DIAGNOSTICS v_count = ROW_COUNT;  -- R12: validación de cantidad > 0
  IF v_count = 0 THEN
    RAISE EXCEPTION 'create_order: ningún item válido';
  END IF;
  RETURN v_order;
END;
$$;

-- ============================================================================
-- 3. Grants (deny-by-default: solo las firmas nuevas/reemplazadas)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.list_store_distributor_products(bigint, bigint),
  public.create_order(bigint, bigint, jsonb, timestamptz, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.list_store_distributor_products(bigint, bigint),
  public.create_order(bigint, bigint, jsonb, timestamptz, text)
  TO authenticated, service_role;

-- INVERSE (inerte; descomentar a mano en una transacción para revertir):
-- Restaurar create_order desde 0010 y:
-- DROP FUNCTION IF EXISTS public.list_store_distributor_products(bigint, bigint);
