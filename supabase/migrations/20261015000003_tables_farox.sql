-- ============================================================================
-- FAROX — Sprint 1, paso 3/8: 14 tablas nuevas FAROX (§3)
-- Spec: `Base de datos FAROX.md` — secciones §3.x + índice/parametrización §5
--
-- Al final: las 3 FK "diferidas" que apuntan a tablas de ESTE archivo
-- (users.distributor_id, orders.distributor_id, orders.route_id).
-- Índices diferidos por umbral (D22) NO se crean aquí: GIST(location),
-- GIN(search_vector), GIN(name gin_trgm_ops) + pg_trgm, btree(stores.name),
-- btree(users.role_id), btree(users.lower(full_name)).
-- ============================================================================

-- 3.2 distributors (antes que users/movements por FKs) -----------------------
CREATE TABLE public.distributors (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                text NOT NULL,
  nit                 text NOT NULL UNIQUE,      -- "NIT obligatorio" sólo se cumple con UNIQUE (corregido)
  contact_name        text,
  phone               text,
  email               text,
  contact_preference  public.contact_preference NOT NULL DEFAULT 'whatsapp',
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 3.3 motives — catálogo de motivos/origen (DIST-04 resuelto aquí) -----------
CREATE TABLE public.motives (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL UNIQUE,          -- seed obligatorio (§7): venta, reabastecimiento, devolución, merma, ajuste
  suggested_type  public.movement_type NULL,     -- entry/exit sugerido; NULL = aplica a ambos (p.ej. ajuste)
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 3.1 stock — asignación Producto ↔ Tienda -----------------------------------
CREATE TABLE public.stock (
  product_id   bigint NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  store_id     bigint NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  quantity     numeric(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  threshold    numeric(12,3) NULL DEFAULT NULL
               CHECK (threshold IS NULL OR threshold >= 0),  -- D28: NULL = sin punto de pedido (DEFAULT 0 causaba alerta masiva)
  expiry_date  date NULL,   -- caducidad vigente del par (aproximación D30; FEFO fuera de alcance)
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, store_id)
);

-- La PK solo cubre filtros por product_id; el dashboard consulta "stock de esta tienda"
CREATE INDEX idx_stock_store ON public.stock (store_id);
-- Sin índice parcial WHERE quantity <= threshold: condición volátil (D11) — la señal se materializa en alerts.

ALTER TABLE public.stock SET (
  fillfactor = 85,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);  -- la tabla con más UPDATEs del sistema (1 UPDATE por movimiento)

-- 3.5 routes -----------------------------------------------------------------
CREATE TABLE public.routes (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  distributor_id  bigint NOT NULL REFERENCES public.distributors(id) ON DELETE RESTRICT,
  route_date      date NOT NULL,
  status          public.route_status NOT NULL DEFAULT 'planned',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Una ruta activa por distribuidor por día; el predicado corrige el unique
-- incondicional que impedía crear la ruta de reemplazo tras cancelar (B8)
CREATE UNIQUE INDEX uq_routes_distributor_day
  ON public.routes (distributor_id, route_date) WHERE status <> 'cancelled';
CREATE INDEX idx_routes_route_date ON public.routes (route_date);  -- "rutas de hoy"

-- 3.6 route_stops ------------------------------------------------------------
CREATE TABLE public.route_stops (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route_id        bigint NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  store_id        bigint NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,  -- coords viven en stores.location (no duplicar)
  stop_order      smallint NOT NULL CHECK (stop_order > 0),   -- orden para Google Maps
  estimated_time  time NULL,
  status          public.stop_status NOT NULL DEFAULT 'pending',
  arrived_at      timestamptz NULL,   -- marca real de visita
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- El unique ya indexa route_id (no añadir índice FK separado)
CREATE UNIQUE INDEX uq_route_stops_route_order ON public.route_stops (route_id, stop_order);

-- 3.4 movements — entradas y salidas (append-only) ---------------------------
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
  CONSTRAINT uq_movements_reverso UNIQUE (reverso_of_id),
  CONSTRAINT chk_movements_entry_expiry CHECK (type = 'entry' OR expiry_date IS NULL)
  -- Sin updated_at ni UPDATEs (REVOKE completo en 0006)
);

CREATE INDEX idx_movements_store_created    ON public.movements (store_id, created_at DESC);
CREATE INDEX idx_movements_product_created  ON public.movements (product_id, created_at DESC);
-- parcial: los movimientos manuales sin pedido quedan fuera (no se consultan por distribuidor)
CREATE INDEX idx_movements_distributor_created ON public.movements (distributor_id, created_at DESC) WHERE distributor_id IS NOT NULL;
-- parcial: la mayoría de movimientos sueltos tienen order_id NULL (§2/3.4)
CREATE INDEX idx_movements_order ON public.movements (order_id) WHERE order_id IS NOT NULL;
-- parcial: alimenta el job diario de expiry_soon (§7)
CREATE INDEX idx_movements_expiry ON public.movements (expiry_date) WHERE expiry_date IS NOT NULL;
-- Rango global del dashboard (D18): BRIN ≈ KB donde btree serían MB
CREATE INDEX idx_movements_created_at_brin ON public.movements USING brin (created_at);
-- Eliminado: btree (created_by) — 27 usuarios ⇒ selectividad nula (A6).
-- Sin índice en motive_id: cardinalidad bajísima; siempre se filtra dentro de tienda/fecha.
-- Sin partición de por vida (D23): 1M ≈ 180 MB; rompería la FK reverso_of_id.

-- 3.7 credits — fiado (MVP) --------------------------------------------------
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

-- 1 crédito vigente por pedido sin bloquear re-crédito tras anular (D15/B4);
-- "deudores con saldo > 0" hace join directo por este unique (sin columna duplicada)
CREATE UNIQUE INDEX uq_credits_order_active ON public.credits (order_id) WHERE status <> 'cancelled';
CREATE INDEX idx_credits_store ON public.credits (store_id);
-- cartera abierta real: WHERE status <> 'paid' incluía cancelled (A/M5)
CREATE INDEX idx_credits_pending ON public.credits (status) WHERE status IN ('pending');

ALTER TABLE public.credits SET (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.05);

-- 3.8 credit_payments (append-only) ------------------------------------------
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

CREATE INDEX idx_credit_payments_credit ON public.credit_payments (credit_id);

-- 3.9 alerts — única tabla de alertas, por EPISODIO (D24) --------------------
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

-- 3.10 user_stores — alcance del operador (D16) ------------------------------
-- Única fuente de alcance; el dueño se auto-asocia en create_store() (D35).
-- PK compuesta indexa ambas direcciones.
CREATE TABLE public.user_stores (
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  store_id   bigint NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, store_id)
);

-- 3.11 chat_conversations ----------------------------------------------------
CREATE TABLE public.chat_conversations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,  -- dueño
  title       text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()  -- lo toca un trigger al insertar mensaje (ordenar listados)
  -- Sin trigger de auditoría: auditar mensajes de chat es ruido + peso (A1)
);

CREATE INDEX idx_chat_conversations_user_updated ON public.chat_conversations (user_id, updated_at DESC);

-- 3.12 chat_messages ---------------------------------------------------------
CREATE TABLE public.chat_messages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  role            public.chat_role NOT NULL,   -- tool guarda respuestas de funciones
  content         text NOT NULL,
  payload         jsonb NULL,   -- tool-calling del chatbot; FUERA de listados (egress)
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Keyset corregido (A8): por created_at dos mensajes de la misma transacción
-- comparten timestamp y el cursor los saltaba/duplicaba; id es único y monotónico.
-- Cursor: WHERE conversation_id = $1 AND id > $after ORDER BY id LIMIT 21.
CREATE INDEX idx_chat_messages_conversation_id ON public.chat_messages (conversation_id, id);

-- 3.13 dashboard_daily — agregado INT-01 (tabla, no vista — D20) -------------
CREATE TABLE public.dashboard_daily (
  day             date NOT NULL,
  -- 0 = movimientos sin pedido/distribuidor (NO NULL: el unique no cubriría NULLs
  -- y cada fila manual crearía una entrada nueva)
  distributor_id  bigint NOT NULL DEFAULT 0,
  entries_count   integer NOT NULL DEFAULT 0,   -- CONTEOS, no sumas de quantity (kg+unidades ≠ número con significado)
  exits_count     integer NOT NULL DEFAULT 0,
  entries_value   numeric(14,2) NOT NULL DEFAULT 0,  -- quantity × movements.unit_price
  exits_value     numeric(14,2) NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- PK = el UNIQUE (day, distributor_id) del doc + replica identity que
  -- supabase_realtime exige para emitir UPDATE de la fila (§3.13/§5).
  PRIMARY KEY (day, distributor_id)
);
-- Escritura SOLO vía upsert interno de register_entry/register_exit (§3.13);
-- lectura vía get_dashboard() + policy dashboard_read (SELECT concedido en 0006).

-- 3.14 audit_log — quién, qué, cuándo (append-only, alcance acotado) ---------
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

CREATE INDEX idx_audit_log_table_row ON public.audit_log (table_name, row_id);
-- Eliminado btree (created_by): 27 valores, selectividad basura, ~50 MB (A1);
-- "qué hizo el usuario X" = BRIN por fecha + table_name.
CREATE INDEX idx_audit_log_created_at_brin ON public.audit_log USING brin (created_at);

-- ============================================================================
-- FKs diferidas (columnas creadas en 0002; tablas destino recién creadas aquí)
-- ============================================================================
ALTER TABLE public.users
  ADD CONSTRAINT users_distributor_id_fkey
  FOREIGN KEY (distributor_id) REFERENCES public.distributors(id) ON DELETE SET NULL;  -- 1 usuario ↔ 1 distribuidor (D29)

ALTER TABLE public.orders
  ADD CONSTRAINT orders_distributor_id_fkey
  FOREIGN KEY (distributor_id) REFERENCES public.distributors(id) ON DELETE RESTRICT;

-- RESTRICT corrige el SET NULL que desenganchaba pedidos in_route de su ruta en silencio
ALTER TABLE public.orders
  ADD CONSTRAINT orders_route_id_fkey
  FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE RESTRICT;

-- Fin paso 3/8. Triggers: 0004. Seeds: 0005. RLS/grants: 0006.
