-- Entity: alerts | Source: 0001_extensions_enums.sql:L74-80 (enum alert_type), 0003_tables_farox.sql:L169-197 (tabla+índices+fillfactor), 0004_functions_triggers.sql:L84-158 (internal_alert_open/resolve/eval_stock_alert), L250-252 (sin trigger), L1343-1358 (mark_alert_read base), 0006_rls_grants.sql:L46 (RLS), L295-301 (policy), L351-357 (REVOKE), L405-411 y L417-421 (REVOKE EXECUTE internal_*/job_scan_*), 0007_realtime_jobs.sql:L38-42 (realtime), L82-93 (pg_cron), 0010_perf.sql:L381-382 (idx_alerts_store_open), 0011_seguridad.sql:L428-444 (mark_alert_read FINAL), L507 (whitelist) | Order: after stores, products, orders, distributors

-- ============================================================================
-- alerts — única tabla de alertas, por EPISODIO (D24). Escritura: jobs diarios
-- (pg_cron), helpers internal_* y mark_alert_read() para el UPDATE de lectura.
-- Realtime publicado (0007) — solo alerts y dashboard_daily.
-- ============================================================================

-- CREATE TABLE — 0003_tables_farox.sql:170-184 (VERBATIM)
CREATE TABLE public.alerts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type            public.alert_type NOT NULL,   -- stock_low, expiry_soon, order_late, credit_overdue
  store_id        bigint NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  product_id      bigint NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  order_id        bigint NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  distributor_id  bigint NULL REFERENCES public.distributors(id) ON DELETE RESTRICT,
  -- A4: solo order_late/credit_overdue derivan dueño del pedido/crédito;
  -- stock_low/expiry_soon son de tienda y lo dejan NULL (sin relación tienda↔distribuidor)
  message         text NOT NULL,        -- texto listo para UI; la UI no reconstruye datos que cambiaron
  context         jsonb,                -- snapshot al disparar: {quantity, threshold, dias_restantes, monto}
  read_at         timestamptz NULL,     -- reemplaza a is_read (se consulta read_at IS NULL)
  resolved_at     timestamptz NULL,     -- fin del episodio (condición normalizada)
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Índices + tuning — 0003_tables_farox.sql:186-197 (VERBATIM)
-- Anti-duplicados por episodio (corregido): 1 alerta abierta por episodio.
-- IMPORTANTE (nit §3.9): todo INSERT con ON CONFLICT DEBE referenciar este
-- target carácter a carácter, con las expresiones COALESCE incluidas:
--   ON CONFLICT (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0))
--   WHERE resolved_at IS NULL DO NOTHING
-- Nunca EXCEPTION (subtransacción en camino caliente) ni SELECT previo (carrera).
CREATE UNIQUE INDEX uq_alert_open
  ON public.alerts (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0))
  WHERE resolved_at IS NULL;

CREATE INDEX idx_alerts_distributor ON public.alerts (distributor_id);
ALTER TABLE public.alerts SET (fillfactor = 90);

-- Índice para la vista de alertas activas por tienda — 0010_perf.sql:378-382 (VERBATIM)
-- R13: la vista de alertas activas filtra por tienda con resolved_at IS NULL
-- (patrón idéntico a idx_movements_distributor_created); los resueltos no
-- ocupan índice.
CREATE INDEX IF NOT EXISTS idx_alerts_store_open
  ON public.alerts (store_id) WHERE resolved_at IS NULL;

-- Triggers — NINGUNO sobre alerts. Sin updated_at ⇒ no aplica touch_updated_at
-- (0004_functions_triggers.sql:250-252):
-- -- (No aplica a append-only: movements, credit_payments, audit_log, chat_messages,
-- --  y a tablas sin updated_at: motives, route_stops, alerts, user_stores.)
-- Tampoco trg_audit_* : alerts NO está en el alcance D21 (0004:498).

