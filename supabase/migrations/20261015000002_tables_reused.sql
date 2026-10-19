-- ============================================================================
-- FAROX — Sprint 1, paso 2/8: 11 tablas reutilizadas de NØSEE (§2)
-- Estado FINAL objetivo: DDL de NØSEE + alteraciones de `Base de datos FAROX.md`.
-- La BD FAROX está vacía ⇒ se escribe el estado final directamente (sin ALTERs).
--
-- Fidelidad al catálogo NØSEE (proyecto ydzqhbnrudejbaqknkoq) para defaults,
-- checks e índices no re-estados en el doc; el DOC manda en toda contradicción:
--   · timestamptz en todo (D3) — NØSEE usa `timestamp without time zone`
--   · text en todo (varchar → text)
--   · IDs = identity (NØSEE usa serial/nextval)
--   · columnas hidden_*/comunidad eliminadas, columnas FAROX añadidas
--
-- Nota de FK diferidas entre archivos: `users.distributor_id` → distributors y
-- `orders.distributor_id`/`orders.route_id` → distributors/routes son tablas
-- NUEVAS (§3, archivo 0003). Las columnas se crean aquí; las FK se agregan en
-- 0003 tras crear las tablas destino.
-- ============================================================================

-- 2.1 store_types ------------------------------------------------------------
CREATE TABLE public.store_types (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.store_types IS 'Catálogo requerido por stores.store_type_id NOT NULL (§2.1)';

-- 2.2 unit_types -------------------------------------------------------------
CREATE TABLE public.unit_types (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text NOT NULL UNIQUE,          -- mod: NØSEE no tiene UNIQUE en name; se añade (integridad de catálogo)
  abbreviation  text NOT NULL,
  category      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_unit_types_abbreviation UNIQUE (abbreviation)
  -- §2.2: "validar unicidad en seed (§7); si pasa, añadir UNIQUE (abbreviation)".
  -- La semilla es propia de FAROX (vacío) y 0008 verifica unicidad ⇒ se añade ya.
);

-- 2.3 roles ------------------------------------------------------------------
CREATE TABLE public.roles (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 2.4 brands -----------------------------------------------------------------
CREATE TABLE public.brands (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()   -- mod: updated_at añadido (mutable)
  -- Eliminadas de NØSEE: is_admin_hidden + hidden_public_at/by/reason + hidden_admin_at/by/reason
  -- (7 columnas de moderación de la app comunitaria; el doc las nombra "6 columnas").
);

-- 2.5 product_categories -----------------------------------------------------
CREATE TABLE public.product_categories (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  description text,
  parent_id   integer NULL REFERENCES public.product_categories(id) ON DELETE SET NULL,  -- FAROX (D5): nullable ⇒ funciona plana
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2.9 users (creada antes que products/stores por created_by) ----------------
-- Nombre `users` conservado por continuidad con NØSEE (D8). No es auth.users.
CREATE TABLE public.users (
  id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,  -- mod: NO ACTION → CASCADE (D8)
  role_id             integer NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  full_name           text NOT NULL,
  email               text UNIQUE,                          -- FAROX: copia de auth.users.email vía trigger sync_email()
  phone_number        text,
  contact_preference  public.contact_preference NOT NULL DEFAULT 'whatsapp',  -- FAROX
  distributor_id      bigint NULL,                          -- FK → distributors agregada en 0003
  premium             boolean NOT NULL DEFAULT false,       -- FAROX: fuente única de verdad (D7)
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
  -- Eliminadas de NØSEE: reputation_points, avatar_url, mp_customer_id, onboarding_completed, is_verified
);

CREATE INDEX idx_users_distributor_id ON public.users (distributor_id);
-- btree = access method por DEFECTO; el método NO se escribe dentro de la lista
-- de columnas (ahí se parsea como columna y falla). Otros métodos van como
-- "ON tabla USING brin (...)" — ver idx_movements_created_at_brin (0003:119).
-- Diferidos (D22): btree (role_id), btree (lower(full_name)) — 27 usuarios ⇒ ruido puro.

-- 2.6 products ---------------------------------------------------------------
CREATE TABLE public.products (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL,
  description     text NULL,                                -- FAROX: el .md la pide; NØSEE no la tiene
  category_id     integer NOT NULL REFERENCES public.product_categories(id) ON DELETE RESTRICT,
  brand_id        bigint NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,  -- mod: NØSEE CASCADE → RESTRICT (D14)
  unit_type_id    integer NOT NULL REFERENCES public.unit_types(id) ON DELETE RESTRICT,
  created_by      uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,     -- FAROX (D36); backfill al admin en la carga de datos
  base_quantity   numeric(12,3) NOT NULL CHECK (base_quantity > 0),
  barcode         text NULL,                                -- D6/D42: no existe SKU; el QR asocia tienda↔distribuidor
  is_active       boolean NOT NULL DEFAULT true,
  -- mod: bug corregido — coalesce evita el NULL que devolvía name ∥ description sin descripción
  search_vector   tsvector GENERATED ALWAYS AS (
                    to_tsvector('spanish', coalesce(name, '') || ' ' || coalesce(description, ''))
                  ) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_barcode_length_check
    CHECK (barcode IS NULL OR (char_length(trim(barcode)) >= 4 AND char_length(trim(barcode)) <= 64))
    -- check conservado del catálogo NØSEE (fidelidad; el doc no lo contradice)
  -- Eliminadas de NØSEE: is_admin_hidden + 6 columnas hidden_*
);

-- Índice único funcional de barcode (§2.6 — copia del de NØSEE, normaliza
-- espacios/puntuación y permite repetidos salvo colisión tras normalizar)
CREATE UNIQUE INDEX uq_products_barcode
  ON public.products (lower(regexp_replace(barcode, '[^a-zA-Z0-9]', '', 'g')))
  WHERE barcode IS NOT NULL AND length(trim(barcode)) > 0;

-- Diferidos (§5/D22): gin(search_vector), gin(name gin_trgm_ops) + pg_trgm (~50.000 productos),
-- btree(created_by). El front nunca trae search_vector en listados (select= explícito).

-- 2.7 stores -----------------------------------------------------------------
CREATE TABLE public.stores (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- mod: NØSEE uuid → bigint (D1)
  store_type_id integer NOT NULL REFERENCES public.store_types(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  address       text,
  city          text,                                        -- FAROX (p.7)
  country       char(2) NOT NULL DEFAULT 'CO',               -- FAROX: multi-país desde el día 1 (D26)
  phone         text,                                        -- FAROX (p.7)
  location      public.geography(Point,4326) NOT NULL,       -- PostGIS (D12); NØSEE lo tenía nullable ⇒ NOT NULL (doc)
  website_url   text,
  created_by    uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,  -- dueño y actor (D33); solo escribe create_store()
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
  -- Eliminadas de NØSEE: is_admin_hidden + 6 hidden_*, evidence_count
);
-- Índices: PK.
-- Diferidos (D22): GIST (location) con ~1.000 tiendas (NØSEE tiene DOS GIST
-- duplicados sobre location — no copiar ninguno); btree (name) con 25 filas.
-- Acceso lat/lng vía vista stores_geo (§4), no ST_X/ST_Y en el cliente.

-- 2.8 price_publications -----------------------------------------------------
CREATE TABLE public.price_publications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  bigint NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  store_id    bigint NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,   -- mod: era uuid; RESTRICT en vez de CASCADE (D14)
  created_by  uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,      -- mod: era user_id; actor = created_by (D4); solo escribe set_price()
  price       numeric(12,2) NOT NULL CHECK (price > 0),    -- 0 prohibido (D27); NØSEE ya tenía el CHECK
  currency    char(3) NOT NULL DEFAULT 'COP',              -- FAROX: divisa explícita (D26)
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),          -- mod: era timestamp sin TZ; es el effective_at (D3)
  updated_at  timestamptz NOT NULL DEFAULT now()
  -- Eliminadas de NØSEE: photo_url, description, confidence_score, validated_count,
  -- downvoted_count, active_reports_count, comments_count, is_admin_hidden + 6 hidden_*
);

-- Impone en BD "1 fila activa por Producto↔Tienda" (D17). El ON CONFLICT de
-- set_price() debe usar carácter a carácter el mismo target/predicado.
CREATE UNIQUE INDEX uq_price_store_product_active
  ON public.price_publications (store_id, product_id) WHERE is_active;

-- Histórico de precios de un producto
CREATE INDEX idx_price_product_created
  ON public.price_publications (product_id, created_at DESC);

-- 2.10 orders (nombre NØSEE, semántica FAROX — D9) ----------------------------
CREATE TABLE public.orders (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- mod: NØSEE integer
  distributor_id    bigint NOT NULL,                    -- FK → distributors agregada en 0003
  store_id          bigint NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  status            public.order_status NOT NULL DEFAULT 'pending',  -- mod: varchar sin CHECK → enum (D2)
  route_id          bigint NULL,                        -- FK → routes agregada en 0003 (ON DELETE RESTRICT)
  created_by        uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  expected_at       timestamptz NULL,                   -- fecha prometida/SLA (alerta order_late, crítica B1)
  delivered_at      timestamptz NULL,
  notes             text NULL,
  cancelled_at      timestamptz NULL,
  cancelled_reason  text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Un pedido no puede estar "entregado sin fecha" ni "con fecha sin entregarse"
  CONSTRAINT orders_delivered_requires_at CHECK (status <> 'delivered' OR delivered_at IS NOT NULL),
  CONSTRAINT orders_delivered_only_with_at CHECK (delivered_at IS NULL OR status = 'delivered'),
  CONSTRAINT orders_cancelled_requires_at  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
  -- Eliminadas de NØSEE: ~35 columnas de flujo delivery/dealer (delivery_*, total_*,
  -- payment_*, jsonb stores/items/checked_items, pin, compromiso_*, dealer_*, etc.)
);

CREATE INDEX idx_orders_distributor_status ON public.orders (distributor_id, status);
CREATE INDEX idx_orders_store_created      ON public.orders (store_id, created_at DESC);
-- route_id sin índice (§2.10): pocos pedidos en ruta por ruta; añadir si pg_stat_statements lo muestra.

-- 2.11 order_items -----------------------------------------------------------
CREATE TABLE public.order_items (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- mod: NØSEE integer
  order_id           bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id         bigint NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity           numeric(12,3) NOT NULL CHECK (quantity > 0),      -- mod: integer sin CHECK → numeric(12,3) (B10: 2,5 kg era inexpressible)
  received_quantity  numeric(12,3) NULL CHECK (received_quantity IS NULL OR (received_quantity >= 0 AND received_quantity <= quantity)),  -- FAROX (p.11)
  status             public.order_item_status NOT NULL DEFAULT 'pending',  -- FAROX: estado por línea
  unit_price         numeric(12,2) NOT NULL CHECK (unit_price > 0),    -- FAROX: precio congelado en la línea (D40)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
  -- Eliminadas de NØSEE: assigned_store_id, assigned_price, substituted_with_product_id
  -- (status redefinido: varchar 'PENDING' → enum order_item_status)
);

-- Una línea por producto por pedido (evita duplicados por doble submit);
-- este unique CUBRE la FK order_id (§2.11 — NØSEE deja order_items sin índices FK).
CREATE UNIQUE INDEX uq_order_items_order_product ON public.order_items (order_id, product_id);
CREATE INDEX idx_order_items_product ON public.order_items (product_id);
-- Precio (D40): SELECT revocado — lectura vía get_order_items() que omite unit_price a no-premium.

-- Fin paso 2/8. Triggers de estas tablas: archivo 0004. RLS/grants: 0006.
