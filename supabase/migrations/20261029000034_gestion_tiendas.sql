-- ============================================================================
-- FAROX — 0034: gestión de tiendas (desactivar, reactivar, transferir).
--
--   · El dueño puede desactivar su tienda (soft-delete) para liberar cupo o
--     porque ya no la usa; no se borran datos y se bloquea si hay pedidos
--     abiertos. El admin puede forzar.
--   · El dueño/admin puede reactivar una tienda desactivada por el dueño.
--   · El admin puede transferir la propiedad a otro operador/admin activo,
--     respetando el tope de 1/3 tiendas del nuevo dueño y moviendo user_stores.
--   · El UPDATE directo de stores queda acotado a columnas de edición: el
--     dueño no puede saltarse estos guards con un PATCH a is_active.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_is_premium(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = p_user
      AND u.is_active
      AND (r.name = 'admin'
           OR (u.premium AND (u.premium_until IS NULL OR u.premium_until > now())))
  );
$$;

CREATE OR REPLACE FUNCTION public.deactivate_store(
  p_store bigint,
  p_force boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role   text := COALESCE(public.my_role(), '');
  v_owner  uuid;
  v_active boolean;
BEGIN
  SELECT created_by, is_active INTO v_owner, v_active
  FROM public.stores WHERE id = p_store FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deactivate_store: tienda inexistente: %', p_store;
  END IF;
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'deactivate_store: sin rol para desactivar tiendas';
  END IF;
  IF v_role <> 'admin' AND v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'deactivate_store: no sos dueño de la tienda %', p_store;
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'deactivate_store: la tienda % ya está inactiva', p_store;
  END IF;
  IF NOT (v_role = 'admin' AND p_force) AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.store_id = p_store AND o.status IN ('pending', 'in_route')
  ) THEN
    RAISE EXCEPTION 'deactivate_store: la tienda % tiene pedidos abiertos; entregalos o cancelalos primero',
      p_store;
  END IF;

  UPDATE public.stores
  SET is_active = false,
      deactivated_reason = CASE
        WHEN v_role = 'admin' THEN 'admin_deactivated'
        ELSE 'user_removed'
      END,
      deactivated_at = now(),
      updated_at = now()
  WHERE id = p_store;
END;
$$;

