-- Entity: users | Source: 20261015000002_tables_reused.sql:69-87 (CREATE TABLE + índice) · 20261015000003_tables_farox.sql:276-278 (FK diferida → distributors) · 20261015000004_functions_triggers.sql:397-416,499-502 (triggers) + 308-360 (trigger-fns) · 20261015000006_rls_grants.sql:32,191-212,362-369 (RLS + grants) · 20261016000011_seguridad.sql:85-139,486-488,545-546 (RPCs finales + lockdown anon) | Order: after auth.users + roles + distributors

-- ============================================================================
-- 1. CREATE TABLE (verbatim — 20261015000002_tables_reused.sql:69-87)
-- ============================================================================

-- 2.9 users (creada antes que products/stores por created_by) ----------------
-- Nombre `users` conservado por continuidad con NØSEE (D8). No es auth.users.
CREATE TABLE public.users (
  id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,  -- mod: NO ACTION → CASCADE (D8)
  role_id             integer NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  full_name           text NOT NULL,
  email               text UNIQUE,                          -- FAROX: copia de auth.users.email vía trigger sync_email()
  phone_number        text,
  contact_preference  public.contact_preference NOT NULL DEFAULT 'whatsapp',  -- FAROX
  distributor_id      bigint NULL,                          -- FK → distributors agregada en 0003
  premium             boolean NOT NULL DEFAULT false,       -- FAROX: fuente única de verdad (D7)
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
  -- Eliminadas de NØSEE: reputation_points, avatar_url, mp_customer_id, onboarding_completed, is_verified
);

CREATE INDEX idx_users_distributor_id ON public.users (btree (distributor_id));
-- Diferidos (D22): btree (role_id), btree (lower(full_name)) — 27 usuarios ⇒ ruido puro.

-- FK diferida a distributors (verbatim — 20261015000003_tables_farox.sql:276-278):
ALTER TABLE public.users
  ADD CONSTRAINT users_distributor_id_fkey
  FOREIGN KEY (distributor_id) REFERENCES public.distributors(id) ON DELETE SET NULL;  -- 1 usuario ↔ 1 distribuidor (D29)

-- Índices: solo idx_users_distributor_id (grep verificado en 0002:86).
-- NO existen (diferidos D22): btree(role_id), btree(lower(full_name)).

-- ============================================================================
-- 2. TRIGGERS (verbatim — 20261015000004_functions_triggers.sql)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON public.users FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();
-- 0004:408-411 · fn touch_updated_at: 0004:253-259 (compartida, NO duplicada acá)

DROP TRIGGER IF EXISTS trg_users_sanitize_scope ON public.users;
CREATE TRIGGER trg_users_sanitize_scope
BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW
EXECUTE FUNCTION public.sanitize_distributor_scope();
-- 0004:413-416

DROP TRIGGER IF EXISTS trg_audit_users ON public.users;
CREATE TRIGGER trg_audit_users
AFTER INSERT OR UPDATE OR DELETE ON public.users FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();
-- 0004:499-502 · fn audit_diff: 0004:266-294, redefinida (R10, mismo semántica) en 20261016000010_perf.sql:283-315

-- Triggers SOBRE auth.users que escriben en public.users (verbatim — 0004:397-406):
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
AFTER UPDATE OF email ON auth.users FOR EACH ROW
WHEN (OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION public.sync_email();
-- 0004:397-406 · 0008:362-376 verifica que sigan presentes (signup SIN fila users = sistema de permisos caído)

-- ============================================================================
-- 3. TRIGGER-FUNCTIONS propias de users (verbatim — 0004)
-- ============================================================================

-- M11: red de seguridad además de update_user_role — rol distribuidor ⇒
-- distributor_id NOT NULL; otro rol ⇒ NULL (evita scope RLS huérfano).
CREATE OR REPLACE FUNCTION public.sanitize_distributor_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text;
BEGIN
  SELECT r.name INTO v_role FROM public.roles r WHERE r.id = NEW.role_id;
  IF v_role = 'distribuidor' THEN
    IF NEW.distributor_id IS NULL THEN
      RAISE EXCEPTION 'M11: el rol distribuidor requiere distributor_id';
    END IF;
  ELSE
    NEW.distributor_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
-- 0004:308-325

-- C2: sin esto el primer login no tiene fila users y todo el sistema de permisos
-- cae. Rol por defecto = operador (rol neutro de ejecución; admin luego con
-- update_user_role). Requiere el seed de roles (0005) — si falta, avisa.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.users (id, role_id, full_name, email)
  SELECT NEW.id,
         r.id,
         COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
                  NULLIF(split_part(NEW.email, '@', 1), ''),
                  'Usuario'),
         NEW.email
  FROM public.roles r
  WHERE r.name = 'operador'
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'roles sin sembrar: no existe el rol "operador" (correr 20261015000005_seeds.sql)';
  END IF;
  RETURN NEW;
