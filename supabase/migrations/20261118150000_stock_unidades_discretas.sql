-- ============================================================================
-- FAROX — 20261118150000: stock por unidad entera vs venta a granel (0059).
--
--   1. products.is_bulk: false = paquete/unidad discreta; true = granel
--      (peso o volumen, admite decimales).
--   2. Backfill: los productos de unidad `peso` (kg) y los de volumen cuyo
--      nombre/descripción diga "granel" o "por litro" quedan a granel. El
--      resto sigue por unidad (incluye botellas de 1 L).
--   3. Guards: stock, movements, order_items (pedido y recibido),
--      distributor_products y distributor_purchases rechazan cantidades
--      fraccionarias cuando el producto NO es a granel. Se implementan como
--      triggers porque un CHECK no puede consultar products.
--   4. Reparación única: el stock de productos por unidad con decimales
--      heredados del seed pasa al entero más cercano. El histórico de
--      movements/order_items NO se reescribe.
--   5. get_order_items expone is_bulk y la abreviatura de unidad para que la
--      UI de entrega sepa si acepta decimales.
--
--   Re-ejecutable: DO de una sola vez para columna/backfill + CREATE OR REPLACE
--   + DROP TRIGGER IF EXISTS + DROP FUNCTION IF EXISTS (cambio de RETURNS TABLE).
--   Rollback: restaurar get_order_items desde 0004, quitar triggers y columna.
-- ============================================================================

-- El alta de la columna y el backfill corren una sola vez: re-ejecutar la
-- migración no debe pisar la clasificación que el admin haya corregido.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'is_bulk'
  ) THEN
    ALTER TABLE public.products
      ADD COLUMN is_bulk boolean NOT NULL DEFAULT false;

    UPDATE public.products p
    SET is_bulk = true
    FROM public.unit_types u
    WHERE u.id = p.unit_type_id
      AND (
        u.category = 'peso'
        OR (
          u.category = 'volumen'
          AND (
            p.name ILIKE '%granel%'
            OR COALESCE(p.description, '') ILIKE '%granel%'
            OR COALESCE(p.description, '') ILIKE '%por litro%'
          )
        )
      );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Guard compartido
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.internal_assert_unit_quantity(
  p_product bigint, p_quantity numeric, p_context text
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_bulk boolean;
BEGIN
  IF p_quantity IS NULL THEN
    RETURN;
  END IF;
  SELECT p.is_bulk INTO v_bulk FROM public.products p WHERE p.id = p_product;
  -- Producto inexistente: lo rechaza la FK, no este guard.
  IF v_bulk IS FALSE AND p_quantity <> trunc(p_quantity) THEN
    RAISE EXCEPTION
      '%: la cantidad debe ser entera para un producto por unidad (producto %)',
      p_context, p_product;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.internal_assert_unit_quantity(bigint, numeric, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.internal_guard_unit_quantity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.internal_assert_unit_quantity(NEW.product_id, NEW.quantity, TG_TABLE_NAME);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.internal_guard_order_item_quantities()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.internal_assert_unit_quantity(
    NEW.product_id, NEW.quantity, 'order_items.quantity');
  PERFORM public.internal_assert_unit_quantity(
    NEW.product_id, NEW.received_quantity, 'order_items.received_quantity');
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.internal_guard_unit_quantity()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.internal_guard_order_item_quantities()
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Triggers por tabla
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_stock_unit_quantity ON public.stock;
CREATE TRIGGER trg_stock_unit_quantity
BEFORE INSERT OR UPDATE OF quantity ON public.stock
FOR EACH ROW EXECUTE FUNCTION public.internal_guard_unit_quantity();

DROP TRIGGER IF EXISTS trg_movements_unit_quantity ON public.movements;
CREATE TRIGGER trg_movements_unit_quantity
BEFORE INSERT ON public.movements
FOR EACH ROW EXECUTE FUNCTION public.internal_guard_unit_quantity();

DROP TRIGGER IF EXISTS trg_order_items_unit_quantity ON public.order_items;
CREATE TRIGGER trg_order_items_unit_quantity
BEFORE INSERT OR UPDATE OF quantity, received_quantity ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.internal_guard_order_item_quantities();

DROP TRIGGER IF EXISTS trg_distributor_products_unit_quantity ON public.distributor_products;
CREATE TRIGGER trg_distributor_products_unit_quantity
BEFORE INSERT OR UPDATE OF quantity ON public.distributor_products
FOR EACH ROW EXECUTE FUNCTION public.internal_guard_unit_quantity();

DROP TRIGGER IF EXISTS trg_distributor_purchases_unit_quantity ON public.distributor_purchases;
CREATE TRIGGER trg_distributor_purchases_unit_quantity
BEFORE INSERT ON public.distributor_purchases
FOR EACH ROW EXECUTE FUNCTION public.internal_guard_unit_quantity();

-- ----------------------------------------------------------------------------
-- 3. Reparación única del stock heredado (solo saldo actual, no histórico)
-- ----------------------------------------------------------------------------
UPDATE public.stock s
SET quantity = round(s.quantity)
FROM public.products p
WHERE p.id = s.product_id
  AND NOT p.is_bulk
  AND s.quantity <> trunc(s.quantity);

UPDATE public.distributor_products dp
SET quantity = round(dp.quantity)
FROM public.products p
WHERE p.id = dp.product_id
  AND NOT p.is_bulk
  AND dp.quantity <> trunc(dp.quantity);

-- ----------------------------------------------------------------------------
-- 4. get_order_items: agrega is_bulk y unidad (cambia RETURNS TABLE ⇒ DROP)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_order_items(bigint);

CREATE FUNCTION public.get_order_items(p_order bigint)
RETURNS TABLE (
  id                 bigint,
  product_id         bigint,
  product_name       text,
  quantity           numeric(12,3),
  received_quantity  numeric(12,3),
  status             public.order_item_status,
  unit_price         numeric(12,2),
  is_bulk            boolean,
  unit               text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT oi.id, oi.product_id, p.name, oi.quantity, oi.received_quantity, oi.status,
         CASE WHEN public.is_premium() THEN oi.unit_price END,  -- no-premium: sabe QUÉ y CUÁNTO, no el precio
         p.is_bulk, u.abbreviation
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  JOIN public.unit_types u ON u.id = p.unit_type_id
  WHERE oi.order_id = p_order
    AND (public.my_role() = 'admin'
         OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order
                     AND (o.store_id = ANY (public.my_store_ids())
                          OR o.distributor_id = public.my_distributor_id())));
$$;

GRANT EXECUTE ON FUNCTION public.get_order_items(bigint) TO authenticated, service_role;
