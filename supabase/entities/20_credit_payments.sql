-- Entity: credit_payments | Source: 0001_extensions_enums.sql:L66-72 (enum payment_method), 0003_tables_farox.sql:L153-167 (tabla+índice), 0004_functions_triggers.sql:L251 (sin touch: append-only), L534-537 (trg_audit), L1289-1335 (register_payment_reverse base), 0006_rls_grants.sql:L45 (RLS), L285-287 (policy base), L351-357 (REVOKE), 0009_negocio.sql:L526-533 (policy FINAL), 0011_seguridad.sql:L305-349 (register_payment_reverse FINAL), L506 (whitelist), L554 (REVOKE service_role sobre audit_log) | Order: after credits, users

-- ============================================================================
-- credit_payments — cobros del fiado (APPEND-ONLY, §3.8). Nunca UPDATE:
-- un pago mal registrado se revierte con su reverso (uq_credit_payments_reverso).
-- ============================================================================

-- CREATE TABLE — 0003_tables_farox.sql:154-165 (VERBATIM)
CREATE TABLE public.credit_payments (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  credit_id       bigint NOT NULL REFERENCES public.credits(id) ON DELETE CASCADE,
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  reverso_of_id   bigint NULL REFERENCES public.credit_payments(id) ON DELETE RESTRICT,
  payment_method  public.payment_method NOT NULL,   -- forma_pago del .md
  created_by      uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  paid_at         timestamptz NOT NULL DEFAULT now(),
  -- corrección de cobros: un pago mal registrado se revierte con su reverso,
  -- nunca con UPDATE (append-only intacto)
  CONSTRAINT uq_credit_payments_reverso UNIQUE (reverso_of_id)
);

-- Índice — 0003_tables_farox.sql:167 (VERBATIM)
CREATE INDEX idx_credit_payments_credit ON public.credit_payments (credit_id);

-- Triggers — 0004_functions_triggers.sql:534-537 (VERBATIM)
-- credit_payments SÍ tiene trg_audit_* (es una de las 8 tablas D21).
-- NO tiene touch_updated_at: es append-only SIN updated_at (0004:251, citado abajo).
-- NO existen trg_payments_no_change / trg_payments_no_delete en ninguna
-- migración (grep 0004/0006/0009/0010/0011/0012: 0 matches) — el append-only
-- se garantiza con REVOKE de UPDATE/DELETE + policies ausentes.
DROP TRIGGER IF EXISTS trg_audit_credit_payments ON public.credit_payments;
CREATE TRIGGER trg_audit_credit_payments
AFTER INSERT OR UPDATE OR DELETE ON public.credit_payments FOR EACH ROW
EXECUTE FUNCTION public.audit_diff();
-- 0004_functions_triggers.sql:250-252 (VERBATIM):
-- -- BEFORE UPDATE de todas las tablas mutables con updated_at.
-- -- (No aplica a append-only: movements, credit_payments, audit_log, chat_messages,
-- --  y a tablas sin updated_at: motives, route_stops, alerts, user_stores.)

-- ============================================================================
-- RLS — 0006_rls_grants.sql (ENABLE) + 0009_negocio.sql (policy FINAL)
-- Estado FINAL = 0009 (R4.1): hereda el scope del crédito padre (EXISTS sobre
-- credits). La policy base de 0006 (IN ('admin','operador')) fue reemplazada.
ALTER TABLE public.credit_payments ENABLE ROW LEVEL SECURITY;

-- Policy FINAL — 0009_negocio.sql:526-533 (VERBATIM; reemplaza a 0006:285-287)
DROP POLICY IF EXISTS credit_payments_select ON public.credit_payments;
CREATE POLICY credit_payments_select ON public.credit_payments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.credits c
                 WHERE c.id = credit_payments.credit_id
                   AND (public.my_role() = 'admin'
                        OR (public.my_role() = 'operador'
                            AND c.store_id = ANY (public.my_store_ids())))));

