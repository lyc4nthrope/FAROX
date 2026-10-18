-- Entity: REALTIME | Source: 20261015000007_realtime_jobs.sql:L1-54 (VERBATIM — bloque de poda de la publicación realtime) | Order: AFTER 21_alerts.sql y 24_dashboard_daily.sql (publica esas dos tablas; el bloque es idempotente/defensivo pero las tablas deben existir para que el ADD tenga efecto)
-- ════════════════════════════════════════════════════════════════════════════
-- NOTAS de procedencia (grep-verificado sobre supabase/migrations/):
--  · Las sentencias ALTER PUBLICATION ... ADD TABLE viven como strings
--    dinámicos DENTRO del bloque DO $$ ... EXECUTE ... $$ (0007:33,41,46) —
--    no existe ningún ALTER PUBLICATION suelto en el proyecto. Se copia el
--    bloque DO COMPLETO, que es literalmente el que ejecuta esas sentencias.
--  · NO hay "vistas" routes_select / orders_select / etc.: esas son POLICIES
--    RLS (0006/0009), no views. Grep "CREATE (OR REPLACE )?VIEW" en todo
--    supabase/: SOLO 2 coincidencias — 0004_functions_triggers.sql:1539 y
--    entities/09_stores.sql:98, ambas la ÚNICA vista del proyecto:
--    public.stores_geo (ya incluida en 09_stores.sql §5).
-- ════════════════════════════════════════════════════════════════════════════

-- ============================================================================
-- 20261015000007_realtime_jobs.sql — Realtime podado + jobs pg_cron (§7 pasos 9-10, §5)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 9. Podar la publicación realtime (§5/D32)
-- ---------------------------------------------------------------------------
-- postgres_changes cobra fila completa × suscriptor: solo deben quedar
-- `alerts` (page pequeño) y `dashboard_daily` (fila ~100 B que el front
-- escucha). movements/chat_*/audit_log/credit_payments jamás (§5: cada
-- movimiento se pagaría 3 veces).
--
-- El doc ilustra el DROP de 5 tablas concretas; el ESTADO OBJETIVO es "solo
-- alerts y dashboard_daily". En proyectos nuevos Supabase publica todas las
-- tablas de public (§5), así que el bloque siguiente poda CUALQUIER tabla
-- publicada que no sea las dos permitidas — robusto tanto si venían las 25
-- como si solo las 5 del ejemplo.
DO $$
DECLARE r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication
                 WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;   -- defensivo: proyectos fuera de Supabase
  END IF;

  FOR r IN
    SELECT tablename
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename NOT IN ('alerts', 'dashboard_daily')
  LOOP
    EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I',
                   r.tablename);
  END LOOP;

  -- Asegurar las dos permitidas (ADD idempotente: solo si faltan)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables
                 WHERE pubname = 'supabase_realtime'
                   AND schemaname = 'public' AND tablename = 'alerts') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables
                 WHERE pubname = 'supabase_realtime'
                   AND schemaname = 'public' AND tablename = 'dashboard_daily') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.dashboard_daily';
  END IF;
END $$;

-- realtime UPDATE sobre dashboard_daily (§3.13): el PK (day, distributor_id)
-- ya funciona como identidad por defecto; el front solo necesita la fila
-- nueva del agregado. alerts: los UPDATE son mark_alert_read/resolve (read_at
-- / resolved_at) — misma lógica, sin replica identity FULL (que duplicaría
-- payload por fila vieja).

-- Fin 50_realtime. Siguiente: 60_jobs.sql (los 3 job_scan_* + pg_cron schedule).
