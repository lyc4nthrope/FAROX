-- ============================================================================
-- FAROX — 0029: precio de entrega, venta directa y contacto entre partes.
--
--   1. set_order_prices permite cotizar también en in_route (hasta entregar),
--      para que el movimiento de la entrega registre el precio de venta.
--   2. register_distributor_sale: el distribuidor Premium registra una venta
--      directa a una tienda vinculada. Se guarda como ENTRADA para la tienda
--      (stock+) con distributor_id y unit_price; su vista la muestra como salida.
--   3. get_counterpart_contact: operador ↔ distribuidor vinculados pueden leer
--      el nombre, teléfono, email y medio preferido de la contraparte. Sin
--      vínculo no hay lectura (SECURITY DEFINER con chequeo explícito).
--   4. update_distributor_product: el distribuidor edita la ficha de un
--      producto de SU catálogo (products es global; el alcance sale de
--      distributor_products y las columnas editables son solo la ficha).
--
-- Reglas del repo: SECURITY DEFINER + SET search_path; alcance desde el JWT;
-- GRANT explícito.
-- ============================================================================

-- ============================================================================
-- 1. set_order_prices — permite pending e in_route.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_order_prices(
  p_order bigint, p_items jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role   text := COALESCE(public.my_role(), '');
  v_status public.order_status;
  v_dup    boolean;
  v_pid    bigint;
  v_price  numeric(12,2);
  v_count  integer := 0;
BEGIN
  IF p_order IS NULL THEN
    RAISE EXCEPTION 'set_order_prices: pedido requerido';
  END IF;
  SELECT o.status INTO v_status FROM public.orders o WHERE o.id = p_order FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_order_prices: pedido inexistente: %', p_order;
  END IF;
  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'distribuidor' AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = p_order AND o.distributor_id = public.my_distributor_id()
  ) THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'set_order_prices: solo el admin o el distribuidor del pedido %', p_order;
  END IF;
  IF v_status NOT IN ('pending', 'in_route') THEN
    RAISE EXCEPTION 'set_order_prices: el pedido % ya no admite cotización (estado %)',
      p_order, v_status;
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'set_order_prices: items vacíos';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS x(product_id bigint, distributor_price numeric(12,2))
    GROUP BY x.product_id
    HAVING count(*) > 1
  ) INTO v_dup;
  IF v_dup THEN
    RAISE EXCEPTION 'set_order_prices: producto repetido en items';
  END IF;
  SELECT x.product_id, x.distributor_price INTO v_pid, v_price
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, distributor_price numeric(12,2))
  WHERE x.distributor_price IS NULL OR x.distributor_price <= 0
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'set_order_prices: distributor_price debe ser > 0 (producto %)', v_pid;
  END IF;
  SELECT x.product_id INTO v_pid
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, distributor_price numeric(12,2))
  LEFT JOIN public.order_items oi
    ON oi.order_id = p_order AND oi.product_id = x.product_id
  WHERE oi.product_id IS NULL
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'set_order_prices: el producto % no pertenece al pedido %', v_pid, p_order;
  END IF;
  UPDATE public.order_items oi
  SET distributor_price = x.distributor_price,
      updated_at = now()
  FROM jsonb_to_recordset(p_items) AS x(product_id bigint, distributor_price numeric(12,2))
  WHERE oi.order_id = p_order AND oi.product_id = x.product_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'set_order_prices: ningún item actualizado';
  END IF;
END;
$$;

