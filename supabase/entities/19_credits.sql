-- Entity: credits | Source: 0001_extensions_enums.sql:L58-64 (enum credit_status), 0003_tables_farox.sql:L124-151 (tabla+índices+fillfactor), 0004_functions_triggers.sql:L478-481 (trg_updated_at), L529-532 (trg_audit), L1189-1216 (create_credit base), L1220-1244 (cancel_credit base), L1248-1285 (register_payment base), 0006_rls_grants.sql:L44 (RLS), L282-284 (policy base), L351-357 (REVOKE), 0009_negocio.sql:L384-424 (create_credit), L432-473 (register_payment FINAL), L518-523 (policy FINAL), 0011_seguridad.sql:L239-276 (create_credit FINAL), L278-300 (cancel_credit FINAL), L503-L505 (whitelist) | Order: after orders, stores, users

-- ============================================================================
-- credits — fiado (MVP, §3.7). total_amount deriva de order_items; balance lo
-- mantiene register_payment(). Escritura SOLO vía RPC (create/cancel/register).
-- ============================================================================

-- CREATE TABLE — 0003_tables_farox.sql:125-142 (VERBATIM)
CREATE TABLE public.credits (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id          bigint NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  store_id          bigint NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,  -- deudor
  total_amount      numeric(14,2) NOT NULL CHECK (total_amount > 0),  -- derivable de order_items.unit_price × quantity
  currency          char(3) NOT NULL DEFAULT 'COP',
  balance           numeric(14,2) NOT NULL CHECK (balance >= 0 AND balance <= total_amount),  -- lo mantiene register_payment()
  status            public.credit_status NOT NULL DEFAULT 'pending',
  due_date          date NULL,          -- vencimiento del fiado → credit_overdue (B4)
  settled_at        timestamptz NULL,
  cancelled_at      timestamptz NULL,
  cancelled_reason  text NULL,
  created_by        uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_credits_paid_zero_balance CHECK (status <> 'paid' OR balance = 0),
  CONSTRAINT chk_credits_paid_settled      CHECK (status <> 'paid' OR settled_at IS NOT NULL)
);

-- Índices + tuning — 0003_tables_farox.sql:144-151 (VERBATIM)
-- 1 crédito vigente por pedido sin bloquear re-crédito tras anular (D15/B4);
-- "deudores con saldo > 0" hace join directo por este unique (sin columna duplicada)
CREATE UNIQUE INDEX uq_credits_order_active ON public.credits (order_id) WHERE status <> 'cancelled';
CREATE INDEX idx_credits_store ON public.credits (store_id);
-- cartera abierta real: WHERE status <> 'paid' incluía cancelled (A/M5)
CREATE INDEX idx_credits_pending ON public.credits (status) WHERE status IN ('pending');

ALTER TABLE public.credits SET (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.05);

-- Triggers — 0004_functions_triggers.sql:478-481 y 529-532 (VERBATIM)
-- credits SÍ está en el alcance D21: trg_audit_credits escribe audit_log (ver 25_audit_log.sql).
DROP TRIGGER IF EXISTS trg_credits_updated_at ON public.credits;
CREATE TRIGGER trg_credits_updated_at
BEFORE UPDATE ON public.credits FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_audit_credits ON public.credits;
CREATE TRIGGER trg_audit_credits
AFTER INSERT OR UPDATE OR DELETE ON public.credits FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();

-- ============================================================================
-- RLS — 0006_rls_grants.sql (ENABLE) + 0009_negocio.sql (policy FINAL)
-- Estado FINAL = 0009 (R4.1/D-7): admin todas · operador SOLO de sus tiendas.
-- La policy de 0006 (IN ('admin','operador') sin filtro de tienda) fue reemplazada.
ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;

-- Policy FINAL — 0009_negocio.sql:518-523 (VERBATIM; reemplaza a 0006:282-284)
DROP POLICY IF EXISTS credits_select ON public.credits;
CREATE POLICY credits_select ON public.credits
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids())));