-- Policy BASE (REEMPLAZADA por 0009) — 0006_rls_grants.sql:285-287 (histórica):
-- CREATE POLICY credit_payments_select ON public.credit_payments
--   FOR SELECT TO authenticated
--   USING (public.my_role() IN ('admin', 'operador'));
-- Sin policy INSERT/UPDATE/DELETE (0009:428: "credit_payments no tiene policy de
-- UPDATE (append-only, todo pasa por RPC)") ⇒ escritura solo RPC.

-- GRANTs — 0006_rls_grants.sql:351-357 (REVOKE DML, VERBATIM parcial): INSERT/UPDATE/DELETE
-- revocados a authenticated (escritura solo RPC SECURITY DEFINER). SELECT NO se
-- revoca (queda la policy credit_payments_select); no hay GRANT SELECT explícito.
-- REVOKE global de las 15 tablas RPC-only: CONSOLIDADO en 90_security.sql
-- (0006:351-357, VERBATIM). Acá NO se repite: en orden de entidad el bloque
-- referenciaría tablas que aun no existen (forward refs).
-- GRANT EXECUTE register_payment(bigint, numeric(14,2), public.payment_method) TO authenticated, service_role — 0011:505 (INSERTa acá; cuerpo en 19_credits.sql).
-- GRANT EXECUTE register_payment_reverse(bigint, text) TO authenticated, service_role — 0011:506.
-- service_role: 0011:554 REVOKE UPDATE, DELETE ON public.audit_log FROM service_role (audit_log, ver 25_audit_log.sql).

-- ============================================================================
-- RPCs SOBRE ESTA TABLA (estado FINAL = última migración)
-- register_payment_reverse — Única corrección de cobros (A5): inserta reverso,
-- recalcula balance (SUMA), reabre status si estaba paid. Versión FINAL en
-- 0011_seguridad.sql:305-349 (guard assert_admin D-4; cuerpo = 0004:1289-1335).
-- Toca credit_payments (INSERT) + credits (UPDATE) + alerts (reopen) +
-- audit_log (INSERT directo, líneas 344-346 — ver 25_audit_log.sql).
CREATE OR REPLACE FUNCTION public.register_payment_reverse(
  p_payment bigint, p_reason text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  p      public.credit_payments%ROWTYPE;
  c      public.credits%ROWTYPE;
  v_id   bigint;
  v_bal  numeric(14,2);
BEGIN
  PERFORM public.assert_admin();  -- D-4
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'register_payment_reverse: reason requerido';
  END IF;
  SELECT * INTO p FROM public.credit_payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pago inexistente: %', p_payment; END IF;
  IF p.reverso_of_id IS NOT NULL THEN
    RAISE EXCEPTION 'D31/A5: no se puede revertir un reverso (pago % ya es un reverso)', p_payment;
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_payments cp WHERE cp.reverso_of_id = p_payment) THEN
    RAISE EXCEPTION 'A5: el pago % ya fue revertido', p_payment;
  END IF;
  SELECT * INTO c FROM public.credits WHERE id = p.credit_id FOR UPDATE;
  INSERT INTO public.credit_payments (credit_id, amount, reverso_of_id, payment_method, created_by)
  VALUES (p.credit_id, p.amount, p_payment, p.payment_method, auth.uid())
  RETURNING id INTO v_id;
  v_bal := c.balance + p.amount;  -- el reverso SUMA al saldo
  UPDATE public.credits
  SET balance = v_bal,
      status = CASE WHEN c.status = 'paid' THEN 'pending'::public.credit_status ELSE c.status END,
      settled_at = CASE WHEN c.status = 'paid' THEN NULL ELSE c.settled_at END  -- reabre si estaba saldado
  WHERE id = p.credit_id;
  IF v_bal > 0 AND c.due_date IS NOT NULL AND c.due_date < CURRENT_DATE AND c.status <> 'cancelled' THEN
    -- reabre credit_overdue (1 alerta abierta por episodio — D24)
    PERFORM public.internal_alert_open('credit_overdue', c.store_id, NULL, c.order_id,
      (SELECT o.distributor_id FROM public.orders o WHERE o.id = c.order_id),
      'Crédito del pedido #' || c.order_id || ' vencido (reabierto tras reverso)',
      jsonb_build_object('monto', v_bal));
  END IF;
  INSERT INTO public.audit_log (created_by, table_name, action, row_id, diff)
  VALUES (auth.uid(), 'credit_payments', 'update', p_payment::text,
          jsonb_build_object('reverso_of_id', v_id, 'reason', p_reason));
  RETURN v_id;
END;
$$;
-- GRANT EXECUTE register_payment_reverse(bigint, text) TO authenticated, service_role — 0011:506.
-- register_payment (INSERT principal de cobros, cuerpo en 19_credits.sql) ⇒ su
-- final es 0009_negocio.sql:432-473; INSERTa en ESTA tabla en su línea 459-461.
