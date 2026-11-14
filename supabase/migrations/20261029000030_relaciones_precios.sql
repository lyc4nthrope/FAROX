-- ============================================================================
-- FAROX — 0030: relaciones producto↔tienda/distribuidor con precios.
--
-- Corrección de 0029: la ficha global de `products` NO la edita el
-- distribuidor. Cada parte edita solo SU relación con el producto:
--
--   · Tienda (stock): cantidad, umbral, vencimiento y —si es Premium—
--     precio de compra (tabla privada store_product_prices) + precio de venta
--     (publicación activa).
--   · Distribuidor (distributor_products): cantidad que posee, umbral y
--     vencimiento de aviso y —si es Premium— precio de compra + precio de
--     venta.
--
-- Los precios son privados por relación (D40/D41) y sirven de estimación:
-- entradas usan el precio de compra, salidas el de venta; la cotización del
-- pedido usa el precio de venta del distribuidor. Siempre son editables.
--
-- Reglas del repo: SECURITY DEFINER + SET search_path; alcance desde el JWT;
-- GRANT explícito. products_update queda SOLO admin (crear sí, modificar no).
-- ============================================================================

-- ============================================================================
-- 0. Higiene: si una 0029 anterior llegó a aplicarse, eliminar la RPC que
--    editaba la ficha completa del producto desde el distribuidor.
-- ============================================================================
DROP FUNCTION IF EXISTS public.update_distributor_product(
  bigint, text, text, bigint, bigint, bigint, numeric, text
);

-- ============================================================================
-- 1. Columnas/tablas de relación.
-- ============================================================================
-- 0030: el precio de compra de la tienda NO vive en `stock` (el distribuidor
-- puede leer stock de tiendas con pedidos/rutas). Tabla propia con RLS
-- operator/admin: el distribuidor no puede ver el coste de la tienda.
CREATE TABLE IF NOT EXISTS public.store_product_prices (
  store_id       bigint NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  product_id     bigint NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  purchase_price numeric(12,2) NOT NULL CHECK (purchase_price > 0),
  created_by     uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, product_id)
);

ALTER TABLE public.store_product_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_product_prices_select ON public.store_product_prices;
CREATE POLICY store_product_prices_select ON public.store_product_prices
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids())));

REVOKE ALL ON public.store_product_prices FROM authenticated, anon;
GRANT SELECT ON public.store_product_prices TO authenticated;

DROP TRIGGER IF EXISTS trg_store_product_prices_updated_at ON public.store_product_prices;
CREATE TRIGGER trg_store_product_prices_updated_at
BEFORE UPDATE ON public.store_product_prices FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.distributor_products
  ADD COLUMN IF NOT EXISTS quantity numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS threshold numeric(12,3) NULL,
  ADD COLUMN IF NOT EXISTS expiry_date date NULL,
  ADD COLUMN IF NOT EXISTS purchase_price numeric(12,2) NULL,
  ADD COLUMN IF NOT EXISTS sale_price numeric(12,2) NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.distributor_products
  DROP CONSTRAINT IF EXISTS distributor_products_quantity_check;
ALTER TABLE public.distributor_products
  ADD CONSTRAINT distributor_products_quantity_check CHECK (quantity >= 0);
ALTER TABLE public.distributor_products
  DROP CONSTRAINT IF EXISTS distributor_products_threshold_check;
ALTER TABLE public.distributor_products
  ADD CONSTRAINT distributor_products_threshold_check
  CHECK (threshold IS NULL OR threshold >= 0);
ALTER TABLE public.distributor_products
  DROP CONSTRAINT IF EXISTS distributor_products_purchase_price_check;
ALTER TABLE public.distributor_products
  ADD CONSTRAINT distributor_products_purchase_price_check
  CHECK (purchase_price IS NULL OR purchase_price > 0);
ALTER TABLE public.distributor_products
  DROP CONSTRAINT IF EXISTS distributor_products_sale_price_check;
ALTER TABLE public.distributor_products
  ADD CONSTRAINT distributor_products_sale_price_check
  CHECK (sale_price IS NULL OR sale_price > 0);

DROP TRIGGER IF EXISTS trg_distributor_products_updated_at ON public.distributor_products;
CREATE TRIGGER trg_distributor_products_updated_at
BEFORE UPDATE ON public.distributor_products FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- 2. Ficha global: crear sí (admin/operador/distribuidor con alcance),
--    modificar SOLO admin. El creador ya no puede editar su producto.
-- ============================================================================
DROP POLICY IF EXISTS products_insert ON public.products;
CREATE POLICY products_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.my_role() = 'admin'
              OR (public.my_role() IN ('operador', 'distribuidor')
                  AND public.has_scope()));

DROP POLICY IF EXISTS products_update ON public.products;
CREATE POLICY products_update ON public.products
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin')
  WITH CHECK (public.my_role() = 'admin');