-- Realtime — 0007_realtime_jobs.sql:37-47 (VERBATIM, trozo del DO $$ que
-- afecta a alerts; el resto del bloque poda las demás tablas de public):
--   -- Asegurar las dos permitidas (ADD idempotente: solo si faltan)
--   IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables
--                  WHERE pubname = 'supabase_realtime'
--                    AND schemaname = 'public' AND tablename = 'alerts') THEN
--     EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts';
--   END IF;
-- 0007:8-11 (VERBATIM): "solo deben quedar `alerts` (page pequeño) y
-- `dashboard_daily` (fila ~100 B que el front escucha). movements/chat_*/
-- audit_log/credit_payments jamás".
--
-- pg_cron — 0007_realtime_jobs.sql:82-93 (VERBATIM): 3 jobs diarios 11:00 UTC
-- (06:00 America/Bogota), ejecutan los job_scan_* (ver NEGOCIO).
SELECT cron.schedule('farox_expiry_soon', '0 11 * * *',
  $$SELECT public.job_scan_expiry_soon();$$);
SELECT cron.schedule('farox_order_late', '0 11 * * *',
  $$SELECT public.job_scan_order_late();$$);
SELECT cron.schedule('farox_credit_overdue', '0 11 * * *',
  $$SELECT public.job_scan_credit_overdue();$$);

-- ============================================================================
-- RLS — 0006_rls_grants.sql:46 + 295-301 (VERBATIM). Sin cambios en 0009/0011:
-- 0009 solo reemplazó policies de credits/credit_payments/routes/route_stops.
-- SELECT admin (todas) · operador (sus tiendas) · distribuidor SOLO lo suyo (A4).
-- Escritura: jobs/trigger; UPDATE vía mark_alert_read() (SECURITY DEFINER con
-- chequeo interno, A2).
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY alerts_select ON public.alerts
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids()))
         OR (public.my_role() = 'distribuidor'
             AND distributor_id = public.my_distributor_id()));

-- GRANTs — 0006_rls_grants.sql:351-357 (REVOKE DML, VERBATIM parcial): INSERT/UPDATE/DELETE
-- revocados a authenticated (escritura solo RPC/jobs SECURITY DEFINER). SELECT NO
-- se revoca (queda la policy alerts_select); no hay GRANT SELECT explícito.
-- REVOKE global de las 15 tablas RPC-only: CONSOLIDADO en 90_security.sql
-- (0006:351-357, VERBATIM). Acá NO se repite: en orden de entidad el bloque
-- referenciaría tablas que aun no existen (forward refs).

-- Helpers internos y jobs SIN EXECUTE para clientes (0006:405-411 y 417-421):
-- CONSOLIDADOS en 90_security.sql — su sweep "REVOKE EXECUTE ON ALL FUNCTIONS
-- IN SCHEMA public FROM authenticated" (§2) más la whitelist de 31 firmas (§3)
-- los cubren estrictamente mejor. No se repiten acá porque tocaban
-- internal_dashboard_upsert (definida en 24) e internal_stock_entry (30) y los
-- tres job_scan_* (definidos en 60): forward refs que rompían el paste.
-- GRANT EXECUTE mark_alert_read(bigint) TO authenticated, service_role — 0011:507.