-- ============================================================================
-- 2. register_distributor_sale — venta directa a una tienda vinculada.
--    Para la tienda es una ENTRADA (stock+); para el distribuidor es su salida.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_distributor_sale(
  p_product bigint, p_store bigint, p_qty numeric(12,3),
  p_unit_price numeric(12,2), p_expiry_date date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role   text := COALESCE(public.my_role(), '');
  v_dist   bigint;
  v_motive bigint;
  v_id     bigint;
BEGIN
  IF v_role <> 'distribuidor' THEN
    RAISE EXCEPTION 'register_distributor_sale: solo distribuidor';
  END IF;
  IF NOT public.is_premium() THEN
    RAISE EXCEPTION 'register_distributor_sale: requiere Premium';
  END IF;
  v_dist := public.my_distributor_id();
  IF v_dist IS NULL THEN
    RAISE EXCEPTION 'register_distributor_sale: distribuidora no identificada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.store_distributors sd
    WHERE sd.store_id = p_store AND sd.distributor_id = v_dist
  ) THEN
    RAISE EXCEPTION 'register_distributor_sale: la tienda % no está vinculada', p_store;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.distributor_products dp
    JOIN public.products p ON p.id = dp.product_id AND p.is_active
    WHERE dp.distributor_id = v_dist AND dp.product_id = p_product
  ) THEN
    RAISE EXCEPTION 'register_distributor_sale: el producto % no está en tu catálogo', p_product;
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'register_distributor_sale: quantity debe ser > 0';
  END IF;
  IF p_unit_price IS NULL OR p_unit_price <= 0 THEN
    RAISE EXCEPTION 'register_distributor_sale: el precio de venta debe ser > 0';
  END IF;
  SELECT id INTO v_motive FROM public.motives WHERE name = 'venta';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_distributor_sale: motivo "venta" sin sembrado';
  END IF;
  v_id := public.internal_stock_entry('entry', p_product, p_store, p_qty,
                                      v_motive, NULL, v_dist, p_unit_price,
                                      p_expiry_date, auth.uid());
  PERFORM public.internal_dashboard_upsert(v_dist, 1, 0, p_qty * p_unit_price, 0);
  RETURN v_id;
END;
$$;

