-- Entity: audit_log | Source: 0001_extensions_enums.sql:L90-96 (enum audit_action), 0003_tables_farox.sql:L254-271 (tabla+índices), 0004_functions_triggers.sql:L261-294 (audit_diff base), L498 (alcance 8 tablas D21), L865-867 y L1330-1332 (INSERTs directos), 0006_rls_grants.sql:L51 (RLS), L327-332 (policy), L355 (REVOKE DML), L375-377 (GRANT SELECT), 0010_perf.sql:L274-315 (audit_diff FINAL R10 → definida en 00_foundation.sql), 0011_seguridad.sql:L551-554 (REVOKE service_role), 0012_verify_hardening.sql:L435-447 (verificación append-only) | Order: after users (policy audit_read llama my_role()) — audit_diff() vive en 00_foundation.sql (los trg_audit_* de 07_users, 12_price_publications, 13_orders, 19_credits, 20_credit_payments + products/stores/distributors la disparan)

-- ============================================================================
-- audit_log — quién, qué, cuándo (APPEND-ONLY, alcance acotado a 8 tablas D21:
-- users, price_publications, orders, credits, credit_payments, distributors,
-- products, stores). NO audita movements (ya es el asiento forense) ni chat_*
-- (volumen máximo). Escritura: trigger audit_diff + INSERTs directos de RPCs.
-- ============================================================================

-- CREATE TABLE — 0003_tables_farox.sql:255-266 (VERBATIM)
CREATE TABLE public.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_by  uuid NULL,          -- actor; SIN FK: borrar usuarios no debe chocar con el log histórico (D10)
  table_name  text NOT NULL,      -- alcance acotado a 8 tablas (D21): users, price_publications,
                                  -- orders, credits, credit_payments, distributors, products, stores
  action      public.audit_action NOT NULL,
  row_id      text NULL,          -- text (no bigint): users.id es uuid — cambios de rol/premium eran
                                  -- los más críticos de SEC-01 y quedaban con row_id NULL (B10)
  diff        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- SOLO columnas cambiadas, no snapshots completos (D10)
  created_at  timestamptz NOT NULL DEFAULT now()
  -- Sin updated_at ni UPDATEs (append-only)
);

-- Índices — 0003_tables_farox.sql:268-271 (VERBATIM)
CREATE INDEX idx_audit_log_table_row ON public.audit_log (table_name, row_id);
-- Eliminado btree (created_by): 27 valores, selectividad basura, ~50 MB (A1);
-- "qué hizo el usuario X" = BRIN por fecha + table_name.
CREATE INDEX idx_audit_log_created_at_brin ON public.audit_log USING brin (created_at);

-- Triggers — NINGUNO sobre audit_log (es el DESTINO, no tiene trg_audit_* ni
-- touch_updated_at: append-only sin updated_at — 0004:251, citado abajo).
-- 0004_functions_triggers.sql:250-252 (VERBATIM):
-- -- BEFORE UPDATE de todas las tablas mutables con updated_at.
-- -- (No aplica a append-only: movements, credit_payments, audit_log, chat_messages,
-- --  y a tablas sin updated_at: motives, route_stops, alerts, user_stores.)
-- audit_log NO está en la publicación realtime (0007:10: "movements/chat_*/
-- audit_log/credit_payments jamás").

-- ============================================================================
-- RLS — 0006_rls_grants.sql:51 + 327-332 (VERBATIM): policy audit_read solo
-- admin (§8 fila 16 / D38).
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_read ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin');

-- GRANTs — 0006_rls_grants.sql:351-357 (REVOKE DML, VERBATIM parcial) + :375-377 (GRANT SELECT)
-- REVOKE global de las 15 tablas RPC-only: CONSOLIDADO en 90_security.sql
-- (0006:351-357, VERBATIM). Acá NO se repite: en orden de entidad el bloque
-- referenciaría tablas que aun no existen (forward refs).
-- D38/D32: estas dos NO se revocan; se GRANTEAN SELECT con su policy
-- (audit_log: admin la lee; dashboard_daily: realtime exige SELECT+RLS, D32).
GRANT SELECT ON public.audit_log TO authenticated;
-- 0011_seguridad.sql:545-546 (contexto, VERBATIM):
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
-- 0011_seguridad.sql:551-554 (VERBATIM) — R17.2 audit_log append-only TAMBIÉN
-- para service_role: pierde UPDATE/DELETE (SELECT ya lo tenía; INSERT lo conserva
-- para eventos de integración — el trigger audit_diff escribe como owner):
-- -- 6) R17.2 — audit_log append-only TAMBIÉN para service_role: pierde
-- --    UPDATE/DELETE (SELECT ya lo tenía; INSERT lo conserva para eventos de
-- --    integración — el trigger audit_diff escribe como owner).
REVOKE UPDATE, DELETE ON public.audit_log FROM service_role;
-- Verificación 0012:435-447 comprueba service_role sin UPDATE/DELETE y con SELECT/INSERT.

-- ============================================================================
-- FUNCIONES QUE ESCRIBEN EN ESTA TABLA (estado FINAL)
-- audit_diff — trigger fn de auditoría DML (D10/D21). Versión FINAL en
-- 0010_perf.sql:283-315 (R10: to_jsonb(OLD) cacheado en v_old — misma semántica
-- que 0004:266-294: mismas ramas, mismo diff, search_vector excluido, row_id
-- COALESCE). Los CREATE TRIGGER trg_audit_* viven en sus entidades:
-- 07_users, 12_price_publications, 13_orders, 19_credits, 20_credit_payments
-- (+ products, stores, distributors — 0004:499-537).
-- audit_diff() se define en 00_foundation.sql (versión final 0010)

-- INSERTs DIRECTOS (no vía trigger) — citados, cuerpos en sus entidades:
-- · register_reverse (movements) — 0011_seguridad.sql:226-228 (base 0004:865-867):
--     INSERT INTO public.audit_log (created_by, table_name, action, row_id, diff)
--     VALUES (auth.uid(), 'movements', 'update', p_movement_id::text,
--             jsonb_build_object('reverso_of_id', v_id, 'reason', p_reason));
-- · register_payment_reverse (credit_payments) — 0011_seguridad.sql:344-346
--   (base 0004:1330-1332; cuerpo completo en 20_credit_payments.sql):
--     INSERT INTO public.audit_log (created_by, table_name, action, row_id, diff)
--     VALUES (auth.uid(), 'credit_payments', 'update', p_payment::text,
--             jsonb_build_object('reverso_of_id', v_id, 'reason', p_reason));
-- Sin GRANT INSERT explícito a authenticated (0006 revoca INSERT); el trigger
-- (definido por owner) y service_role (INSERT conservado, 0011:551-554) escriben.
