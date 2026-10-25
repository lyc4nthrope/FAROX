-- ============================================================================
-- 0015 — Guards de registro y "último administrador"
-- ----------------------------------------------------------------------------
-- Cierra: F5 (carrera de auto-registro de distribuidor), F2 (un admin se
-- degradaba a distribuidor desde setting-up), F12-BD (se podía dejar el
-- sistema sin ningún admin activo).
--
-- Requisitos que se conservan SIN CAMBIOS:
--   · Firmas idénticas a 0013/0011 ⇒ NO cambia la whitelist (sigue en 32
--     firmas: 31 de 0011 + register_distributor de 0013). CREATE OR REPLACE
--     conserva los grants ya otorgados.
--   · Los 7 pasos de register_distributor de 0013, con 3 guards nuevos.
--   · Mensaje uniforme 'solo admin' de assert_admin (contrato H3 de 0012).
--
-- Decisión nueva (se documenta en Base de datos FAROX.md §4/§9):
--   "El autorregistro de distribuidor solo lo puede hacer una cuenta en el
--    rol por defecto `operador`, sin tiendas. El admin verifica el NIT en
--    Distribuidores y puede desactivarlo."
--
-- Idempotente: CREATE OR REPLACE + REVOKE determinista. Re-ejecutable.
-- ============================================================================

-- ============================================================================
-- (a) register_distributor — mismos 7 pasos de 0013 + 3 guards nuevos.
-- ----------------------------------------------------------------------------
-- El guard de rol va DESPUÉS del lock y ANTES de cualquier otra lectura:
--   · FOR UPDATE OF u serializa dos llamadas concurrentes del mismo usuario
--     (F5: antes del lock ambas veían distributor_id NULL y creaban DOS
--     distribuidores + dos UPDATE sobre la misma fila de users).
--   · El rol debe seguir siendo `operador`: un admin o un distribuidor ya
--     asignado NUNCA se auto-degrada (F2: la rama [Distribuidor] del
--     onboarding se podía abrir desde "Configurar mi tienda" estando logueado
--     como admin).
--   · NULL-safe: se usa IS DISTINCT FROM, no <>. Un users.role_id NULL (fila
--     corrupta/legacy) NO pasa el guard; <> con NULL da NULL y el IF no se
--     tomaría (mismo NULL-bypass que motivó D49/assert_admin).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_distributor(
  p_name                 text,
  p_nit                  text,
  p_contact_name         text DEFAULT NULL,
  p_phone                text DEFAULT NULL,
  p_email                text DEFAULT NULL,
  p_contact_preference   public.contact_preference DEFAULT 'whatsapp'
) RETURNS bigint            -- id del distributor creado
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id       bigint;
  v_prior    bigint;
  v_role     text;
  v_claims   bigint;