-- Policy BASE (REEMPLAZADA por 0009) — 0006_rls_grants.sql:282-284 (histórica):
-- CREATE POLICY credits_select ON public.credits
--   FOR SELECT TO authenticated
--   USING (public.my_role() IN ('admin', 'operador'));
-- Sin filtro de tienda en la matriz original (0006:278-280); Escritura RPC.

-- GRANTs — 0006_rls_grants.sql:351-357 (REVOKE DML, VERBATIM parcial): INSERT/UPDATE/DELETE
-- revocados a authenticated (escritura solo RPC SECURITY DEFINER). SELECT NO se
-- revoca (queda la policy credits_select); no hay GRANT SELECT explícito para credits.
-- REVOKE global de las 15 tablas RPC-only: CONSOLIDADO en 90_security.sql
-- (0006:351-357, VERBATIM). Acá NO se repite: en orden de entidad el bloque
-- referenciaría tablas que aun no existen (forward refs).
-- GRANT EXECUTE create_credit(bigint, date)              TO authenticated, service_role — 0011:503.
-- GRANT EXECUTE cancel_credit(bigint, text)              TO authenticated, service_role — 0011:504.
-- GRANT EXECUTE register_payment(bigint, numeric(14,2), public.payment_method)
--                                                        TO authenticated, service_role — 0011:505.