-- ============================================================================
-- 3. get_counterpart_contact — contacto de la contraparte vinculada.
--    kind = 'distribuidor' (operador pide) | 'store' (distribuidor pide).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_counterpart_contact(
  p_kind text, p_id bigint
) RETURNS TABLE (
  full_name text,
  phone_number text,
  email text,
  contact_preference public.contact_preference
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');
BEGIN
  IF p_kind = 'distribuidor' THEN
    IF v_role = 'operador' AND NOT EXISTS (
      SELECT 1 FROM public.store_distributors sd
      WHERE sd.distributor_id = p_id AND sd.store_id = ANY (public.my_store_ids())
    ) THEN
      RAISE EXCEPTION 'get_counterpart_contact: distribuidor no vinculado a tus tiendas';
    END IF;
    IF v_role NOT IN ('operador', 'admin') THEN
      RAISE EXCEPTION 'get_counterpart_contact: sin alcance';
    END IF;
    RETURN QUERY
      SELECT u.full_name, u.phone_number, u.email, u.contact_preference
      FROM public.users u
      JOIN public.roles r ON r.id = u.role_id
      WHERE u.distributor_id = p_id
        AND u.is_active
        AND r.name = 'distribuidor'
      ORDER BY (u.phone_number IS NOT NULL) DESC, u.id
      LIMIT 1;
    RETURN;
  END IF;

  IF p_kind = 'store' THEN
    IF v_role = 'distribuidor' AND NOT EXISTS (
      SELECT 1 FROM public.store_distributors sd
      WHERE sd.store_id = p_id AND sd.distributor_id = public.my_distributor_id()
    ) THEN
      RAISE EXCEPTION 'get_counterpart_contact: tienda no vinculada a tu distribuidora';
    END IF;
    IF v_role NOT IN ('distribuidor', 'admin') THEN
      RAISE EXCEPTION 'get_counterpart_contact: sin alcance';
    END IF;
    RETURN QUERY
      SELECT u.full_name, u.phone_number, u.email, u.contact_preference
      FROM public.users u
      WHERE u.is_active
        AND (u.id = (SELECT s.created_by FROM public.stores s WHERE s.id = p_id)
             OR u.id IN (SELECT us.user_id FROM public.user_stores us WHERE us.store_id = p_id))
      ORDER BY (u.id = (SELECT s.created_by FROM public.stores s WHERE s.id = p_id)) DESC,
               (u.phone_number IS NOT NULL) DESC,
               u.id
      LIMIT 1;
    RETURN;
  END IF;

  RAISE EXCEPTION 'get_counterpart_contact: kind inválido (%)', p_kind;
END;
$$;

-- ============================================================================
-- 4. update_distributor_product — ficha del producto editada por el
--    distribuidor que lo maneja. products es una tabla compartida: el alcance
--    es distributor_products y las columnas permitidas son solo la ficha
--    (nunca is_active ni created_by, que romperían la propiedad/soft-delete).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_distributor_product(
  p_product       bigint,
  p_name          text,
  p_description   text,
  p_category      bigint,
  p_brand         bigint,
  p_unit          bigint,
  p_base_quantity numeric,
  p_barcode       text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := COALESCE(public.my_role(), '');
  v_dist  bigint;
  v_count integer;
BEGIN
  IF v_role <> 'distribuidor' THEN
    RAISE EXCEPTION 'update_distributor_product: solo distribuidor';
  END IF;
  v_dist := public.my_distributor_id();
  IF v_dist IS NULL THEN
    RAISE EXCEPTION 'update_distributor_product: distribuidora no identificada';
  END IF;
  IF p_product IS NULL THEN
    RAISE EXCEPTION 'update_distributor_product: producto requerido';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.distributor_products dp
    WHERE dp.distributor_id = v_dist AND dp.product_id = p_product
  ) THEN
    RAISE EXCEPTION 'update_distributor_product: el producto % no está en tu catálogo', p_product;
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'update_distributor_product: el nombre es obligatorio';
  END IF;
  IF p_base_quantity IS NULL OR p_base_quantity <= 0 THEN
    RAISE EXCEPTION 'update_distributor_product: base_quantity debe ser > 0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_categories c WHERE c.id = p_category) THEN
    RAISE EXCEPTION 'update_distributor_product: categoría inexistente: %', p_category;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = p_brand) THEN
    RAISE EXCEPTION 'update_distributor_product: marca inexistente: %', p_brand;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.unit_types u WHERE u.id = p_unit) THEN
    RAISE EXCEPTION 'update_distributor_product: unidad inexistente: %', p_unit;
  END IF;
  UPDATE public.products p
  SET name = btrim(p_name),
      description = NULLIF(btrim(COALESCE(p_description, '')), ''),
      category_id = p_category,
      brand_id = p_brand,
      unit_type_id = p_unit,
      base_quantity = p_base_quantity,
      barcode = NULLIF(btrim(COALESCE(p_barcode, '')), '')
  WHERE p.id = p_product;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'update_distributor_product: producto inexistente: %', p_product;
  END IF;
END;
$$;

-- ============================================================================
-- 5. Grants
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.set_order_prices(bigint, jsonb),
  public.register_distributor_sale(bigint, bigint, numeric, numeric, date),
  public.get_counterpart_contact(text, bigint),
  public.update_distributor_product(bigint, text, text, bigint, bigint, bigint, numeric, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.set_order_prices(bigint, jsonb),
  public.register_distributor_sale(bigint, bigint, numeric, numeric, date),
  public.get_counterpart_contact(text, bigint),
  public.update_distributor_product(bigint, text, text, bigint, bigint, bigint, numeric, text)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · set_order_prices sobre un pedido in_route ⇒ OK; luego confirm_delivery
--     registra movements.unit_price con ese precio.
--   · register_distributor_sale crea stock+movement entry con distributor_id y
--     unit_price; la vista del distribuidor lo muestra como salida.
--   · get_counterpart_contact sin vínculo ⇒ excepción; con vínculo ⇒ fila.
--   · update_distributor_product sobre un producto de mi catálogo ⇒ OK;
--     sobre un producto ajeno ⇒ excepción; is_active/created_by no cambian.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   Restaurar set_order_prices desde 0024 (solo pending).
--   DROP FUNCTION IF EXISTS public.register_distributor_sale(bigint, bigint, numeric, numeric, date);
--   DROP FUNCTION IF EXISTS public.get_counterpart_contact(text, bigint);
--   DROP FUNCTION IF EXISTS public.update_distributor_product(bigint, text, text, bigint, bigint, bigint, numeric, text);
