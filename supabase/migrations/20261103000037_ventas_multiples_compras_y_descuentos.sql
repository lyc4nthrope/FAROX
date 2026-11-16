-- ============================================================================
-- FAROX — 0037: tickets multi-producto, compras del distribuidor y descuentos.
--
--   1. movements.discount_pct — descuento porcentual de la venta (0–100).
--      unit_price sigue guardando el precio NETO; discount_pct permite auditar
--      cuánto se descontó sin perder el total.
--   2. distributor_purchases — ledger de compras del distribuidor (costo
--      unitario, cantidad y vencimiento). Suma stock a distributor_products.
--   3. register_movements_bulk — ticket de entradas/salidas de una tienda
--      (admin/operador), atómico: reusa register_entry/register_exit.
--   4. register_distributor_sales_bulk — ticket de venta a una tienda.
--   5. register_distributor_purchases — ticket de compra del distribuidor.
--
-- Reglas del repo: SECURITY DEFINER + SET search_path; alcance desde el JWT;
-- GRANT explícito. Las RPC nuevas delegan en las existentes para no duplicar
-- guards; toda la función corre en UNA transacción (atómica por ticket).
-- ============================================================================

-- ============================================================================
-- 1. movements.discount_pct
-- ============================================================================
ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS discount_pct numeric(5,2) NULL;

ALTER TABLE public.movements
  DROP CONSTRAINT IF EXISTS movements_discount_pct_check;
ALTER TABLE public.movements
  ADD CONSTRAINT movements_discount_pct_check
  CHECK (discount_pct IS NULL OR (discount_pct >= 0 AND discount_pct <= 100));

-- ============================================================================
-- 2. distributor_purchases — compras del distribuidor (ledger append-only).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.distributor_purchases (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  distributor_id bigint NOT NULL REFERENCES public.distributors(id) ON DELETE RESTRICT,
  product_id     bigint NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity       numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_cost      numeric(12,2) NOT NULL CHECK (unit_cost > 0),
  expiry_date    date NULL,
  created_by     uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_distributor_purchases_dist
  ON public.distributor_purchases (distributor_id, created_at DESC);

ALTER TABLE public.distributor_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS distributor_purchases_select ON public.distributor_purchases;
CREATE POLICY distributor_purchases_select ON public.distributor_purchases
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'distribuidor'
             AND distributor_id = public.my_distributor_id()));

REVOKE ALL ON public.distributor_purchases FROM authenticated, anon;
GRANT SELECT ON public.distributor_purchases TO authenticated;