CREATE OR REPLACE FUNCTION public.reactivate_store(p_store bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role   text := COALESCE(public.my_role(), '');
  v_owner  uuid;
  v_active boolean;
  v_reason text;
BEGIN
  -- Mismo orden que 0033 (lock por usuario antes de tocar filas): evita
  -- deadlocks con choose_store_for_free_plan/reactivate_premium_stores.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text, 0)
  );
  SELECT created_by, is_active, deactivated_reason
    INTO v_owner, v_active, v_reason
  FROM public.stores WHERE id = p_store FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reactivate_store: tienda inexistente: %', p_store;
  END IF;
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'reactivate_store: sin rol para reactivar tiendas';
  END IF;
  IF v_role <> 'admin' AND v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'reactivate_store: no sos dueño de la tienda %', p_store;
  END IF;
  IF v_active THEN
    RAISE EXCEPTION 'reactivate_store: la tienda % ya está activa', p_store;
  END IF;
  IF v_reason = 'premium_expired' AND NOT public.is_premium() THEN
    RAISE EXCEPTION 'reactivate_store: renová Premium para reactivar tiendas pausadas por plan';
  END IF;
  IF v_role <> 'admin' AND v_reason IS DISTINCT FROM 'user_removed' THEN
    RAISE EXCEPTION 'reactivate_store: solo un administrador puede reactivar esta tienda';
  END IF;

  UPDATE public.stores
  SET is_active = true,
      deactivated_reason = NULL,
      deactivated_at = NULL,
      updated_at = now()
  WHERE id = p_store;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_store(
  p_store bigint,
  p_new_owner uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_old_owner   uuid;
  v_store_active boolean;
  v_new_role    text;
  v_active      integer;
  v_cap         integer;
BEGIN
  PERFORM public.assert_admin();
  IF p_new_owner IS NULL THEN
    RAISE EXCEPTION 'transfer_store: elegí el nuevo dueño';
  END IF;
  -- Mismo orden que 0033: lock del usuario antes de tocar filas. Serializa el
  -- tope del nuevo dueño con sus altas/reactivaciones y evita deadlocks.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_new_owner::text, 0)
  );
  SELECT created_by, is_active INTO v_old_owner, v_store_active
  FROM public.stores WHERE id = p_store FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer_store: tienda inexistente: %', p_store;
  END IF;
  IF p_new_owner = v_old_owner THEN
    RAISE EXCEPTION 'transfer_store: la tienda ya pertenece a ese usuario';
  END IF;
  SELECT r.name INTO v_new_role
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id
  WHERE u.id = p_new_owner AND u.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer_store: usuario inexistente o inactivo';
  END IF;
  IF v_new_role NOT IN ('operador', 'admin') THEN
    RAISE EXCEPTION 'transfer_store: el nuevo dueño debe ser operador o admin';
  END IF;

  IF v_store_active AND v_new_role <> 'admin' THEN
    SELECT count(*) INTO v_active
    FROM public.stores
    WHERE created_by = p_new_owner AND is_active;
    v_cap := CASE WHEN public.user_is_premium(p_new_owner) THEN 3 ELSE 1 END;
    IF v_active >= v_cap THEN
      RAISE EXCEPTION 'transfer_store: el nuevo dueño ya tiene el tope de % tiendas activas', v_cap;
    END IF;
  END IF;

  UPDATE public.stores
  SET created_by = p_new_owner, updated_at = now()
  WHERE id = p_store;

  DELETE FROM public.user_stores
  WHERE store_id = p_store AND user_id = v_old_owner;
  INSERT INTO public.user_stores (user_id, store_id)
  VALUES (p_new_owner, p_store)
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.user_is_premium(uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.deactivate_store(bigint, boolean),
  public.reactivate_store(bigint),
  public.transfer_store(bigint, uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.deactivate_store(bigint, boolean),
  public.reactivate_store(bigint),
  public.transfer_store(bigint, uuid)
TO authenticated, service_role;

-- ============================================================================
-- 5. UPDATE directo acotado en stores.
--
-- Sin esto, el dueño podría saltarse los guards de las RPC con un PATCH
-- directo a is_active/deactivated_reason (la policy stores_update no acota
-- columnas). Se revoca el UPDATE de tabla y se re-otorga solo lo editable:
-- created_by, is_active y deactivated_* cambian únicamente por RPC.
-- ============================================================================
REVOKE UPDATE ON public.stores FROM authenticated;
DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ') INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'stores'
    AND column_name IN (
      'name', 'store_type_id', 'address', 'city', 'phone',
      'location', 'website_url', 'country'
    );
  IF cols IS NOT NULL THEN
    EXECUTE format('GRANT UPDATE (%s) ON public.stores TO authenticated', cols);
  END IF;
END $$;

-- ============================================================================
-- Verificación manual (SQL editor):
--   · Dueño desactiva su tienda sin pedidos abiertos ⇒ is_active=false,
--     reason='user_removed'; con pedido pending ⇒ excepción.
--   · Dueño reactiva una tienda user_removed ⇒ activa si el tope lo permite.
--   · Admin transfiere a un operador activo ⇒ created_by y user_stores cambian;
--     el dueño anterior pierde el alcance. Si el nuevo dueño ya está en el
--     tope, excepción. Distribuidor/inactivo ⇒ excepción.
-- ============================================================================

-- INVERSE (inerte; descomentar a mano en UNA transacción para revertir):
--   DROP FUNCTION IF EXISTS public.transfer_store(bigint, uuid);
--   DROP FUNCTION IF EXISTS public.reactivate_store(bigint);
--   DROP FUNCTION IF EXISTS public.deactivate_store(bigint, boolean);
--   DROP FUNCTION IF EXISTS public.user_is_premium(uuid);
