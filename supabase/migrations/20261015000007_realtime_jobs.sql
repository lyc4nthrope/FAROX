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

-- ---------------------------------------------------------------------------
-- 10. Jobs pg_cron — diario 06:00 America/Bogota (§7.10)
-- ---------------------------------------------------------------------------
-- Cada job es idempotente en SU lógica (ON CONFLICT sobre uq_alert_open con el
-- target exacto + cierre de episodios caducos, A6) y aquí lo es también el
-- schedule: unschedule previo de lo que haya ⇒ re-ejecutar esta migración no
-- duplica jobs.
--
-- B1: cron.unschedule(nombre) ERRORA si el job no existe (BD limpia ⇒ la
-- migración abortaba y 0008 nunca corría); se desagenda SOLO lo presente en
-- cron.job. tz: schedule usa 5 campos — la "6ª columna timezone" no es
-- sintaxis soportada y también abortaba. Supabase corre en UTC: 11:00 UTC =
-- 06:00 America/Bogota (UTC−5, Colombia sin horario de verano).
DO $$
DECLARE j record;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job
    WHERE jobname IN ('farox_expiry_soon', 'farox_order_late', 'farox_credit_overdue')
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

-- expiry_soon: stock.expiry_date <= CURRENT_DATE + 15 AND quantity > 0;
--   también cierra episodios que salieron del horizonte.
SELECT cron.schedule('farox_expiry_soon', '0 11 * * *',
  $$SELECT public.job_scan_expiry_soon();$$);

-- order_late: expected_at vencido, sin entregar y sin cancelar; también cierra
--   episodios (confirm_delivery/update_order_status lo cierran en caliente).
SELECT cron.schedule('farox_order_late', '0 11 * * *',
  $$SELECT public.job_scan_order_late();$$);

-- credit_overdue: due_date vencido con balance > 0; también cierra episodios
--   (register_payment/register_payment_reverse/cancel_credit en caliente).
SELECT cron.schedule('farox_credit_overdue', '0 11 * * *',
  $$SELECT public.job_scan_credit_overdue();$$);

-- Los jobs corren como el usuario que los agenda (postgres, dueño de las
-- funciones) y las funciones son SECURITY DEFINER: sin dependencia del rol
-- de cron ni de RLS. Verificación: 0008 (tabla cron.job con los 3 nombres).

-- Fin paso 7/8. Verificación: 0008. PASO MANUAL ENTRE 0005 y 0006:
-- ver supabase/README.md — signup del primer admin + promoción (UPDATE en
-- SQL editor; update_user_role() exige caller admin y el SQL editor corre
-- como postgres).