BEGIN
  -- 1 · Guard sesión (patrón create_store, 0004:649-651)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'register_distributor: requiere sesión';
  END IF;
  -- 2 · Guard is_active (kill-switch; Q1=A, #534) — my_role() = NULL para
  --     inactivo (0009:40-46, R3/D-3)
  IF public.my_role() IS NULL THEN
    RAISE EXCEPTION 'register_distributor: usuario inactivo';
  END IF;
  -- 3 · F5 — lock de la fila propia + rol actual en UNA sola lectura.
  --     El lock se toma sobre el mismo SELECT para que el guard de rol y el
  --     cap-1 no puedan intercalarse con otra llamada concurrente.
  SELECT u.distributor_id, r.name
    INTO v_prior, v_role
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id
  WHERE u.id = auth.uid()
  FOR UPDATE OF u;
  -- 3a · F2 — solo una cuenta nueva sin rol asignado por el admin.
  IF v_role IS DISTINCT FROM 'operador' THEN
    RAISE EXCEPTION 'register_distributor: solo una cuenta nueva sin rol asignado puede registrarse como distribuidor';
  END IF;
  -- 3b · No se auto-registra quien ya opera tiendas: pedir el cambio al admin
  --      (evita perder el alcance de user_stores sin aviso). my_store_ids()
  --      filtra por auth.uid() explícitamente ⇒ correcto bajo DEFINER.
  IF cardinality(public.my_store_ids()) > 0
     OR EXISTS (SELECT 1 FROM public.stores s WHERE s.created_by = auth.uid()) THEN
    RAISE EXCEPTION 'register_distributor: la cuenta ya tiene tiendas; pedile al admin el cambio de rol';
  END IF;
  -- 3c · Cap-1 primario (espejo D34, 0004:375-377): ya sostiene un
  --      distributor ⇒ rechazada (v_prior viene del SELECT bloqueado de 3)
  IF v_prior IS NOT NULL THEN
    RAISE EXCEPTION 'ya tenés un distribuidor asociado';
  END IF;
  -- 3d · Cap-2 anti-huérfano (orphan-cap, design §3 candidata i):
  --      distributors NO tiene created_by (0003:13-24) ⇒ el bookkeeping vivo
  --      del "ya reclamé" es el propio audit_log: trg_audit_distributors ya
  --      escribe created_by=auth.uid() en cada INSERT (0004:290-291,515-517).
  --      ⚠ audit_log es append-only: NO purgar mientras este cap dependa de él.
  SELECT count(*) INTO v_claims
  FROM public.audit_log a
  WHERE a.table_name = 'distributors'
    AND a.action = 'insert'
    AND a.created_by = auth.uid();
  IF v_claims >= 1 THEN
    RAISE EXCEPTION 'register_distributor: ya registraste un distribuidor (1 por usuario); contactá al admin para reasignación';
  END IF;
  -- 4 · Validación name + NIT (UNIQUE NOT NULL, 0003:16): trim + no vacío
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'register_distributor: nombre requerido';
  END IF;
  IF p_nit IS NULL OR length(trim(p_nit)) = 0 THEN
    RAISE EXCEPTION 'register_distributor: NIT requerido';
  END IF;
  -- 5 · INSERT distributors (caller sin INSERT, 0006:128-129) —
  --     unique_violation sobre nit ⇒ mensaje de dominio, no crudo SQL
  BEGIN
    INSERT INTO public.distributors (name, nit, contact_name, phone, email, contact_preference)
    VALUES (trim(p_name), trim(p_nit), p_contact_name, p_phone, p_email, p_contact_preference)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'register_distributor: ya existe un distribuidor con ese NIT';
  END;
  -- 6 · UN SOLO UPDATE users — M11 sanitize_distributor_scope (BEFORE trigger,
  --     0004:316-319) exige role_id='distribuidor' + distributor_id en el
  --     MISMO NEW; dos statements = el 1º (solo role_id) sería RECHAZADO.
  UPDATE public.users
  SET role_id = (SELECT r.id FROM public.roles r WHERE r.name = 'distribuidor'),
      distributor_id = v_id,
      updated_at = now()
  WHERE id = auth.uid();
  -- 7 · Auditoría: AUTOMÁTICA vía trg_audit_distributors (INSERT, audit #1) +
  --     trg_audit_users (UPDATE, audit #2) ⇒ 2 filas con created_by=auth.uid()
  --     (R-D5.7). SIN fila explícita: duplicaría el count del cap 3d (§4).
  RETURN v_id;
END;
$$;

-- (b) Defensa en profundidad (D48): 0011:458 ya deja las funciones nuevas sin
-- EXECUTE para PUBLIC/anon vía ALTER DEFAULT PRIVILEGES FOR ROLE postgres, así
-- que `anon` no podía invocarla. Se deja explícito igualmente para que la
-- intención no dependa de un default privilege configurado en otra migración.
-- Determinista e idempotente: re-ejecutar no tiene efecto.
REVOKE EXECUTE ON FUNCTION
  public.register_distributor(text, text, text, text, text, public.contact_preference)
FROM PUBLIC, anon;

-- Whitelist 32 sin cambios (0013:190-192) — el GRANT a authenticated se
-- conserva porque REVOKE de arriba sólo afecta a PUBLIC/anon.

-- ============================================================================
-- (c) update_user_role — guard "último admin" (F12-BD).
-- ----------------------------------------------------------------------------
-- Firma idéntica (0011:85-87). Cuerpo de 0011 + comprobación antes del UPDATE.
-- pg_advisory_xact_lock serializa las mutaciones de rol: sin él, dos
-- degradaciones concurrentes de los dos últimos admins leen ambas "hay 2" y
-- dejan el sistema sin admin. El lock es por transacción ⇒ se libera solo.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_user_role(
  p_user uuid, p_role text, p_distributor bigint DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role_id       integer;
  v_target_role   text;
  v_target_active boolean;
  v_admins        integer;
BEGIN
  PERFORM public.assert_admin();  -- D-4: uniformidad + is_active
  PERFORM pg_advisory_xact_lock(hashtext('farox:last_admin'));
  IF p_role = 'distribuidor' AND p_distributor IS NULL THEN
    RAISE EXCEPTION 'M11: rol distribuidor requiere distributor_id';
  END IF;
  SELECT id INTO v_role_id FROM public.roles WHERE name = p_role;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rol inexistente: %', p_role;
  END IF;
  SELECT r.name, u.is_active INTO v_target_role, v_target_active
  FROM public.users u
  LEFT JOIN public.roles r ON r.id = u.role_id
  WHERE u.id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'usuario inexistente: %', p_user;
  END IF;
  -- F12-BD: degradar al único admin activo deja el sistema sin quien administre
  IF v_target_role = 'admin' AND v_target_active AND p_role <> 'admin' THEN
    SELECT count(*) INTO v_admins
    FROM public.users u JOIN public.roles r ON r.id = u.role_id
    WHERE r.name = 'admin' AND u.is_active;
    IF v_admins <= 1 THEN
      RAISE EXCEPTION 'no se puede quitar el último administrador activo';
    END IF;
  END IF;
  UPDATE public.users
  SET role_id = v_role_id,
      distributor_id = CASE WHEN p_role = 'distribuidor' THEN p_distributor ELSE NULL END
  WHERE id = p_user;
END;
$$;

-- ============================================================================
-- (d) set_user_active — mismo guard (F12-BD).
-- ----------------------------------------------------------------------------
-- Firma idéntica (0011:126-128). Desactivar al único admin activo equivale a
-- degradarlo para el sistema: assert_admin() exige is_active, así que nadie
-- podría volver a activarlo. p_value IS FALSE es NULL-safe.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_user_active(
  p_user_id uuid, p_value boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_target_role   text;
  v_target_active boolean;
  v_admins        integer;
BEGIN
  PERFORM public.assert_admin();  -- D-4
  PERFORM pg_advisory_xact_lock(hashtext('farox:last_admin'));
  SELECT r.name, u.is_active INTO v_target_role, v_target_active
  FROM public.users u
  LEFT JOIN public.roles r ON r.id = u.role_id
  WHERE u.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'usuario inexistente: %', p_user_id;
  END IF;
  IF p_value IS FALSE AND v_target_role = 'admin' AND v_target_active THEN
    SELECT count(*) INTO v_admins
    FROM public.users u JOIN public.roles r ON r.id = u.role_id
    WHERE r.name = 'admin' AND u.is_active;
    IF v_admins <= 1 THEN
      RAISE EXCEPTION 'no se puede quitar el último administrador activo';
    END IF;
  END IF;
  UPDATE public.users
  SET is_active = p_value, updated_at = now()
  WHERE id = p_user_id;
END;
$$;

-- ============================================================================
-- INVERSE (comentado — convención 0009:29). NO ejecutar sin revisión.
--   (a) restaurar el cuerpo de register_distributor de 0013:112-186 (sin los
--       guards 3/3a/3b, con el SELECT de 3c sin FOR UPDATE).
--   (b) eliminar el REVOKE de arriba y confiar en el GRANT de 0013:190-192.
--   (c) restaurar update_user_role de 0011:85-108 (sin v_target_* ni el
--       count de admins).
--   (d) restaurar set_user_active de 0011:126-139.
--   NOTA: (c)/(d) reabren F12-BD. Sólo revertir junto con la UI que avisa.
-- ============================================================================
