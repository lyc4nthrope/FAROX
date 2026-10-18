-- Entity: JOBS (pg_cron diarios) | Source: 20261015000004_functions_triggers.sql:L1452-1533 (3 funciones job_scan_*, VERBATIM — grep confirma: ÚNICAS definiciones, sin overrides en 0009/0010/0011/0012) · 20261015000007_realtime_jobs.sql:L56-97 (unschedule + cron.schedule, VERBATIM) | Order: AFTER 40_seeds (los jobs abren alertas; H0.3 de 95_verify asume seeds), 21_alerts, 15_stock, 13_orders, 19_credits — y ANTES de 90_security (el sweep NO les quita EXECUTE a los clientes: corren como postgres, owner)
-- ════════════════════════════════════════════════════════════════════════════
-- Verificación de versión (grep "CREATE OR REPLACE FUNCTION public.job_scan_")
-- sobre supabase/migrations/: job_scan_expiry_soon (0004:1457),
-- job_scan_order_late (0004:1486), job_scan_credit_overdue (0004:1510) —
-- 1 sola ocurrencia cada una ⇒ la versión de 0004 ES la final.
-- ════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- Funciones de los jobs — VERBATIM 20261015000004_functions_triggers.sql:1452-1533
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4.13 Jobs diarios de alertas (§7.10) — ejecutados por pg_cron (0007).
-- Cierran episodios caducos además de abrir nuevos (A6: sin cierre, el dedup
-- WHERE resolved_at IS NULL impediría re-alertar para siempre).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.job_scan_expiry_soon() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  c CONSTANT integer := 15;  -- horizonte del job (constante, §3.9)
BEGIN
  -- abre
  INSERT INTO public.alerts (type, store_id, product_id, message, context)
  SELECT 'expiry_soon', s.store_id, s.product_id,
         p.name || ' en ' || st.name || ': caduca el ' || s.expiry_date ||
         ' (' || (s.expiry_date - CURRENT_DATE) || ' días)',
         jsonb_build_object('quantity', s.quantity, 'dias_restantes', s.expiry_date - CURRENT_DATE)
  FROM public.stock s
  JOIN public.products p ON p.id = s.product_id
  JOIN public.stores  st ON st.id = s.store_id
  WHERE s.expiry_date <= CURRENT_DATE + c AND s.quantity > 0
  ON CONFLICT (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0))
  WHERE resolved_at IS NULL
  DO NOTHING;
  -- cierra los que salieron del horizonte (expiry > horizon o quantity = 0)
  UPDATE public.alerts a
  SET resolved_at = now()
  WHERE a.type = 'expiry_soon' AND a.resolved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.stock s
      WHERE s.store_id = a.store_id AND s.product_id = a.product_id
        AND s.expiry_date <= CURRENT_DATE + c AND s.quantity > 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.job_scan_order_late() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- abre
  INSERT INTO public.alerts (type, store_id, order_id, distributor_id, message, context)
  SELECT 'order_late', o.store_id, o.id, o.distributor_id,
         'Pedido #' || o.id || ' atrasado (esperado ' || o.expected_at || ')',
         jsonb_build_object('esperado', o.expected_at)
  FROM public.orders o
  WHERE o.expected_at < now() AND o.delivered_at IS NULL
    AND o.status NOT IN ('delivered', 'cancelled')
  ON CONFLICT (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0))
  WHERE resolved_at IS NULL
  DO NOTHING;
  -- cierra (también se cierra en confirm_delivery/update_order_status — A6)
  UPDATE public.alerts a
  SET resolved_at = now()
  WHERE a.type = 'order_late' AND a.resolved_at IS NULL
    AND EXISTS (SELECT 1 FROM public.orders o
                 WHERE o.id = a.order_id
                   AND (o.delivered_at IS NOT NULL OR o.status IN ('delivered', 'cancelled')));
END;
$$;

CREATE OR REPLACE FUNCTION public.job_scan_credit_overdue() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- abre
  INSERT INTO public.alerts (type, store_id, order_id, distributor_id, message, context)
  SELECT 'credit_overdue', c.store_id, c.order_id, o.distributor_id,
         'Crédito del pedido #' || c.order_id || ' vencido desde ' || c.due_date ||
         ' (saldo ' || c.balance || ')',
         jsonb_build_object('monto', c.balance, 'vence', c.due_date)
  FROM public.credits c
  LEFT JOIN public.orders o ON o.id = c.order_id
  WHERE c.due_date < CURRENT_DATE AND c.balance > 0 AND c.status <> 'cancelled'
  ON CONFLICT (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0))
  WHERE resolved_at IS NULL
  DO NOTHING;
  -- cierra (también se cierra en register_payment/reverse/cancel_credit — A6)
  UPDATE public.alerts a
  SET resolved_at = now()
  WHERE a.type = 'credit_overdue' AND a.resolved_at IS NULL
    AND EXISTS (SELECT 1 FROM public.credits c
                 WHERE c.order_id = a.order_id
                   AND (c.balance = 0 OR c.status = 'cancelled'));
END;
$$;

-- ---------------------------------------------------------------------------
-- Schedule pg_cron — VERBATIM 20261015000007_realtime_jobs.sql:56-97
-- ---------------------------------------------------------------------------

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

-- Fin 60_jobs. Siguiente: 90_security.sql (lockdown de grants — DEBE correr
-- después de TODAS las funciones definidas).
