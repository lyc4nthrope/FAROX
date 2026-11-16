-- ============================================================================
-- FAROX — 0038: tickets recurrentes (compras y ventas guardadas).
--
--   1. movement_templates — plantilla de ticket por alcance:
--      · operador/admin: por tienda (store_id), compras o ventas.
--      · distribuidor: por distribuidora (distributor_id), compras o ventas.
--      Las líneas guardan producto + cantidad; el precio se resuelve al aplicar
--      la plantilla para no arrastrar precios viejos.
--   2. save_movement_template — crea o reemplaza por nombre dentro del alcance.
--   3. delete_movement_template — borra solo dentro del alcance del usuario.
--
-- Reglas del repo: SECURITY DEFINER + SET search_path; alcance desde el JWT;
-- GRANT explícito; escritura solo por RPC, lectura por RLS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.movement_templates (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind           public.movement_type NOT NULL,
  store_id       bigint NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  distributor_id bigint NULL REFERENCES public.distributors(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  lines          jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- Exactamente un alcance: tienda (operador/admin) o distribuidora.
  CONSTRAINT chk_movement_templates_scope
    CHECK ((store_id IS NULL) <> (distributor_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_movement_templates_name
  ON public.movement_templates (
    kind,
    COALESCE(store_id, 0),
    COALESCE(distributor_id, 0),
    lower(btrim(name))
  );

CREATE INDEX IF NOT EXISTS idx_movement_templates_scope
  ON public.movement_templates (store_id, distributor_id, kind);

DROP TRIGGER IF EXISTS trg_movement_templates_updated_at ON public.movement_templates;
CREATE TRIGGER trg_movement_templates_updated_at
BEFORE UPDATE ON public.movement_templates FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.movement_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS movement_templates_select ON public.movement_templates;
CREATE POLICY movement_templates_select ON public.movement_templates
  FOR SELECT TO authenticated
  USING (
    public.my_role() = 'admin'
    OR (public.my_role() = 'operador'
        AND store_id IS NOT NULL
        AND store_id = ANY (public.my_store_ids()))
    OR (public.my_role() = 'distribuidor'
        AND distributor_id IS NOT NULL
        AND distributor_id = public.my_distributor_id())
  );

REVOKE ALL ON public.movement_templates FROM authenticated, anon;
GRANT SELECT ON public.movement_templates TO authenticated;

-- ============================================================================
-- 1. save_movement_template — crea o reemplaza la plantilla del mismo nombre.
--    p_lines = [{ product_id, quantity }]
-- ============================================================================
CREATE OR REPLACE FUNCTION public.save_movement_template(
  p_name  text,
  p_kind  public.movement_type,
  p_store bigint,
  p_lines jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := COALESCE(public.my_role(), '');
  v_dist  bigint;
  v_line  record;
  v_clean jsonb;
  v_id    bigint;
BEGIN
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'save_movement_template: el nombre es obligatorio';
  END IF;
  IF length(btrim(p_name)) > 80 THEN
    RAISE EXCEPTION 'save_movement_template: el nombre supera 80 caracteres';
  END IF;
  IF p_kind IS NULL THEN
    RAISE EXCEPTION 'save_movement_template: tipo requerido';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'save_movement_template: agregá al menos un producto';
  END IF;
  IF jsonb_array_length(p_lines) > 100 THEN
    RAISE EXCEPTION 'save_movement_template: máximo 100 líneas por plantilla';
  END IF;

  IF v_role = 'distribuidor' THEN
    IF p_store IS NOT NULL THEN
      RAISE EXCEPTION 'save_movement_template: un distribuidor no guarda plantillas por tienda';
    END IF;
    v_dist := public.my_distributor_id();
    IF v_dist IS NULL THEN
      RAISE EXCEPTION 'save_movement_template: distribuidora no identificada';
    END IF;
    FOR v_line IN
      SELECT * FROM jsonb_to_recordset(p_lines) AS x(product_id bigint, quantity numeric(12,3))
    LOOP
      IF v_line.product_id IS NULL OR v_line.quantity IS NULL OR v_line.quantity <= 0 THEN
        RAISE EXCEPTION 'save_movement_template: producto y cantidad > 0 en cada línea';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.distributor_products dp
        JOIN public.products p ON p.id = dp.product_id AND p.is_active
        WHERE dp.distributor_id = v_dist AND dp.product_id = v_line.product_id
      ) THEN
        RAISE EXCEPTION 'save_movement_template: el producto % no está en tu catálogo',
          v_line.product_id;
      END IF;
    END LOOP;
  ELSE
    IF v_role NOT IN ('admin', 'operador') THEN
      RAISE EXCEPTION 'save_movement_template: sin permiso';
    END IF;
    IF p_store IS NULL THEN
      RAISE EXCEPTION 'save_movement_template: tienda requerida';
    END IF;
    IF v_role = 'operador' AND NOT (p_store = ANY (public.my_store_ids())) THEN
      RAISE EXCEPTION 'save_movement_template: tienda fuera del alcance del operador';
    END IF;
    FOR v_line IN
      SELECT * FROM jsonb_to_recordset(p_lines) AS x(product_id bigint, quantity numeric(12,3))
    LOOP
      IF v_line.product_id IS NULL OR v_line.quantity IS NULL OR v_line.quantity <= 0 THEN
        RAISE EXCEPTION 'save_movement_template: producto y cantidad > 0 en cada línea';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.stock s
        WHERE s.store_id = p_store AND s.product_id = v_line.product_id
      ) THEN
        RAISE EXCEPTION 'save_movement_template: el producto % no está asignado a la tienda',
          v_line.product_id;
      END IF;
    END LOOP;
  END IF;

  -- Solo producto + cantidad: el precio se resuelve al aplicar la plantilla.
  SELECT jsonb_agg(
           jsonb_build_object('product_id', x.product_id, 'quantity', x.quantity)
           ORDER BY x.product_id
         )
  INTO v_clean
  FROM jsonb_to_recordset(p_lines) AS x(product_id bigint, quantity numeric(12,3));

  SELECT t.id INTO v_id
  FROM public.movement_templates t
  WHERE t.kind = p_kind
    AND COALESCE(t.store_id, 0) = COALESCE(p_store, 0)
    AND COALESCE(t.distributor_id, 0) = COALESCE(v_dist, 0)
    AND lower(btrim(t.name)) = lower(btrim(p_name))
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.movement_templates
    SET lines = v_clean, owner_id = auth.uid(), updated_at = now()
    WHERE id = v_id;
  ELSE
    INSERT INTO public.movement_templates (owner_id, kind, store_id, distributor_id, name, lines)
    VALUES (auth.uid(), p_kind, p_store, v_dist, btrim(p_name), v_clean)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- ============================================================================
-- 2. delete_movement_template — solo dentro del alcance del usuario.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_movement_template(p_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'delete_movement_template: plantilla requerida';
  END IF;
  DELETE FROM public.movement_templates t
  WHERE t.id = p_id
    AND (
      public.my_role() = 'admin'
      OR (public.my_role() = 'operador'
          AND t.store_id IS NOT NULL
          AND t.store_id = ANY (public.my_store_ids()))
      OR (public.my_role() = 'distribuidor'
          AND t.distributor_id = public.my_distributor_id())
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_movement_template: plantilla inexistente o sin permiso';
  END IF;
END;
$$;

-- ============================================================================
-- 3. Grants
-- ============================================================================
REVOKE EXECUTE ON FUNCTION
  public.save_movement_template(text, public.movement_type, bigint, jsonb),
  public.delete_movement_template(bigint)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.save_movement_template(text, public.movement_type, bigint, jsonb),
  public.delete_movement_template(bigint)
  TO authenticated, service_role;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · save_movement_template('Venta mostrador', 'exit', <tienda>, [...]) dos
--     veces con el mismo nombre ⇒ una sola fila, con las líneas actualizadas.
--   · Un operador de otra tienda no ve ni borra la plantilla (RLS + guard).
--   · Al aplicar la plantilla el precio sale del catálogo vigente, no de un
--     precio histórico guardado.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   DROP FUNCTION IF EXISTS public.delete_movement_template(bigint);
--   DROP FUNCTION IF EXISTS public.save_movement_template(text, public.movement_type, bigint, jsonb);
--   DROP TABLE IF EXISTS public.movement_templates;
