-- ============================================================================
-- FAROX — 0047: carga masiva de precios del distribuidor.
--
-- PROBLEMA
--   La carga masiva (0043) quedó solo para la tienda. El distribuidor tiene la
--   misma necesidad: decenas de productos con costo y sin precio de venta.
--
-- SOLUCIÓN
--   set_distributor_prices_bulk(p_lines) actualiza la relación de la
--   distribuidora autenticada en UNA transacción. Misma forma de línea que la
--   tienda:
--     { product_id, purchase_price, sale_price, set_purchase, set_sale }
--   · set_purchase/set_sale indican qué columnas tocó el usuario; una columna
--     no marcada no se escribe.
--   · En una columna marcada, NULL deja el precio vacío.
--   · El costo manual (purchase_price_source = 'manual') nunca se pisa; si el
--     valor no cambió, conserva su origen. Si cambió, pasa a manual.
--   · El margen propio (margin_pct) no se toca acá: se edita en la ficha.
--
-- SEGURIDAD
--   SECURITY DEFINER + search_path; rol y distribuidora desde el JWT; Premium
--   (D7); el producto debe estar en el catálogo del distribuidor. Grant
--   explícito por el deny-by-default de 0011.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_distributor_prices_bulk(
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
    RAISE EXCEPTION 'set_distributor_prices_bulk: solo distribuidor';
  END IF;
  IF NOT public.is_premium() THEN
    RAISE EXCEPTION 'set_distributor_prices_bulk: publicar precios requiere Premium (D7)';
  END IF;
  v_dist := public.my_distributor_id();
  IF v_dist IS NULL THEN
    RAISE EXCEPTION 'set_distributor_prices_bulk: distribuidora no identificada';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'set_distributor_prices_bulk: no hay cambios para guardar';
  END IF;
  IF jsonb_array_length(p_lines) > 500 THEN
    RAISE EXCEPTION 'set_distributor_prices_bulk: máximo 500 productos por guardado';
  END IF;
  IF (
    SELECT count(DISTINCT (item->>'product_id'))
    FROM jsonb_array_elements(p_lines) AS item
  ) <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'set_distributor_prices_bulk: producto repetido en el lote';
  END IF;

  FOR v_line IN
    SELECT * FROM jsonb_to_recordset(p_lines)
      AS x(product_id bigint, purchase_price numeric(12,2), sale_price numeric(12,2),
           set_purchase boolean, set_sale boolean)
    ORDER BY x.product_id
  LOOP
    IF v_line.product_id IS NULL THEN
      RAISE EXCEPTION 'set_distributor_prices_bulk: producto requerido';
    END IF;
    IF COALESCE(v_line.set_purchase, false) = false
       AND COALESCE(v_line.set_sale, false) = false THEN
      RAISE EXCEPTION 'set_distributor_prices_bulk: la fila del producto % no indica qué precio escribir',
        v_line.product_id;
    END IF;
    IF COALESCE(v_line.set_purchase, false)
       AND v_line.purchase_price IS NOT NULL AND v_line.purchase_price <= 0 THEN
      RAISE EXCEPTION 'set_distributor_prices_bulk: el precio de compra debe ser > 0';
    END IF;
    IF COALESCE(v_line.set_sale, false)
       AND v_line.sale_price IS NOT NULL AND v_line.sale_price <= 0 THEN
      RAISE EXCEPTION 'set_distributor_prices_bulk: el precio de venta debe ser > 0';
    END IF;

    UPDATE public.distributor_products dp
    SET purchase_price = CASE WHEN COALESCE(v_line.set_purchase, false) THEN v_line.purchase_price ELSE dp.purchase_price END,
        -- 0048: un valor explícito sobre una fila sin origen la fija como
        -- 'manual'; antes quedaba NULL y la próxima compra la pisaba aunque el
        -- usuario hubiera confirmado el costo a mano.
        purchase_price_source = CASE WHEN NOT COALESCE(v_line.set_purchase, false) THEN dp.purchase_price_source WHEN v_line.purchase_price IS NULL THEN NULL WHEN dp.purchase_price IS DISTINCT FROM v_line.purchase_price THEN 'manual' WHEN dp.purchase_price_source IS NULL THEN 'manual' ELSE dp.purchase_price_source END,
        sale_price = CASE WHEN COALESCE(v_line.set_sale, false) THEN v_line.sale_price ELSE dp.sale_price END,
        updated_at = now()
    WHERE dp.distributor_id = v_dist AND dp.product_id = v_line.product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'set_distributor_prices_bulk: el producto % no está en tu catálogo',
        v_line.product_id;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_distributor_prices_bulk(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_distributor_prices_bulk(jsonb)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · Un distribuidor Premium guarda 3 filas ⇒ devuelve 3; el costo y la venta
--     quedan en distributor_products.
--   · Un costo con source 'manual' y un valor distinto en el lote ⇒ NO cambia.
--   · Un costo aprendido con un valor distinto ⇒ se actualiza y pasa a manual.
--   · set_purchase = false ⇒ el costo no se toca.
--   · sale_price NULL con set_sale = true ⇒ la venta queda vacía.
--   · Producto fuera del catálogo ⇒ excepción.
--   · Lote > 500 o producto repetido ⇒ excepción.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   DROP FUNCTION IF EXISTS public.set_distributor_prices_bulk(jsonb);
