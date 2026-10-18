-- Entity: movements | Source: 0003_tables_farox.sql:L88-122 (tabla+índices), 0004_functions_triggers.sql:L185-244 (internal_stock_entry), L829-870 (register_reverse), 0011_seguridad.sql:L192-231 (register_reverse final), L480-512 (whitelist grant) | Order: after products, stores, distributors, motives, orders, stock, users, audit_log

-- ============================================================================
-- movements — entradas y salidas de inventario (APPEND-ONLY, asiento forense).
-- Sin updated_at; REVOKE completo de UPDATE/DELETE. Sin trigger audit_diff
-- (D21: ya ES el asiento forense, 0004:14-15/263-265). Escritura solo vía RPC
-- (register_entry/exit/reverse, confirm_delivery) via internal_stock_entry.
-- ============================================================================

-- CREATE TABLE — 0003_tables_farox.sql:89-108 (VERBATIM)
CREATE TABLE public.movements (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type             public.movement_type NOT NULL,          -- tabla única con campo tipo (decisión p.10)
  product_id       bigint NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  store_id         bigint NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,  -- asociación obligatoria (INV-04)
  distributor_id   bigint NULL REFERENCES public.distributors(id) ON DELETE RESTRICT, -- D25: derivado del pedido en la función, nunca parámetro libre
  motive_id        bigint NOT NULL REFERENCES public.motives(id) ON DELETE RESTRICT,  -- INV-04
  order_id         bigint NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  created_by       uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,      -- actor
  quantity         numeric(12,3) NOT NULL CHECK (quantity > 0),  -- siempre positiva; el signo lo da type (D13)
  unit_price       numeric(12,2) NULL,   -- precio al momento del movimiento (crítica A5: join al precio actual sería históricamente incorrecto)
  expiry_date      date NULL,
  reverso_of_id    bigint NULL REFERENCES public.movements(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Máx. 1 reverso por movimiento; prohíbe doble reverso (D31). La validación
  -- de tipo opuesto / mismo producto-tienda vive en register_reverse().
  CONSTRAINT uq_movements_reverso UNIQUE (reverso_of_id) WHERE reverso_of_id IS NOT NULL,
  CONSTRAINT chk_movements_entry_expiry CHECK (type = 'entry' OR expiry_date IS NULL)
  -- Sin updated_at ni UPDATEs (REVOKE completo en 0006)
);

-- Índices — 0003_tables_farox.sql:110-122 (VERBATIM)
CREATE INDEX idx_movements_store_created    ON public.movements (store_id, created_at DESC);
CREATE INDEX idx_movements_product_created  ON public.movements (product_id, created_at DESC);
-- parcial: los movimientos manuales sin pedido quedan fuera (no se consultan por distribuidor)
CREATE INDEX idx_movements_distributor_created ON public.movements (distributor_id, created_at DESC) WHERE distributor_id IS NOT NULL;
-- parcial: la mayoría de movimientos sueltos tienen order_id NULL (§2/3.4)
CREATE INDEX idx_movements_order ON public.movements (order_id) WHERE order_id IS NOT NULL;
-- (idx_movements_expiry ELIMINADO en 0010_perf.sql:366 — ver entidad stock; el job escanea stock, no movements)
-- parcial: alimenta el job diario de expiry_soon (§7)
CREATE INDEX idx_movements_created_at_brin ON public.movements USING brin (created_at);
-- Eliminado: btree (created_by) — 27 usuarios ⇒ selectividad nula (A6).
-- Sin índice en motive_id: cardinalidad bajísima; siempre se filtra dentro de tienda/fecha.
-- Sin partición de por vida (D23): 1M ≈ 180 MB; rompería la FK reverso_of_id.

-- Triggers — NINGUNO. movements NO tiene trg_updated_at (append-only, sin updated_at)
-- ni trg_audit_* (fuera del alcance D21; 0004:14-15 y 263-265). Verificado por grep:
-- no existe CREATE TRIGGER sobre public.movements en 0004.

-- ============================================================================
-- RLS — 0006_rls_grants.sql
-- ENABLE (L43). Policy (L251-257, VERBATIM): SELECT admin · operador (sus tiendas)
-- · distribuidor SOLO lo suyo (los manuales sueltos le son invisibles).
ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY movements_select ON public.movements
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids()))
         OR (public.my_role() = 'distribuidor'
             AND distributor_id = public.my_distributor_id()));

-- GRANTs — 0006_rls_grants.sql:351-357 (REVOKE DML, VERBATIM parcial): INSERT/UPDATE/DELETE
-- a authenticated (append-only: la escritura es solo por RPC/trigger SECURITY DEFINER).
-- SELECT no se revoca (queda la policy movements_select).
REVOKE INSERT, UPDATE, DELETE ON
  public.stock, public.movements, public.order_items, public.orders,
  public.credits, public.credit_payments, public.price_publications,
  public.alerts, public.routes, public.route_stops, public.user_stores,
  public.dashboard_daily, public.audit_log,
  public.chat_conversations, public.chat_messages
FROM authenticated;

-- ============================================================================
-- RPCs SOBRE ESTA TABLA (estado FINAL = última migración)
-- register_reverse — anulación por reverso (D31): 1 por original, tipo opuesto,
-- mismo producto-tienda. Versión FINAL en 0011_seguridad.sql:192-231 (guard =
-- assert_admin(); supera a 0004:829-870). Toca movements + stock + dashboard +
-- audit_log ⇒ MULTI-ENTIDAD. NO va en este archivo; ver NEGOCIO.
--
-- internal_stock_entry (núcleo atómico stock+movements+alertas) — 0004:185-244,
-- define el INSERT sobre movements. Es helper INTERNO (0006:405-411 REVOKE EXECUTE
-- a authenticated; 0011 no lo grantea — deny-list). Los callers multi-entidad
-- (register_entry/exit/reverse, confirm_delivery) ⇒ NEGOCIO.
--
-- register_entry / register_exit — insertan movements vía internal_stock_entry +
-- upsert dashboard. Firmas finales (COALESCE NULL-safe) en 0009_negocio.sql:101 /
-- :159. Multi-entidad ⇒ NEGOCIO.
--
-- get_dashboard (lee agregado de movements vía dashboard_daily, no movements directo):
-- definida 0004:1392, REDEFINIDA con clamp 366d en 0010_perf.sql:328. Toca
-- dashboard_daily (otra entidad); se lista acá solo como referencia de flujo de
-- movements. GRANT EXECUTE get_dashboard(date,date) TO authenticated, service_role — 0011:509.
