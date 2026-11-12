-- ============================================================================
-- FAROX — 0043: carga masiva de precios de la tienda.
--
-- PROBLEMA
--   La pestaña Precios solo publica de a un producto (set_price). Un usuario que
--   pasa a Premium con 100 productos cargados a mano tiene que repetir el mismo
--   diálogo 100 veces para dejar la tienda vendible.
--
-- SOLUCIÓN
--   set_store_prices_bulk(p_store, p_lines) guarda compra y venta de N
--   productos en UNA transacción. p_lines es un array de
--     { product_id, purchase_price, sale_price, set_purchase, set_sale }
--   donde set_purchase/set_sale indican qué columnas tocó el usuario: una
--   columna no marcada NO se escribe (así una celda sin cargar nunca borra un
--   precio existente). En una columna marcada, un precio NULL la deja sin ese
--   precio. El cliente manda solo las filas que cambió.
--
--   La venta reutiliza la semántica de set_price: desactiva la publicación
--   activa e inserta una nueva (histórico + índice único uq_price_store_product_active).
--   La compra reutiliza la de update_store_product_full: upsert en
--   store_product_prices, DELETE si viene NULL.
--
-- SEGURIDAD
--   · SECURITY DEFINER + search_path; rol y alcance salen del JWT, nunca del
--     parámetro.
--   · Solo admin/operador con la tienda en su alcance y solo Premium (D7).
--   · Cada producto debe estar asignado a la tienda: no se puede publicar un
--     precio de un producto ajeno.
--   · Grant explícito: 0011 revoca EXECUTE a todo lo nuevo (deny-by-default).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_store_prices_bulk(
  p_store bigint,
  p_lines jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role    text := COALESCE(public.my_role(), '');
  v_line    record;
  v_missing bigint;
  v_prev    bigint;
  v_prev_pr numeric(12,2);
  v_count   integer := 0;
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'set_store_prices_bulk: solo admin/operador';
  END IF;
  IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
    RAISE EXCEPTION 'set_store_prices_bulk: tienda fuera del alcance del operador';
  END IF;
  IF NOT public.is_premium() THEN
    RAISE EXCEPTION 'set_store_prices_bulk: publicar precios requiere Premium (D7)';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'set_store_prices_bulk: no hay cambios para guardar';
  END IF;
  IF jsonb_array_length(p_lines) > 500 THEN
    RAISE EXCEPTION 'set_store_prices_bulk: máximo 500 productos por guardado';
  END IF;
  -- 0048: product_id ausente o no numérico no es "producto repetido". Se valida
  -- aparte porque `count(DISTINCT (item->>'product_id'))` ignora los NULL y el
  -- conteo de duplicados de abajo daría un error engañoso.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) AS item
    WHERE COALESCE(item->>'product_id', '') !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'set_store_prices_bulk: cada línea necesita product_id';
  END IF;
  -- Un producto repetido rompería el índice único de publicación activa.
  IF (
    SELECT count(DISTINCT (item->>'product_id'))
    FROM jsonb_array_elements(p_lines) AS item
  ) <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'set_store_prices_bulk: producto repetido en el lote';
  END IF;

  -- 0048: una sola consulta para todo el lote (antes: un EXISTS por línea).
  -- Con 500 líneas eran 500 idas al planner antes de escribir nada.
  SELECT x.product_id INTO v_missing
  FROM jsonb_to_recordset(p_lines) AS x(product_id bigint)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.stock s
    WHERE s.store_id = p_store AND s.product_id = x.product_id
  )
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'set_store_prices_bulk: el producto % no está asignado a la tienda %',
      v_missing, p_store;
  END IF;

  -- 0048: ORDER BY fija el orden de lock (anti-deadlock). Los dos lotes
  -- concurrentes con productos solapados bloquean en el mismo orden; antes el
  -- orden era el del JSON y dos clientes podían cruzarse.
  FOR v_line IN
    SELECT * FROM jsonb_to_recordset(p_lines)
      AS x(product_id bigint, purchase_price numeric(12,2), sale_price numeric(12,2),
           set_purchase boolean, set_sale boolean)
    ORDER BY x.product_id
  LOOP
    IF v_line.product_id IS NULL THEN
      RAISE EXCEPTION 'set_store_prices_bulk: producto requerido';
    END IF;
    -- Fila sin columnas marcadas: el cliente debe decir qué precio escribe.
    IF COALESCE(v_line.set_purchase, false) = false
       AND COALESCE(v_line.set_sale, false) = false THEN
      RAISE EXCEPTION 'set_store_prices_bulk: la fila del producto % no indica qué precio escribir',
        v_line.product_id;
    END IF;
    IF v_line.set_purchase
       AND v_line.purchase_price IS NOT NULL AND v_line.purchase_price <= 0 THEN
      RAISE EXCEPTION 'set_store_prices_bulk: el precio de compra debe ser > 0';
    END IF;
    IF v_line.set_sale
       AND v_line.sale_price IS NOT NULL AND v_line.sale_price <= 0 THEN
      RAISE EXCEPTION 'set_store_prices_bulk: el precio de venta debe ser > 0';
    END IF;

    -- Compra: upsert de la relación; NULL borra el costo (misma regla que 0030).
    IF COALESCE(v_line.set_purchase, false) THEN
      IF v_line.purchase_price IS NULL THEN
        DELETE FROM public.store_product_prices
        WHERE store_id = p_store AND product_id = v_line.product_id;
      ELSE
        INSERT INTO public.store_product_prices
          (store_id, product_id, purchase_price, created_by)
        VALUES (p_store, v_line.product_id, v_line.purchase_price, auth.uid())
        ON CONFLICT (store_id, product_id) DO UPDATE
        SET purchase_price = EXCLUDED.purchase_price,
            updated_at = now();
      END IF;
    END IF;

    -- Venta: desactivar la publicación activa ANTES de insertar (D17).
    IF COALESCE(v_line.set_sale, false) THEN
      SELECT id, price INTO v_prev, v_prev_pr
      FROM public.price_publications
      WHERE product_id = v_line.product_id AND store_id = p_store AND is_active
      FOR UPDATE;

      IF v_line.sale_price IS NULL THEN
        IF FOUND THEN
          UPDATE public.price_publications SET is_active = false WHERE id = v_prev;
        END IF;
      ELSIF NOT FOUND OR v_prev_pr IS DISTINCT FROM v_line.sale_price THEN
        IF FOUND THEN
          UPDATE public.price_publications SET is_active = false WHERE id = v_prev;
        END IF;
        INSERT INTO public.price_publications (product_id, store_id, created_by, price, currency)
        VALUES (v_line.product_id, p_store, auth.uid(), v_line.sale_price, 'COP');
      END IF;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- Grants: la función nace sin EXECUTE (deny-by-default de 0011).
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.set_store_prices_bulk(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_store_prices_bulk(bigint, jsonb)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · Un operador Premium con la tienda en alcance guarda 3 filas ⇒ devuelve 3;
--     price_publications deja una activa por producto y store_product_prices
--     hace upsert.
--   · Un operador sin Premium ⇒ excepción «publicar precios requiere Premium».
--   · Una tienda ajena al operador ⇒ excepción de alcance.
--   · Un producto no asignado a la tienda ⇒ excepción.
--   · sale_price NULL con set_sale = true ⇒ la publicación activa queda inactiva.
--   · set_purchase = false y set_sale = false ⇒ excepción (no es un no-op mudo).
--   · product_id repetido ⇒ excepción (no rompe el índice único).
--   · Una lista vacía ⇒ excepción «no hay cambios para guardar».
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   DROP FUNCTION IF EXISTS public.set_store_prices_bulk(bigint, jsonb);
