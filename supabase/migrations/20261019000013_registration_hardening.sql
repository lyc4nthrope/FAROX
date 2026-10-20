-- ============================================================================
-- FAROX — user-registration, batch DB (0013): REGISTRATION HARDENING
-- Spec:   sdd/user-registration (#536) — D4 (3-guard contract) + D5 (RPC)
-- Design: #538 §2 (contrato EXACTO de register_distributor) · §3 (orphan-cap
--         vía audit_log count) · §4 (auditoría SOLO triggers) · §6 (estructura)
-- Tasks:  #540 T1.0-T1.3 · Q1=A resuelta en #534 (is_active EN 0013)
--
-- DOC-FIRST (T1.0, convención §9 #435 §2) — leer ANTES de aplicar (gate H1):
--   Esta migración es el PRIMER cambio de comportamiento post-lockdown (0011).
--   La anotación doc-first en `Base de datos FAROX.md` §4 (create_store +2
--   guards · fila register_distributor) y §9 (deny-by-default · whitelist
--   31→32 · nota audit_log) es REQUISITO PREVIO a aplicar este archivo.
--   Contrato estricto: contiene EXACTAMENTE los tres guards (a)(b)(c) y
--   NINGÚN otro cambio de comportamiento — verify lo greppa (spec §10):
--     (a) create_store: location exigida con mensaje de dominio
--     (b) create_store: guard is_active (kill-switch completo)
--     (c) register_distributor: RPC NUEVA con su guard is_active dentro
--   La whitelist crece en EXACTAMENTE UN GRANT: register_distributor
--   (31 → 32, 0011:469). Cualquier otra adición = FAIL de verify.
--
--   *** audit_log is append-only: do NOT purge rows while
--       register_distributor's orphan-cap depends on it *** (design §3).
--   El paso 3b de la RPC cuenta INSERTs propios sobre audit_log
--   (table_name='distributors' AND action='insert' AND created_by=uid) para
--   impedir el loop reclamo→demote→re-clamar que dejaría filas distributors
--   HUÉRFANAS (distributors no tiene created_by, 0003:13-24). Purgar el log
--   rompería ese cap en silencio; el cap-1 primario (users.distributor_id)
--   sigue siendo la defensa del caso común (doble defensa).
--
-- Reglas aplicadas:
--  · Append-only: NINGÚN archivo 0001-0012 se edita (convención 0009:8-9).
--  · (a)(b) = CREATE OR REPLACE con MISMA identidad de firma que 0004/0011
--    (0011:490): p_location sigue `DEFAULT NULL` — el guard (a) es de
--    RUNTIME, NO de firma ⇒ la whitelist NO cambia por (a)(b) (S-D4.4).
--    Cambiar la firma (quitar el default) altera la identidad PostgREST y
--    obligaría a re-GRANT — prohibido por el contrato.
--  · (c) es la ÚNICA firma nueva: SECURITY DEFINER + SET search_path
--    (Base:679, anti-hijack PostgREST) + GRANT explícito y quirúrgico
--    (deny-by-default, 0011:456-457). NUNCA anon (0011:464-466).
--  · M11 (sanitize_distributor_scope, 0004:310-325; trigger BEFORE INSERT OR
--    UPDATE 0004:413-416) exige role_id='distribuidor' + distributor_id NOT
--    NULL en el MISMO NEW ⇒ el paso 6 es UN SOLO UPDATE (split en 2 =
--    rechazado por el trigger).
--  · Auditoría de la RPC: SOLO los triggers automáticos trg_audit_distributors
--    (0004:514-517) + trg_audit_users (0004:499-502) ⇒ 2 filas audit_log con
--    created_by=auth.uid() (0004:290-291). SIN fila explícita: duplicaría el
--    count del orphan-cap 3b (design §4 razón 2).
--  · APPLY = GATE HUMANO H1 (SQL editor; sin supabase/config.toml, #435 §6).
--    NO aplicar vía este repo. Post-apply: smoke §7.11 + query S-D5.5.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (a)+(b) create_store — MISMA FIRMA (0004:635-644 = 0011:490), 2 guards.
-- Huecos hoy (#526): p_location DEFAULT NULL (0004:641) + insert verbatim
-- (0004:658-659) ⇒ not_null_violation CRUDO contra stores.location NOT NULL
-- (0002:131); y solo guard auth.uid() (0004:649-651) ⇒ un usuario INACTIVO
-- (baneado vía set_user_active) aún creaba 1 tienda — kill-switch incompleto.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_store(
  p_name          text,
  p_store_type_id integer,
  p_address       text DEFAULT NULL,
  p_city          text DEFAULT NULL,
  p_phone         text DEFAULT NULL,
  p_location      public.geography(Point,4326) DEFAULT NULL,
  p_website_url   text DEFAULT NULL,
  p_country       char(2) DEFAULT 'CO'
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'create_store: requiere sesión';
  END IF;
  -- (b) kill-switch: inactivo pierde rol ⇒ my_role() NULL (0009:40-46, R3/D-3)
  IF public.my_role() IS NULL THEN
    RAISE EXCEPTION 'create_store: usuario inactivo';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'create_store: nombre requerido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.store_types WHERE id = p_store_type_id) THEN
    RAISE EXCEPTION 'store_type inexistente: %', p_store_type_id;
  END IF;
  -- (a) mensaje de dominio en vez de not_null_violation crudo (0002:131).
  --     Guard de RUNTIME — la firma NO cambia (S-D4.4, whitelist intacta).
  IF p_location IS NULL THEN
    RAISE EXCEPTION 'create_store: ubicación requerida';
  END IF;
  INSERT INTO public.stores (name, store_type_id, address, city, phone, location, website_url, country, created_by)
  VALUES (p_name, p_store_type_id, p_address, p_city, p_phone, p_location, p_website_url, COALESCE(p_country, 'CO'), auth.uid())
  RETURNING id INTO v_id;
  -- D35: el dueño obtiene alcance con el mecanismo RLS existente (user_stores)
  INSERT INTO public.user_stores (user_id, store_id) VALUES (auth.uid(), v_id)
  ON CONFLICT DO NOTHING;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- (c) register_distributor — RPC NUEVA (D5, #538 §2 — contrato EXACTO).
-- La ÚNICA violación deliberada del invariante "whitelist 31" (0011:469).
-- Caller (operador autenticado) NO tiene INSERT en distributors (policy
-- admin-only, 0006:128-129) ni UPDATE sobre columnas privilegiadas de users
-- (D45, 0006:368-369) ⇒ sin esta RPC la rama [Distribuidor] del onboarding
-- es IMPOSIBLE; abrir la policy INSERT sería contaminación del lado
-- SUMINISTRO a escala (#528). SECURITY DEFINER corre como owner postgres
-- (FORCE ROW LEVEL SECURITY = 0 en el repo ⇒ owner-bypass válido, #530 §5).
-- 7 pasos, UNA transacción atómica (patrón assign_user_stores 0011:152-157).
-- ---------------------------------------------------------------------------
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
  -- 3 · Cap-1 primario (espejo D34, 0004:375-377): ya sostiene un
  --     distributor ⇒ rechazada
  SELECT u.distributor_id INTO v_prior FROM public.users u WHERE u.id = auth.uid();
  IF v_prior IS NOT NULL THEN
    RAISE EXCEPTION 'ya tenés un distribuidor asociado';
  END IF;
  -- 3b · Cap-2 anti-huérfano (orphan-cap, design §3 candidata i):
  --     distributors NO tiene created_by (0003:13-24) ⇒ el bookkeeping vivo
  --     del "ya reclamé" es el propio audit_log: trg_audit_distributors ya
  --     escribe created_by=auth.uid() en cada INSERT (0004:290-291,515-517).
  --     SECURITY DEFINER lee como owner (policy audit_read es admin-only,
  --     0006:330-332). Semilla del cap: 1ª claim count=0 ⇒ pasa; el INSERT
  --     deja count=1 ⇒ 2ª claim (incl. re-claim tras demote) bloqueada.
  --     ⚠ audit_log es append-only: NO purgar mientras este cap dependa de él.
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
  --     (R-D5.7). SIN fila explícita: duplicaría el count del cap 3b (§4).
  RETURN v_id;
END;
$$;

-- ÚNICO GRANT nuevo de 0013: whitelist 31 → 32 (0011:469). NUNCA anon
-- (0011:464-466). service_role por D-5 (0011:473-474).
GRANT EXECUTE ON FUNCTION
  public.register_distributor(text, text, text, text, text, public.contact_preference)
TO authenticated, service_role;

-- ============================================================================
-- INVERSE (comentado — bloque convención, 0009:29). NO ejecutar sin revisión.
-- (a)(b) → restaurar el cuerpo previo de create_store (0004:635-666, sin los
--   2 guards — copia de seguridad literal):
--     CREATE OR REPLACE FUNCTION public.create_store(
--       p_name text, p_store_type_id integer, p_address text DEFAULT NULL,
--       p_city text DEFAULT NULL, p_phone text DEFAULT NULL,
--       p_location public.geography(Point,4326) DEFAULT NULL,
--       p_website_url text DEFAULT NULL, p_country char(2) DEFAULT 'CO'
--     ) RETURNS bigint
--     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
--     DECLARE v_id bigint;
--     BEGIN
--       IF auth.uid() IS NULL THEN
--         RAISE EXCEPTION 'create_store: requiere sesión';
--       END IF;
--       IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
--         RAISE EXCEPTION 'create_store: nombre requerido';
--       END IF;
--       IF NOT EXISTS (SELECT 1 FROM public.store_types WHERE id = p_store_type_id) THEN
--         RAISE EXCEPTION 'store_type inexistente: %', p_store_type_id;
--       END IF;
--       INSERT INTO public.stores (name, store_type_id, address, city, phone, location, website_url, country, created_by)
--       VALUES (p_name, p_store_type_id, p_address, p_city, p_phone, p_location, p_website_url, COALESCE(p_country, 'CO'), auth.uid())
--       RETURNING id INTO v_id;
--       INSERT INTO public.user_stores (user_id, store_id) VALUES (auth.uid(), v_id)
--       ON CONFLICT DO NOTHING;
--       RETURN v_id;
--     END;
--     $$;
-- (c) → la whitelist vuelve a 31:
--     REVOKE EXECUTE ON FUNCTION
--       public.register_distributor(text, text, text, text, text, public.contact_preference)
--     FROM authenticated, service_role;
--     DROP FUNCTION IF EXISTS
--       public.register_distributor(text, text, text, text, text, public.contact_preference);
-- ============================================================================
