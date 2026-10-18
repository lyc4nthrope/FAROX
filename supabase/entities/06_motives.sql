-- Entity: motives | Source: 0003_tables_farox.sql:L26-33 (tabla), 0006_rls_grants.sql:L39 (ENABLE RLS), L86-87+L99-108 (policies), 0011_seguridad.sql:L545 (REVOKE anon) | Order: after 00_foundation.sql (enum movement_type) y tras DDL cuyo helper de policies (public.my_role, 0004:L31-37) esté definido
-- ════════════════════════════════════════════════════════════════════════════
-- motives — catálogo de motivos/origen de movimiento (DIST-04, §3.3).
-- Sugerido por movements.motive_id (ON DELETE RESTRICT, 0003:95).
-- La fila 'reabastecimiento' es OBLIGATORIA: confirm_delivery() depende de ella
-- (0004:1010-1013; aviso si falta en 0008:313-315).
-- ════════════════════════════════════════════════════════════════════════════

-- CREATE TABLE — 0003_tables_farox.sql:26-33 (VERBATIM)
-- 3.3 motives — catálogo de motivos/origen (DIST-04 resuelto aquí) -----------
CREATE TABLE public.motives (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL UNIQUE,          -- seed obligatorio (§7): venta, reabastecimiento, devolución, merma, ajuste
  suggested_type  public.movement_type NULL,     -- entry/exit sugerido; NULL = aplica a ambos (p.ej. ajuste)
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Índices — NINGUNO adicional. Grep de "CREATE INDEX|CREATE UNIQUE INDEX" en
-- supabase/migrations/ no arroja ningún índice sobre motives: solo la PK
-- implícita y el UNIQUE inline en name (0003:29).

-- Triggers — NINGUNO. Grep de "CREATE TRIGGER" en supabase/migrations/ no
-- tiene ninguna entrada sobre motives (lista completa: 0004:397-537,
-- 0009:504). Confirmado además en el comentario de 0004:250-252: "y a tablas
-- sin updated_at: motives, route_stops, alerts, user_stores." ⇒ no aplica
-- touch_updated_at() ni audit_diff().

-- ============================================================================
-- RLS — 0006_rls_grants.sql (VERBATIM)
-- ENABLE (L39) + matriz catálogo (L86-87 + L99-108). DELETE = soft: solo
-- filas ya desactivadas (is_active = false), igual que brands.
ALTER TABLE public.motives            ENABLE ROW LEVEL SECURITY;

-- brands/motives tienen is_active ⇒ el DELETE de la matriz es soft:
-- solo purga filas ya desactivadas.
CREATE POLICY catalogs_select ON public.motives
  FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogs_insert ON public.motives
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_update ON public.motives
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_delete ON public.motives
  FOR DELETE TO authenticated
  USING (public.my_role() = 'admin' AND is_active = false);

-- GRANTs — SIN GRANT/REVOKE explícito por tabla para motives en ninguna
-- migración (grep "public\.motives" cruzado con GRANT/REVOKE: 0 coincidencias).
-- Única sentencia de grants que la toca (0011_seguridad.sql:545, VERBATIM):
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
-- (0011:538-544: anon pierde todo acceso a tablas de public.)

-- RPC primaria sobre esta tabla — NINGUNA la MUTA (seed en 0005:61). Lectoras
-- por lookup del motivo 'reabastecimiento':
--   · confirm_delivery()  0004_functions_triggers.sql:1010 (redef. 0009:262,
--     versión también en 0010_perf.sql:109) — su tabla principal es orders.