-- ============================================================================
-- RPCs SOBRE ESTA TABLA (estado FINAL = última migración)
-- mark_alert_read — Versión FINAL en 0011_seguridad.sql:428-444 (guard COALESCE
-- sobre la expresión COMPLETA, D-4; supera al guard compound NULL-able de
-- 0004:1343-1358). Toca SOLO alerts.
CREATE OR REPLACE FUNCTION public.mark_alert_read(p_alert bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text := COALESCE(public.my_role(), '');  -- D-4: NULL-safe
  a      public.alerts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'mark_alert_read: requiere sesión'; END IF;
  SELECT * INTO a FROM public.alerts WHERE id = p_alert FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'alerta inexistente: %', p_alert; END IF;
  IF NOT COALESCE(v_role = 'admin'
          OR (a.store_id IS NOT NULL AND a.store_id = ANY (public.my_store_ids()))
          OR (a.distributor_id IS NOT NULL AND a.distributor_id = public.my_distributor_id()), false) THEN
    RAISE EXCEPTION 'mark_alert_read: sin alcance sobre la alerta %', p_alert;
  END IF;
  UPDATE public.alerts SET read_at = now() WHERE id = p_alert AND read_at IS NULL;
END;
$$;
-- GRANT EXECUTE mark_alert_read(bigint) TO authenticated, service_role — 0011:507.

-- internal_alert_open — anti-duplicados por episodio (D24).
-- 0004_functions_triggers.sql:84-101 (VERBATIM; nunca redefinida).
CREATE OR REPLACE FUNCTION public.internal_alert_open(
  p_type        public.alert_type,
  p_store_id    bigint,
  p_product_id  bigint,
  p_order_id    bigint,
  p_distributor_id bigint,
  p_message     text,
  p_context     jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.alerts (type, store_id, product_id, order_id, distributor_id, message, context)
  VALUES (p_type, p_store_id, p_product_id, p_order_id, p_distributor_id, p_message, p_context)
  ON CONFLICT (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0))
  WHERE resolved_at IS NULL
  DO NOTHING;  -- nunca EXCEPTION (subtransacción en camino caliente) ni SELECT previo (carrera)
END;
$$;
-- REVOKE EXECUTE … FROM authenticated — 0006:406.

-- internal_alert_resolve — cierra episodios abiertos (A6).
-- 0004_functions_triggers.sql:105-121 (VERBATIM; nunca redefinida).
CREATE OR REPLACE FUNCTION public.internal_alert_resolve(
  p_type        public.alert_type,
  p_store_id    bigint,
  p_product_id  bigint,
  p_order_id    bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.alerts
  SET resolved_at = now()
  WHERE type = p_type
    AND resolved_at IS NULL
    AND (p_store_id   IS NULL OR store_id   IS NOT DISTINCT FROM p_store_id)
    AND (p_product_id IS NULL OR product_id IS NOT DISTINCT FROM p_product_id)
    AND (p_order_id   IS NULL OR order_id   IS NOT DISTINCT FROM p_order_id);
END;
$$;
-- REVOKE EXECUTE … FROM authenticated — 0006:407.

-- internal_eval_stock_alert — regla INV-06 exacta en transiciones (Lee stock/
-- products/stores, ESCRIBE alerts). 0004_functions_triggers.sql:126-158 (VERBATIM).
CREATE OR REPLACE FUNCTION public.internal_eval_stock_alert(
  p_store_id   bigint,
  p_product_id bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_qty      numeric(12,3);
  v_thr      numeric(12,3);
  v_msg      text;
  v_pname    text;
  v_sname    text;
BEGIN
  SELECT s.quantity, s.threshold, p.name, st.name
    INTO v_qty, v_thr, v_pname, v_sname
  FROM public.stock s
  JOIN public.products p ON p.id = s.product_id
  JOIN public.stores  st ON st.id = s.store_id
  WHERE s.product_id = p_product_id AND s.store_id = p_store_id;

  IF NOT FOUND THEN RETURN; END IF;

  IF v_qty = 0 OR (v_thr IS NOT NULL AND v_qty <= v_thr) THEN
    v_msg := v_pname || ' en ' || v_sname || ': ' ||
             CASE WHEN v_qty = 0 THEN 'sin stock' ELSE v_qty::text || ' <= umbral ' || v_thr::text END;
    PERFORM public.internal_alert_open(
      'stock_low', p_store_id, p_product_id, NULL, NULL, v_msg,
      jsonb_build_object('quantity', v_qty, 'threshold', v_thr));
  ELSE
    -- se resuelve cuando quantity > threshold (o > 0 si no hay umbral)
    PERFORM public.internal_alert_resolve('stock_low', p_store_id, p_product_id, NULL);
  END IF;
END;
$$;
-- REVOKE EXECUTE … FROM authenticated — 0006:408.
-- job_scan_expiry_soon / job_scan_order_late / job_scan_credit_overdue (jobs que
-- ESCRIBEN alerts leyendo stock/orders/credits) ⇒ MULTI-ENTIDAD, ver NEGOCIO.