-- ============================================================================
-- RPCs SOBRE ESTA TABLA (estado FINAL = última migración)
-- create_credit — Versión FINAL en 0011_seguridad.sql:239-276 (guard
-- assert_admin D-4 + cuerpo aprobado de 0009 R6/D-6: rechaza cancelled, exige
-- delivered, tienda activa). Supera a 0004:1189-1216 y 0009:384-424.
-- Toca credits + orders + order_items (lectura) ; audit_log vía trg_audit_credits.
CREATE OR REPLACE FUNCTION public.create_credit(
  p_order bigint, p_due_date date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_total  numeric(14,2);
  v_store  bigint;
  v_status public.order_status;
  v_id     bigint;
BEGIN
  PERFORM public.assert_admin();  -- D-4: reemplaza COALESCE(my_role(),'') <> 'admin' (0009)
  SELECT o.store_id, o.status INTO v_store, v_status
  FROM public.orders o WHERE o.id = p_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'pedido inexistente: %', p_order; END IF;
  IF v_status = 'cancelled' THEN  -- R6.2 / D15
    RAISE EXCEPTION 'create_credit: el pedido % está cancelado; no se puede fiar', p_order;
  END IF;
  IF v_status <> 'delivered' THEN  -- D-6: el fiado solo se registra sobre pedidos delivered
    RAISE EXCEPTION 'create_credit: el pedido % está en estado %; el fiado solo se registra sobre pedidos delivered',
      p_order, v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.id = v_store AND s.is_active) THEN  -- D-6
    RAISE EXCEPTION 'create_credit: la tienda % del pedido está inactiva', v_store;
  END IF;
  SELECT COALESCE(sum(oi.unit_price * oi.quantity), 0) INTO v_total
  FROM public.order_items oi WHERE oi.order_id = p_order;
  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'pedido sin líneas con monto > 0';
  END IF;
  IF EXISTS (SELECT 1 FROM public.credits c WHERE c.order_id = p_order AND c.status <> 'cancelled') THEN
    RAISE EXCEPTION 'el pedido % ya tiene un crédito vigente (D15)', p_order;
  END IF;
  INSERT INTO public.credits (order_id, store_id, total_amount, balance, due_date, created_by)
  VALUES (p_order, v_store, v_total, v_total, p_due_date, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
-- GRANT EXECUTE create_credit(bigint, date) TO authenticated, service_role — 0011:503.

-- cancel_credit — Versión FINAL en 0011_seguridad.sql:278-300 (guard assert_admin
-- D-4; cuerpo = 0004:1220-1244). Regla §3.7: con cobros primero revertir pagos.
-- Toca credits + alerts (internal_alert_resolve 'credit_overdue').
CREATE OR REPLACE FUNCTION public.cancel_credit(
  p_credit bigint, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  c public.credits%ROWTYPE;
BEGIN
  PERFORM public.assert_admin();  -- D-4
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'cancel_credit: reason requerido';
  END IF;
  SELECT * INTO c FROM public.credits WHERE id = p_credit FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'crédito inexistente: %', p_credit; END IF;
  IF c.status = 'cancelled' THEN RETURN; END IF;  -- idempotente
  IF c.balance < c.total_amount THEN
    RAISE EXCEPTION 'el crédito tiene cobros (saldo % < total %); revertir pagos con register_payment_reverse primero', c.balance, c.total_amount;
  END IF;
  UPDATE public.credits
  SET status = 'cancelled', cancelled_at = now(), cancelled_reason = p_reason
  WHERE id = p_credit;
  PERFORM public.internal_alert_resolve('credit_overdue', NULL, NULL, c.order_id);  -- A6
END;
$$;
-- GRANT EXECUTE cancel_credit(bigint, text) TO authenticated, service_role — 0011:504.

-- register_payment — Versión FINAL en 0009_negocio.sql:432-473 (R4/D-7: scope
-- del operador post-FOR UPDATE + COALESCE NULL-safe). 0011 NO la reescribe
-- (0011:13-14: "register_entry/register_exit/register_payment NO se re-definen").
-- Supera a 0004:1248-1285. Toca credits (UPDATE balance/status) + credit_payments
-- (INSERT, ver 20_credit_payments.sql) + alerts (resolve al saldo 0).
CREATE OR REPLACE FUNCTION public.register_payment(
  p_credit bigint, p_amount numeric(14,2), p_method public.payment_method
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role  text := COALESCE(public.my_role(), '');  -- NULL-safe (D-4 barato)
  c       public.credits%ROWTYPE;
  v_id    bigint;
  v_bal   numeric(14,2);
BEGIN
  IF v_role NOT IN ('admin', 'operador') THEN
    RAISE EXCEPTION 'register_payment: solo admin/operador';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'register_payment: amount debe ser > 0';
  END IF;
  SELECT * INTO c FROM public.credits WHERE id = p_credit FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'crédito inexistente: %', p_credit; END IF;
  IF v_role = 'operador' AND NOT (c.store_id = ANY (public.my_store_ids())) THEN  -- R4.2 / D-7
    RAISE EXCEPTION 'register_payment: crédito fuera del alcance del operador';
  END IF;
  IF c.status = 'cancelled' THEN
    RAISE EXCEPTION 'crédito cancelado: %', p_credit;
  END IF;
  IF p_amount > c.balance THEN
    RAISE EXCEPTION 'amount % excede el saldo %; un cobro excesivo se corrige revirtiendo el pago (§3.7)', p_amount, c.balance;
  END IF;
  INSERT INTO public.credit_payments (credit_id, amount, payment_method, created_by)
  VALUES (p_credit, p_amount, p_method, auth.uid())
  RETURNING id INTO v_id;
  v_bal := c.balance - p_amount;
  UPDATE public.credits
  SET balance = v_bal,
      status = CASE WHEN v_bal = 0 THEN 'paid'::public.credit_status ELSE c.status END,
      settled_at = CASE WHEN v_bal = 0 THEN now() ELSE c.settled_at END
  WHERE id = p_credit;
  IF v_bal = 0 THEN
    PERFORM public.internal_alert_resolve('credit_overdue', NULL, NULL, c.order_id);  -- A6
  END IF;
  RETURN v_id;
END;
$$;
-- GRANT EXECUTE register_payment(bigint, numeric(14,2), public.payment_method) TO authenticated, service_role — 0011:505.
-- register_payment_reverse (corrección de cobros) ⇒ va en 20_credit_payments.sql.
-- job_scan_credit_overdue (job diario que LEE credits y ESCRIBE alerts) ⇒ MULTI-ENTIDAD, ver NEGOCIO.