-- ============================================================================
-- 3. register_movements_bulk — ticket de entradas/salidas de una tienda.
--    p_lines = [{ product_id, quantity, unit_price, expiry_date }]
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_movements_bulk(
  p_store    bigint,
  p_type     public.movement_type,
  p_motive_id bigint,
  p_lines    jsonb,
  p_discount numeric(5,2) DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_line  record;
  v_id    bigint;
  v_count integer := 0;
BEGIN
  IF p_store IS NULL THEN
    RAISE EXCEPTION 'register_movements_bulk: tienda requerida';
  END IF;
  IF p_type IS NULL THEN
    RAISE EXCEPTION 'register_movements_bulk: tipo requerido';
  END IF;
  IF p_motive_id IS NULL THEN
    RAISE EXCEPTION 'register_movements_bulk: motivo requerido';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.motives m WHERE m.id = p_motive_id AND m.is_active
  ) THEN
    RAISE EXCEPTION 'register_movements_bulk: motivo % inválido', p_motive_id;
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'register_movements_bulk: agregá al menos un producto';
  END IF;
  IF jsonb_array_length(p_lines) > 100 THEN
    RAISE EXCEPTION 'register_movements_bulk: máximo 100 líneas por ticket';
  END IF;
  IF p_discount IS NOT NULL THEN
    IF p_type <> 'exit' THEN
      RAISE EXCEPTION 'register_movements_bulk: el descuento solo aplica a salidas';
    END IF;
    IF p_discount < 0 OR p_discount > 100 THEN
      RAISE EXCEPTION 'register_movements_bulk: el descuento debe estar entre 0 y 100';
    END IF;
  END IF;

  FOR v_line IN
    SELECT * FROM jsonb_to_recordset(p_lines)
      AS x(product_id bigint, quantity numeric(12,3), unit_price numeric(12,2), expiry_date date)
  LOOP
    IF p_type = 'entry' THEN
      v_id := public.register_entry(
        p_product     => v_line.product_id,
        p_store       => p_store,
        p_qty         => v_line.quantity,
        p_motive_id   => p_motive_id,
        p_order_id    => NULL,
        p_expiry_date => v_line.expiry_date,
        p_unit_price  => v_line.unit_price
      );
    ELSE
      v_id := public.register_exit(
        p_product    => v_line.product_id,
        p_store      => p_store,
        p_qty        => v_line.quantity,
        p_motive_id  => p_motive_id,
        p_order_id   => NULL,
        p_unit_price => v_line.unit_price
      );
      IF p_discount IS NOT NULL THEN
        UPDATE public.movements SET discount_pct = p_discount WHERE id = v_id;
      END IF;
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 4. register_distributor_sales_bulk — ticket de venta del distribuidor.
--    p_lines = [{ product_id, quantity, unit_price, expiry_date }]
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_distributor_sales_bulk(
  p_store    bigint,
  p_lines    jsonb,
  p_discount numeric(5,2) DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_line  record;
  v_id    bigint;
  v_count integer := 0;
BEGIN
  IF p_store IS NULL THEN
    RAISE EXCEPTION 'register_distributor_sales_bulk: tienda requerida';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'register_distributor_sales_bulk: agregá al menos un producto';
  END IF;
  IF jsonb_array_length(p_lines) > 100 THEN
    RAISE EXCEPTION 'register_distributor_sales_bulk: máximo 100 líneas por ticket';
  END IF;
  IF p_discount IS NOT NULL AND (p_discount < 0 OR p_discount > 100) THEN
    RAISE EXCEPTION 'register_distributor_sales_bulk: el descuento debe estar entre 0 y 100';
  END IF;

  FOR v_line IN
    SELECT * FROM jsonb_to_recordset(p_lines)
      AS x(product_id bigint, quantity numeric(12,3), unit_price numeric(12,2), expiry_date date)
  LOOP
    -- register_distributor_sale valida rol, Premium, vínculo, catálogo, qty y precio.
    v_id := public.register_distributor_sale(
      p_product     => v_line.product_id,
      p_store       => p_store,
      p_qty         => v_line.quantity,
      p_unit_price  => v_line.unit_price,
      p_expiry_date => v_line.expiry_date
    );
    IF p_discount IS NOT NULL THEN
      UPDATE public.movements SET discount_pct = p_discount WHERE id = v_id;
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 5. register_distributor_purchases — compra del distribuidor.
--    Suma stock a distributor_products y deja el asiento en
--    distributor_purchases. Requiere Premium (el costo es un precio).
--    p_lines = [{ product_id, quantity, unit_price, expiry_date }]
--    (unit_price es el COSTO unitario de la compra)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_distributor_purchases(
  p_lines jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := COALESCE(public.my_role(), '');
  v_dist  bigint;
  v_line  record;
  v_count integer := 0;
BEGIN
  IF v_role <> 'distribuidor' THEN
    RAISE EXCEPTION 'register_distributor_purchases: solo distribuidor';
  END IF;
  IF NOT public.is_premium() THEN
    RAISE EXCEPTION 'register_distributor_purchases: requiere Premium';
  END IF;
  v_dist := public.my_distributor_id();
  IF v_dist IS NULL THEN
    RAISE EXCEPTION 'register_distributor_purchases: distribuidora no identificada';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'register_distributor_purchases: agregá al menos un producto';
  END IF;
  IF jsonb_array_length(p_lines) > 100 THEN
    RAISE EXCEPTION 'register_distributor_purchases: máximo 100 líneas por ticket';
  END IF;

  FOR v_line IN
    SELECT * FROM jsonb_to_recordset(p_lines)
      AS x(product_id bigint, quantity numeric(12,3), unit_price numeric(12,2), expiry_date date)
  LOOP
    IF v_line.product_id IS NULL THEN
      RAISE EXCEPTION 'register_distributor_purchases: producto requerido en cada línea';
    END IF;
    IF v_line.quantity IS NULL OR v_line.quantity <= 0 THEN
      RAISE EXCEPTION 'register_distributor_purchases: la cantidad debe ser > 0';
    END IF;
    IF v_line.unit_price IS NULL OR v_line.unit_price <= 0 THEN
      RAISE EXCEPTION 'register_distributor_purchases: el costo unitario debe ser > 0';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.distributor_products dp
      JOIN public.products p ON p.id = dp.product_id AND p.is_active
      WHERE dp.distributor_id = v_dist AND dp.product_id = v_line.product_id
    ) THEN
      RAISE EXCEPTION 'register_distributor_purchases: el producto % no está en tu catálogo',
        v_line.product_id;
    END IF;

    UPDATE public.distributor_products dp
    SET quantity = dp.quantity + v_line.quantity,
        purchase_price = v_line.unit_price,
        expiry_date = COALESCE(v_line.expiry_date, dp.expiry_date),
        updated_at = now()
    WHERE dp.distributor_id = v_dist AND dp.product_id = v_line.product_id;

    INSERT INTO public.distributor_purchases
      (distributor_id, product_id, quantity, unit_cost, expiry_date, created_by)
    VALUES
      (v_dist, v_line.product_id, v_line.quantity, v_line.unit_price,
       v_line.expiry_date, auth.uid());

    PERFORM public.internal_eval_distributor_alert(v_dist, v_line.product_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 6. Grants
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.register_movements_bulk(bigint, public.movement_type, bigint, jsonb, numeric),
  public.register_distributor_sales_bulk(bigint, jsonb, numeric),
  public.register_distributor_purchases(jsonb)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.register_movements_bulk(bigint, public.movement_type, bigint, jsonb, numeric),
  public.register_distributor_sales_bulk(bigint, jsonb, numeric),
  public.register_distributor_purchases(jsonb)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · register_movements_bulk con 2 líneas ⇒ 2 movements; si una falla,
--     no queda ninguna (la función es una sola transacción).
--   · register_distributor_sales_bulk con p_discount = 10 ⇒ cada movement
--     queda con discount_pct = 10 y unit_price neto.
--   · register_distributor_purchases ⇒ distributor_products.quantity sube y
--     aparece una fila en distributor_purchases.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   DROP FUNCTION IF EXISTS public.register_distributor_purchases(jsonb);
--   DROP FUNCTION IF EXISTS public.register_distributor_sales_bulk(bigint, jsonb, numeric);
--   DROP FUNCTION IF EXISTS public.register_movements_bulk(bigint, public.movement_type, bigint, jsonb, numeric);
--   DROP TABLE IF EXISTS public.distributor_purchases;
--   ALTER TABLE public.movements DROP CONSTRAINT IF EXISTS movements_discount_pct_check;
--   ALTER TABLE public.movements DROP COLUMN IF EXISTS discount_pct;