END;
$$;
-- 0004:327-348

-- Copia de auth.users.email → users.email en ediciones posteriores
-- (PostgREST no puede leer auth.users con el JWT del cliente).
CREATE OR REPLACE FUNCTION public.sync_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.users
  SET email = NEW.email, updated_at = now()
  WHERE id = NEW.id AND public.users.email IS DISTINCT FROM NEW.email;
  RETURN NEW;
END;
$$;
-- 0004:350-360

-- Trigger-fns COMPARTIDAS que users invoca (definiciones NO duplicadas acá):
--   touch_updated_at → 20261015000004_functions_triggers.sql:253-259
--   audit_diff       → 20261015000004_functions_triggers.sql:266-294
--                      (redefinición R10: 20261016000010_perf.sql:283-315)

-- ============================================================================
-- 4. RLS (verbatim — 20261015000006_rls_grants.sql)
-- ============================================================================

ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
-- 0006:32 · RLS habilitado: SÍ

-- users (§8 fila 6): SELECT fila propia o admin; UPDATE = policy admin (rol/
-- premium/actividad) + policy FILA PROPIA con GRANT por columna de perfil
-- (D45, cierra la excepción D37 "perfil propio"); INSERT via trigger; DELETE
-- nunca (baja = is_active).
-- D45: grants ≠ RLS — la policy decide QUÉ filas, el GRANT QUÉ columnas:
-- full_name/phone_number/contact_preference se editan directo; los
-- privilegiados (id, role_id, email, distributor_id, premium, is_active)
-- solo via RPC/trigger/SQL editor (ver GRANT/REVOKE abajo) — D47 añade
-- set_user_premium()/set_user_active() como ruta RPC para premium/is_active.
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.my_role() = 'admin');
CREATE POLICY users_update ON public.users
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
-- Excepción D37 "perfil propio" (D45): el usuario muta SOLO su fila; las
-- columnas que puede tocar las limita el GRANT por columna de abajo.
CREATE POLICY users_update_own ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- 0006:191-212 · Esperado: 3 policies (SELECT + UPDATE admin + UPDATE propia) — 0008:157
-- Sin policy INSERT (la alta es vía trigger handle_new_user) ni DELETE (baja = is_active).

-- ============================================================================
-- 5. GRANTs / REVOKEs (verbatim — 0006:362-369)
-- ============================================================================

-- D45: UPDATE de users = SOLO columnas de perfil. El default de Supabase
-- grantea UPDATE de tabla completa a authenticated y anon; con la policy
-- propia, un usuario podría mutar role_id/premium/is_active de SU fila.
-- Los privilegiados se mutan SOLO vía RPC/trigger/SQL editor (D47: premium/
-- is_active vía set_user_premium/set_user_active) — el grant por
-- columna aplica también al admin (todos comparten el rol PG authenticated).
REVOKE UPDATE ON public.users FROM authenticated, anon;
GRANT UPDATE (full_name, phone_number, contact_preference) ON public.users TO authenticated;
-- 0006:362-369 · Verificación V11: 0008:417-463

-- Lockdown anon (defensa en profundidad sobre TODAS las tablas de public, incl. users):
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
-- 20261016000011_seguridad.sql:545-546
-- No existe GRANT de SELECT/INSERT/DELETE de tabla para users: usan los defaults de Supabase + RLS.

-- ============================================================================
-- 6. RPCs que operan PRIMARIAMENTE sobre users (nombre + ubicación)
-- ============================================================================
--   update_user_role(uuid, text, bigint)  → 0004:544-569 · cuerpo final 0011:85-108 (guard assert_admin)
--   set_user_premium(uuid, boolean)       → 0004:575-590 · cuerpo final 0011:111-124
--   set_user_active(uuid, boolean)        → 0004:592-607 · cuerpo final 0011:126-139
--   GRANT EXECUTE (whitelist)             → 0011:486-488 (TO authenticated, service_role)
-- Helpers STABLE que LEEN users (0004:31-76; con is_active enforced: 0009:40-89):
--   my_role() · is_premium() · my_distributor_id() · has_scope()
--   (my_store_ids() lee user_stores — los 5 helpers consolidados en 00_foundation.sql §3)
-- Ninguna RPC hace INSERT/DELETE directo en users: altas = trigger, borrados = no existen.