-- ============================================================================
-- 3. update_store_product_full — relación de la tienda en UNA llamada.
--    p_shortage NULL conserva el faltante. Los precios solo se tocan si el
--    usuario es Premium; el precio de venta actualiza price_publications.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_store_product_full(
  p_product        bigint,
  p_store          bigint,
  p_quantity       numeric(12,3),
  p_threshold      numeric(12,3),
  p_shortage       boolean,
  p_expiry_date    date,
  p_purchase_price numeric(12,2),
  p_sale_price     numeric(12,2)
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role     text := COALESCE(public.my_role(), '');
  v_premium  boolean := public.is_premium();
  v_prev     bigint;
  v_prev_pr  numeric(12,2);
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'update_store_product_full: solo admin/operador';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'update_store_product_full: tienda fuera del alcance del operador';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'update_store_product_full: la cantidad no puede ser negativa';
  END IF;
  IF p_threshold IS NOT NULL AND p_threshold < 0 THEN
    RAISE EXCEPTION 'update_store_product_full: el umbral no puede ser negativo';
  END IF;
  IF p_purchase_price IS NOT NULL AND p_purchase_price <= 0 THEN
    RAISE EXCEPTION 'update_store_product_full: el precio de compra debe ser > 0';
  END IF;
  IF p_sale_price IS NOT NULL AND p_sale_price <= 0 THEN
    RAISE EXCEPTION 'update_store_product_full: el precio de venta debe ser > 0';
  END IF;
  IF NOT v_premium AND (p_purchase_price IS NOT NULL OR p_sale_price IS NOT NULL) THEN
    RAISE EXCEPTION 'update_store_product_full: los precios requieren Premium';
  END IF;

  UPDATE public.stock s
  SET quantity = p_quantity,
      threshold = p_threshold,
      is_shortage = COALESCE(p_shortage, s.is_shortage),
      expiry_date = p_expiry_date,
      updated_at = now()
  WHERE s.store_id = p_store AND s.product_id = p_product;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_store_product_full: el producto % no está asignado a la tienda %',
      p_product, p_store;
  END IF;

  IF v_premium THEN
    IF p_purchase_price IS NULL THEN
      DELETE FROM public.store_product_prices
      WHERE store_id = p_store AND product_id = p_product;
    ELSE
      INSERT INTO public.store_product_prices
        (store_id, product_id, purchase_price, created_by)
      VALUES (p_store, p_product, p_purchase_price, auth.uid())
      ON CONFLICT (store_id, product_id) DO UPDATE
      SET purchase_price = EXCLUDED.purchase_price,
          updated_at = now();
    END IF;

    SELECT id, price INTO v_prev, v_prev_pr
    FROM public.price_publications
    WHERE product_id = p_product AND store_id = p_store AND is_active
    FOR UPDATE;

    IF p_sale_price IS NULL THEN
      IF FOUND THEN
        UPDATE public.price_publications SET is_active = false WHERE id = v_prev;
      END IF;
    ELSIF NOT FOUND OR v_prev_pr IS DISTINCT FROM p_sale_price THEN
      IF FOUND THEN
        UPDATE public.price_publications SET is_active = false WHERE id = v_prev;
      END IF;
      INSERT INTO public.price_publications (product_id, store_id, created_by, price, currency)
      VALUES (p_product, p_store, auth.uid(), p_sale_price, 'COP');
    END IF;
  END IF;

  PERFORM public.internal_eval_stock_alert(p_store, p_product);
END;
$$;

-- ============================================================================
-- 4. update_distributor_product_relation — relación del distribuidor:
--    cantidad que posee + precios (Premium). Nunca toca products.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_distributor_product_relation(
  p_product        bigint,
  p_quantity       numeric(12,3),
  p_threshold      numeric(12,3),
  p_expiry_date    date,
  p_purchase_price numeric(12,2),
  p_sale_price     numeric(12,2)
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role    text := COALESCE(public.my_role(), '');
  v_premium boolean := public.is_premium();
  v_dist    bigint;
BEGIN
  IF v_role <> 'distribuidor' THEN
    RAISE EXCEPTION 'update_distributor_product_relation: solo distribuidor';
  END IF;
  v_dist := public.my_distributor_id();
  IF v_dist IS NULL THEN
    RAISE EXCEPTION 'update_distributor_product_relation: distribuidora no identificada';
  END IF;
  IF p_product IS NULL THEN
    RAISE EXCEPTION 'update_distributor_product_relation: producto requerido';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'update_distributor_product_relation: la cantidad no puede ser negativa';
  END IF;
  IF p_threshold IS NOT NULL AND p_threshold < 0 THEN
    RAISE EXCEPTION 'update_distributor_product_relation: el umbral no puede ser negativo';
  END IF;
  IF p_purchase_price IS NOT NULL AND p_purchase_price <= 0 THEN
    RAISE EXCEPTION 'update_distributor_product_relation: el precio de compra debe ser > 0';
  END IF;
  IF p_sale_price IS NOT NULL AND p_sale_price <= 0 THEN
    RAISE EXCEPTION 'update_distributor_product_relation: el precio de venta debe ser > 0';
  END IF;
  IF NOT v_premium AND (p_purchase_price IS NOT NULL OR p_sale_price IS NOT NULL) THEN
    RAISE EXCEPTION 'update_distributor_product_relation: los precios requieren Premium';
  END IF;

  UPDATE public.distributor_products dp
  SET quantity = p_quantity,
      threshold = p_threshold,
      expiry_date = p_expiry_date,
      purchase_price = CASE WHEN v_premium THEN p_purchase_price ELSE dp.purchase_price END,
      sale_price = CASE WHEN v_premium THEN p_sale_price ELSE dp.sale_price END,
      updated_at = now()
  WHERE dp.distributor_id = v_dist AND dp.product_id = p_product;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_distributor_product_relation: el producto % no está en tu catálogo',
      p_product;
  END IF;
END;
$$;

-- ============================================================================
-- 5. register_entry — el precio de compra de la relación es la estimación
--    por defecto de una entrada manual. Sin él conserva la publicación.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_entry(
  p_product bigint, p_store bigint, p_qty numeric(12,3), p_motive_id bigint,
  p_order_id bigint, p_expiry_date date, p_unit_price numeric(12,2)
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role        text := COALESCE(public.my_role(), '');
  v_dist        bigint;
  v_order_store bigint;
  v_price       numeric(12,2);
  v_id          bigint;
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'register_entry: solo admin/operador';
  END IF;
  IF NOT public.is_premium() THEN
    RAISE EXCEPTION 'D39: registrar movimientos manuales requiere premium';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'register_entry: tienda fuera del alcance del operador';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'register_entry: quantity debe ser > 0';
  END IF;
  IF p_order_id IS NOT NULL THEN
    SELECT o.distributor_id, o.store_id INTO v_dist, v_order_store
    FROM public.orders o WHERE o.id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pedido inexistente: %', p_order_id;
    END IF;
    IF v_order_store IS DISTINCT FROM p_store THEN
      RAISE EXCEPTION 'register_entry: el pedido % pertenece a la tienda %, no a %',
        p_order_id, v_order_store, p_store;
    END IF;
    SELECT oi.unit_price INTO v_price FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.product_id = p_product;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'producto % no pertenece al pedido %', p_product, p_order_id;
    END IF;
  END IF;
  IF p_unit_price IS NOT NULL THEN
    IF p_unit_price <= 0 THEN
      RAISE EXCEPTION 'register_entry: el precio de compra debe ser > 0';
    END IF;
    v_price := p_unit_price;
  ELSIF p_order_id IS NULL THEN
    SELECT COALESCE(
             (SELECT spp.purchase_price FROM public.store_product_prices spp
              WHERE spp.store_id = p_store AND spp.product_id = p_product),
             (SELECT pp.price FROM public.price_publications pp
              WHERE pp.product_id = p_product AND pp.store_id = p_store AND pp.is_active
              LIMIT 1)
           )
      INTO v_price;
  END IF;
  v_id := public.internal_stock_entry('entry', p_product, p_store, p_qty,
                                      p_motive_id, p_order_id, v_dist, v_price,
                                      p_expiry_date, auth.uid());
  PERFORM public.internal_dashboard_upsert(COALESCE(v_dist, 0), 1, 0,
    CASE WHEN v_price IS NULL THEN 0 ELSE p_qty * v_price END, 0);
  RETURN v_id;
END;
$$;

-- ============================================================================
-- 6. Grants de las firmas nuevas.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.update_store_product_full(bigint, bigint, numeric, numeric, boolean, date, numeric, numeric),
  public.update_distributor_product_relation(bigint, numeric, numeric, date, numeric, numeric)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.update_store_product_full(bigint, bigint, numeric, numeric, boolean, date, numeric, numeric),
  public.update_distributor_product_relation(bigint, numeric, numeric, date, numeric, numeric)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · products_update ya no deja editar a un operador/distribuidor creador;
--     products_insert sí deja crear a un distribuidor activo con alcance.
--   · update_store_product_full cambia cantidad/umbral/vencimiento y, Premium,
--     los precios; sin Premium un precio enviado ⇒ excepción.
--   · update_distributor_product_relation cambia cantidad, umbral, vencimiento
--     y precios de la relación; sobre un producto ajeno ⇒ excepción; products
--     no cambia.
--   · register_entry sin precio usa store_product_prices; sin él, la
--     publicación activa (comportamiento anterior).
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   Restaurar products_insert/products_update desde 0006.
--   Restaurar register_entry desde 0027.
--   DROP FUNCTION IF EXISTS public.update_store_product_full(bigint, bigint, numeric, numeric, boolean, date, numeric, numeric);
--   DROP FUNCTION IF EXISTS public.update_distributor_product_relation(bigint, numeric, numeric, date, numeric, numeric);
--   DROP TABLE IF EXISTS public.store_product_prices;
--   ALTER TABLE public.distributor_products
--     DROP COLUMN IF EXISTS quantity,
--     DROP COLUMN IF EXISTS threshold,
--     DROP COLUMN IF EXISTS expiry_date,
--     DROP COLUMN IF EXISTS purchase_price,
--     DROP COLUMN IF EXISTS sale_price,
--     DROP COLUMN IF EXISTS updated_at;
