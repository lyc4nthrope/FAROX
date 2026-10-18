-- Entity: stores | Source: 20261015000002_tables_reused.sql:122-142 (CREATE TABLE + nota de índices) · 20261015000004_functions_triggers.sql:433-441,509-512 (triggers) + 362-380 (enforce_store_cap) + 1536-1548 (vista stores_geo) · 20261016000009_negocio.sql:485-507 (fn + trigger de reactivación) · 20261015000006_rls_grants.sql:34,160-174,359-360 (RLS + grants) · 20261016000011_seguridad.sql:490,532-536,545-546 | Order: after store_types + users (created_by) — OJO: NO tiene FK a distributors (ver nota de dependencias al final)

-- ============================================================================
-- 1. CREATE TABLE (verbatim — 20261015000002_tables_reused.sql:122-138)
-- ============================================================================

-- 2.7 stores -----------------------------------------------------------------
CREATE TABLE public.stores (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- mod: NØSEE uuid → bigint (D1)
  store_type_id integer NOT NULL REFERENCES public.store_types(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  address       text,
  city          text,                                        -- FAROX (p.7)
  country       char(2) NOT NULL DEFAULT 'CO',               -- FAROX: multi-país desde el día 1 (D26)
  phone         text,                                        -- FAROX (p.7)
  location      public.geography(Point,4326) NOT NULL,       -- PostGIS (D12); NØSEE lo tenía nullable ⇒ NOT NULL (doc)
  website_url   text,
  created_by    uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,  -- dueño y actor (D33); solo escribe create_store()
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
  -- Eliminadas de NØSEE: is_admin_hidden + 6 hidden_*, evidence_count
);

-- ============================================================================
-- 2. ÍNDICES (verbatim — 20261015000002_tables_reused.sql:139-142)
-- ============================================================================

-- Índices: PK.
-- Diferidos (D22): GIST (location) con ~1.000 tiendas (NØSEE tiene DOS GIST
-- duplicados sobre location — no copiar ninguno); btree (name) con 25 filas.
-- Acceso lat/lng vía vista stores_geo (§4), no ST_X/ST_Y en el cliente.

-- VERIFICADO por grep en TODAS las migraciones: NO existe ningún CREATE INDEX
-- sobre stores — en particular NO hay GIST sobre location (quedó diferido en
-- D22 y nunca se creó). Unicidad de nombre: tampoco hay unique sobre name.

-- ============================================================================
-- 3. TRIGGERS (verbatim)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_stores_updated_at ON public.stores;
CREATE TRIGGER trg_stores_updated_at
BEFORE UPDATE ON public.stores FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();
-- 20261015000004_functions_triggers.sql:433-436 · fn touch_updated_at: 0004:253-259 (compartida)

DROP TRIGGER IF EXISTS trg_stores_cap ON public.stores;
CREATE TRIGGER trg_stores_cap
BEFORE INSERT ON public.stores FOR EACH ROW
EXECUTE FUNCTION public.enforce_store_cap();
-- 20261015000004_functions_triggers.sql:438-441

DROP TRIGGER IF EXISTS trg_audit_stores ON public.stores;
CREATE TRIGGER trg_audit_stores
AFTER INSERT OR UPDATE OR DELETE ON public.stores FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();
-- 20261015000004_functions_triggers.sql:509-512 · fn audit_diff: 0004:266-294, redefinida en 0010:283-315

DROP TRIGGER IF EXISTS trg_stores_cap_reactivate ON public.stores;
CREATE TRIGGER trg_stores_cap_reactivate
BEFORE UPDATE ON public.stores FOR EACH ROW
WHEN (OLD.is_active = FALSE AND NEW.is_active = TRUE)
EXECUTE FUNCTION public.enforce_store_cap();
-- 20261016000009_negocio.sql:503-507 (cierra evasión del tope D34: desactivar + crear + reactivar)

-- ============================================================================
-- 4. TRIGGER-FUNCTION enforce_store_cap (verbatim — 0009:485-501; cuerpo
--    idéntico al original 0004:364-380, reemplazado por convención D-1)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_store_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_count integer;
  v_cap   integer;
BEGIN
  IF auth.uid() IS NULL OR public.my_role() = 'admin' THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_count FROM public.stores WHERE created_by = auth.uid() AND is_active;
  v_cap := CASE WHEN public.is_premium() THEN 3 ELSE 1 END;  -- 1 activa; 3 si premium; admin exento
  IF v_count >= v_cap THEN
    RAISE EXCEPTION 'D34: tope de tiendas alcanzado (% activas, tope %)', v_count, v_cap;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 5. VISTA stores_geo (verbatim — 0004:1536-1548)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 4.14 Vista stores_geo (§2.7): lat/lng calculados en SERVIDOR; el front no
-- ejecuta ST_X/ST_Y. security_invoker ⇒ respeta RLS de stores (SELECT = true).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.stores_geo
WITH (security_invoker = true) AS
SELECT s.id,
       s.name,
       s.city,
       s.country,
       s.is_active,
       public.st_x(s.location::public.geometry) AS lng,
       public.st_y(s.location::public.geometry) AS lat
FROM public.stores s;

-- ============================================================================
-- 6. RLS (verbatim — 20261015000006_rls_grants.sql)
-- ============================================================================

ALTER TABLE public.stores             ENABLE ROW LEVEL SECURITY;
-- 0006:34 · RLS habilitado: SÍ

-- stores (§8 fila 3): INSERT solo via create_store() (REVOKE abajo, D35);
-- UPDATE admin · dueño (con has_scope() por D37); DELETE admin soft.
CREATE POLICY stores_select ON public.stores
  FOR SELECT TO authenticated USING (true);
CREATE POLICY stores_update ON public.stores
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin'
         OR (created_by = auth.uid() AND public.has_scope()))
  WITH CHECK (public.my_role() = 'admin'
              OR (created_by = auth.uid() AND public.has_scope()));
