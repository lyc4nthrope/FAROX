-- ============================================================================
-- FAROX — 0017: vínculo tienda ↔ distribuidor por QR (INV-05, D42, D-P7/D3-10).
--
-- D42 dice que el distribuidor escanea el QR de la tienda para vincularse,
-- pero no existía dónde guardar ese vínculo. Esta migración agrega:
--   · stores.link_code: código aleatorio por tienda (el QR lleva una URL con
--     este código, NUNCA el store_id adivinable);
--   · store_distributors: el vínculo (solo se escribe por RPC);
--   · RPC get_store_link_code / regenerate_store_link_code (dueño o admin),
--     link_distributor_to_store (solo distribuidor activo),
--     unlink_distributor (dueño o admin).
-- Reglas: SECURITY DEFINER + SET search_path; GRANT explícito solo a
-- authenticated/service_role (D48); el alcance sale del JWT, nunca de
-- parámetros; link_code no es legible por SELECT directo.
-- Whitelist +4 firmas (0012 re-ejecutada dará FAIL esperado en el conteo).
-- ============================================================================

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS link_code text;
UPDATE public.stores
  SET link_code = encode(extensions.gen_random_bytes(9), 'hex')
  WHERE link_code IS NULL;
ALTER TABLE public.stores
  ALTER COLUMN link_code SET DEFAULT encode(extensions.gen_random_bytes(9), 'hex'),
  ALTER COLUMN link_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_link_code ON public.stores (link_code);

-- link_code no se lee por SELECT directo (la policy de stores es USING true):
-- se revoca el SELECT de tabla y se re-otorga columna por columna, sin link_code.
REVOKE SELECT ON public.stores FROM authenticated;
DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ')
    INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'stores' AND column_name <> 'link_code';
  EXECUTE format('GRANT SELECT (%s) ON public.stores TO authenticated', cols);
END $$;

CREATE TABLE IF NOT EXISTS public.store_distributors (
  store_id       bigint NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  distributor_id bigint NOT NULL REFERENCES public.distributors (id) ON DELETE RESTRICT,
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, distributor_id)
);
CREATE INDEX IF NOT EXISTS idx_store_distributors_distributor ON public.store_distributors (distributor_id);

ALTER TABLE public.store_distributors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS store_distributors_select ON public.store_distributors;
CREATE POLICY store_distributors_select ON public.store_distributors
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador' AND store_id = ANY (public.my_store_ids()))
         OR (public.my_role() = 'distribuidor' AND distributor_id = public.my_distributor_id()));
REVOKE ALL ON public.store_distributors FROM anon, authenticated;
GRANT SELECT ON public.store_distributors TO authenticated;

-- ¿El usuario es dueño de la tienda (o admin)?
CREATE OR REPLACE FUNCTION public.internal_can_manage_store(p_store bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.my_role() = 'admin'
      OR EXISTS (SELECT 1 FROM public.stores s
                 WHERE s.id = p_store AND s.created_by = auth.uid() AND public.my_role() IS NOT NULL);
$$;

CREATE OR REPLACE FUNCTION public.get_store_link_code(p_store bigint)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_code text;
BEGIN
  IF NOT public.internal_can_manage_store(p_store) THEN
    RAISE EXCEPTION 'store_link: solo el dueño de la tienda o un admin';
  END IF;
  SELECT link_code INTO v_code FROM public.stores WHERE id = p_store;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.regenerate_store_link_code(p_store bigint)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_code text := encode(extensions.gen_random_bytes(9), 'hex');
BEGIN
  IF NOT public.internal_can_manage_store(p_store) THEN
    RAISE EXCEPTION 'store_link: solo el dueño de la tienda o un admin';
  END IF;
  UPDATE public.stores SET link_code = v_code, updated_at = now() WHERE id = p_store;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_distributor_to_store(p_code text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_dist  bigint := public.my_distributor_id();
  v_store bigint;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'distribuidor' OR v_dist IS NULL THEN
    RAISE EXCEPTION 'store_link: solo un distribuidor activo puede vincularse';
  END IF;
  SELECT id INTO v_store FROM public.stores
  WHERE link_code = trim(p_code) AND is_active;
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'store_link: código de tienda inválido o tienda inactiva';
  END IF;
  INSERT INTO public.store_distributors (store_id, distributor_id, created_by)
  VALUES (v_store, v_dist, auth.uid())
  ON CONFLICT (store_id, distributor_id) DO NOTHING;
  RETURN v_store;
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_distributor(p_store bigint, p_distributor bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.internal_can_manage_store(p_store) THEN
    RAISE EXCEPTION 'store_link: solo el dueño de la tienda o un admin';
  END IF;
  DELETE FROM public.store_distributors
  WHERE store_id = p_store AND distributor_id = p_distributor;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.internal_can_manage_store(bigint),
  public.get_store_link_code(bigint), public.regenerate_store_link_code(bigint),
  public.link_distributor_to_store(text), public.unlink_distributor(bigint, bigint)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.internal_can_manage_store(bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_store_link_code(bigint), public.regenerate_store_link_code(bigint),
  public.link_distributor_to_store(text), public.unlink_distributor(bigint, bigint)
  TO authenticated, service_role;

-- INVERSE (inerte; descomentar a mano en una transacción para revertir):
-- DROP FUNCTION IF EXISTS public.unlink_distributor(bigint, bigint);
-- DROP FUNCTION IF EXISTS public.link_distributor_to_store(text);
-- DROP FUNCTION IF EXISTS public.regenerate_store_link_code(bigint);
-- DROP FUNCTION IF EXISTS public.get_store_link_code(bigint);
-- DROP FUNCTION IF EXISTS public.internal_can_manage_store(bigint);
-- DROP TABLE IF EXISTS public.store_distributors;
-- GRANT SELECT ON public.stores TO authenticated;
-- DROP INDEX IF EXISTS public.uq_stores_link_code;
-- ALTER TABLE public.stores DROP COLUMN IF EXISTS link_code;