CREATE POLICY stores_delete ON public.stores
  FOR DELETE TO authenticated
  USING (public.my_role() = 'admin' AND is_active = false);
-- 0006:160-174 · Esperado: 3 policies, SIN INSERT — 0008:157

-- ============================================================================
-- 7. GRANTs / REVOKEs (verbatim — 0006:359-360 y 0011)
-- ============================================================================

-- Alta de tiendas solo por create_store() (D35); UPDATE/DELETE vía policies.
REVOKE INSERT ON public.stores FROM authenticated;
-- 20261015000006_rls_grants.sql:359-360

-- Lockdown anon (cubre stores):
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
-- 20261016000011_seguridad.sql:545-546
-- No hay GRANT explícito de SELECT/UPDATE/DELETE para stores: defaults de Supabase + RLS.

-- GRANTs PostGIS que la vista stores_geo necesita en CLIENTE (verbatim — 0011:532-536):
GRANT EXECUTE ON FUNCTION
  public.st_x(public.geometry),
  public.st_y(public.geometry),
  public.geometry(public.geography)
TO authenticated;

-- ============================================================================
-- 8. RPCs que operan PRIMARIAMENTE sobre stores (nombre + ubicación)
-- ============================================================================
--   create_store(text, integer, text, text, text, geography(Point,4326), text, char(2))
--       → 0004:631-666 · GRANT EXECUTE whitelist 0011:490
--       → inserta en stores (0004:658-660) y auto-asoca al dueño en user_stores (0004:661-663)
--   enforce_store_cap()  → trigger-fn (arriba) — no es RPC para clientes
--   stores_geo (vista)   → arriba · re-grant PostGIS 0011:532-536
-- NO existe RPC de UPDATE/DELETE de stores: la mutación directa va por policies
-- (stores_update/stores_delete) y el INSERT está revocado (solo create_store).

-- NOTA de dependencias (corrección al encargo): stores NO depende de
-- distributors — no hay FK stores→distributors en ninguna migración (grep
-- verificado). Sus FKs reales: store_types (0002:125) y public.users vía
-- created_by (0002:133), que a su vez referencia auth.users.
