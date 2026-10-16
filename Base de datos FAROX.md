# Base de datos FAROX

> Esquema técnico completo de FAROX: tablas, atributos, índices, consideraciones y decisiones.
> Documento hermano de `idea basica proy admin de proys.md` (allí viven los requerimientos, roles/permisos y seguridad).
> Verificado contra los proyectos Supabase reales (2026-10-14): **FAROX** (`tzyqstnxbzyfmdxeuyvz`) está **vacío**; la base "existente" vive en **NØSEE** (`ydzqhbnrudejbaqknkoq`).
> **v2** — revisado por 2 críticas independientes (rendimiento/egress y escalabilidad/negocio); correcciones integradas.

---

## 0. Contexto y origen

- FAROX parte de un esquema **vacío**. La base de NØSEE (app de comunidad de precios) es la fuente de sus tablas base.
- **11 tablas reutilizadas** de NØSEE (DDL como punto de partida + ajustes documentados abajo) y **14 tablas nuevas** propias de FAROX (incluye `dashboard_daily`) → **25 tablas en total**.
- **Tablas de NØSEE descartadas** (alcanzan a otra app, no a FAROX): `dealer_*` (4), `deliveries`, `delivery_*` (3), `payments`, `price_alerts`, `price_alert_notifications`, `price_adjustment_requests`, `price_corrections`, `publication_votes`, `comments`, `reports`, `reputation_*` (2), `store_evidences`, `user_activity_logs`, `login_audit_logs`, `admin_*` (4). ≈24 tablas fuera de alcance.
- **Estrategia Sprint 1**: copiar DDL del subconjunto → aplicar alteraciones de este documento → seeds → funciones/RLS → jobs.
- **Semilla mínima (corregida)**: `roles`, `unit_types`, `store_types`, `product_categories`, `brands`, **`motives`** (antes faltaba; sin él `motive_id NOT NULL` rompe INV-04/DIST-04). Productos, tiendas y precios se cargan después; usuarios se crean vía signup (los `auth.users` de NØSEE **no** son migrables entre proyectos).
- **Prerrequisito de seeds**: crear el **primer usuario admin por signup ANTES** de cualquier seed que lleve `created_by NOT NULL` (tiendas, órdenes, precios) — el usuario no puede existir si `users` está vacío (circularidad corregida).

---

## 1. Convenciones de esquema

| Área | Convención | Por qué |
|---|---|---|
| Tablas | `snake_case` **plural** (`price_publications`, `orders`) | Continuidad con NØSEE; coincide con la convención declarada en el .md |
| Columnas | **Inglés** (`name`, `created_at`, `is_active`, `distributor_id`) | Continuidad con NØSEE y con el codegen de TypeScript; elimina la mezcla `distribuidor_id`/`fecha` del .md |
| Strings | **`text` en todo** (sin `varchar(n)` decorativos) | Un solo tipo; Postgres no ahorra con varchar(n) y el límite solo estorba (corrige la mezcla varchar/text heredada de NØSEE) |
| IDs internos | `bigint GENERATED ALWAYS AS IDENTITY` | Mitad de tamaño que uuid en FKs e índices; payloads JSON más cortos (egress) y QR más pequeño |
| IDs auth | `users.id uuid` → FK `auth.users(id)` | Obligatorio por Supabase Auth |
| Dinero | `numeric(12,2)` (precios), `numeric(14,2)` (créditos) + `currency char(3)` | Exactitud decimal; nunca `float`. Divisa explícita desde el día 1 (D26) |
| Cantidades | `numeric(12,3)` **en todo** (incluye `order_items`) | Soporta kg (2,5 kg es un pedido real); enteros lo prohibían |
| Tiempos | `timestamptz` (UTC) en todo; `date` para fechas de ruta | NØSEE usa `timestamp without time zone` → **corregido aquí** (D3) |
| Estados/tipos | **Enums nativos** con etiquetas en inglés (`pending`, `entry`) | 4 bytes/fila vs ~30 de varchar; integridad en BD; tipos TS generados limpios (D2) |
| Borrado | `is_active boolean` en catálogos y entidades; **RESTRICT** en FKs de catálogo | Soft-delete: preserva historial de movimientos/pedidos/precios. "Eliminar" en la matriz de roles = **soft-delete** |
| Mutable vs append-only | `updated_at` + trigger solo en tablas mutables; append-only solo `created_at` | Ahorro de 8 bytes/fila y de triggers donde no aportan |
| Actores vs dueños | Actor = `created_by`; dueño = `user_id` | Un solo patrón para "quién hizo esto" (D4) |

**Tipado de referencia**

```sql
-- Enums (crear todos en el Sprint 1)
CREATE TYPE movement_type      AS ENUM ('entry','exit');
CREATE TYPE order_status       AS ENUM ('pending','in_route','delivered','cancelled');
CREATE TYPE order_item_status  AS ENUM ('pending','received','partial');   -- estado por línea (p.11 del .md)
CREATE TYPE route_status       AS ENUM ('planned','active','completed','cancelled');
CREATE TYPE stop_status        AS ENUM ('pending','arrived','completed','skipped');
CREATE TYPE credit_status      AS ENUM ('pending','paid','cancelled');
CREATE TYPE payment_method     AS ENUM ('cash','transfer','card','other');
CREATE TYPE alert_type         AS ENUM ('stock_low','expiry_soon','order_late','credit_overdue');
CREATE TYPE chat_role          AS ENUM ('user','assistant','tool');
CREATE TYPE audit_action       AS ENUM ('insert','update','delete');
CREATE TYPE contact_preference AS ENUM ('whatsapp','phone','email');
```

**Protocolo de migración de enums en Supabase**: cada migración corre en una transacción ⇒ `ALTER TYPE ... ADD VALUE` puede **añadirse** pero **no usarse** en la misma migración (dividir en 2 migraciones). No existen `DROP`/`EDIT` de valores: si un valor va a tener churn alto, reconsiderar `text + CHECK` (decisión consciente, D2).

**ON DELETE global**: catálogos/entidades base → `RESTRICT` (borrar un producto con historial debe estar bloqueado; se usa soft-delete). Hijos directos → `CASCADE` (`order_items`, `chat_messages`, `credit_payments`, `route_stops`, `user_stores`). `users.distributor_id` y `product_categories.parent_id` → `SET NULL`. `orders.route_id` → **`RESTRICT`** (corregido: `SET NULL` desenganchaba pedidos `in_route` de su ruta en silencio).

---

## 2. Tablas reutilizadas de NØSEE (11)

Leyenda de columnas: **Origen** = `NØSEE` (se conserva tal cual) · `FAROX` (nueva) · `mod` (modificada respecto a NØSEE).

### 2.1 `store_types`
Catálogo requerido por `stores.store_type_id NOT NULL`.

| Atributo | Tipo | Origen |
|---|---|---|
| `id` | integer identity PK | NØSEE |
| `name` | text NOT NULL, UNIQUE | NØSEE (varchar → text) |
| `created_at` | timestamptz NOT NULL DEFAULT now() | FAROX (auditoría básica) |

### 2.2 `unit_types`

| Atributo | Tipo | Origen |
|---|---|---|
| `id` | integer identity PK | NØSEE |
| `name` | text NOT NULL **UNIQUE** | mod — NØSEE **no** tiene unique en `name`; se añade (integridad de catálogo) |
| `abbreviation` | text NOT NULL | NØSEE — validar unicidad en seed (§7); si pasa, añadir `UNIQUE (abbreviation)` |
| `category` | text NOT NULL | NØSEE |
| `created_at` | timestamptz NOT NULL DEFAULT now() | FAROX |

### 2.3 `roles`

| Atributo | Tipo | Origen |
|---|---|---|
| `id` | integer identity PK | NØSEE |
| `name` | text NOT NULL, UNIQUE | NØSEE — seed: `admin`, `operador`, `distribuidor` |
| `description` | text | NØSEE |
| `created_at` | timestamptz NOT NULL DEFAULT now() | FAROX |

### 2.4 `brands`

| Atributo | Tipo | Origen |
|---|---|---|
| `id` | bigint identity PK | NØSEE |
| `name` | text NOT NULL, UNIQUE | NØSEE |
| `is_active` | boolean NOT NULL DEFAULT true | NØSEE |
| `created_at` / `updated_at` | timestamptz | mod — `updated_at` añadido (mutable) |

**Elimina de NØSEE**: `is_admin_hidden` + `hidden_public_at/by/reason` + `hidden_admin_at/by/reason` (6 columnas de moderación de la app comunitaria — FAROX no tiene votación/reportes de usuarios).

### 2.5 `product_categories`

| Atributo | Tipo | Origen |
|---|---|---|
| `id` | integer identity PK | NØSEE |
| `name` | text NOT NULL, UNIQUE | NØSEE (varchar → text) |
| `description` | text | NØSEE |
| `parent_id` | integer NULL → FK `product_categories` ON DELETE SET NULL | FAROX — jerarquía del .md (MVP); **nullable** ⇒ sigue funcionando plana con los datos de NØSEE (D5) |
| `created_at` / `updated_at` | timestamptz | FAROX |

### 2.6 `products`

| Atributo | Tipo | Origen |
|---|---|---|
| `id` | bigint identity PK | NØSEE |
| `name` | text NOT NULL | NØSEE |
| `description` | text NULL | FAROX — el .md la pide; NØSEE no la tiene |
| `category_id` | integer NOT NULL FK RESTRICT | mod — NØSEE no declara FK explícita; se añade con RESTRICT |
| `brand_id` | bigint NOT NULL FK RESTRICT | mod — NØSEE usa `ON DELETE CASCADE` (borrar marca borraba productos); RESTRICT protege el historial de movimientos (D14) |
| `unit_type_id` | integer NOT NULL FK RESTRICT | NØSEE |
| `created_by` | uuid NOT NULL FK → users RESTRICT | FAROX — **creador = dueño del registro** del catálogo compartido; backfill al admin del seed en la migración (D36) |
| `base_quantity` | numeric(12,3) NOT NULL CHECK (> 0) | NØSEE + CHECK |
| `barcode` | text NULL | NØSEE — **no existe `sku`**: se reutiliza `barcode` (D6/D42). El QR asocia **tienda↔distribuidor** (se genera en cliente; 0 egress) y no necesita SKU |
| `is_active` | boolean NOT NULL DEFAULT true | NØSEE |
| `search_vector` | tsvector GENERATED STORED | mod — **`to_tsvector('spanish', coalesce(name,'') || ' ' || coalesce(description,''))`**: la versión `name ∥ description` **devolvía NULL** para todo producto sin descripción (casi todos los de NØSEE) — bug corregido |
| `created_at` / `updated_at` | timestamptz | mod — `updated_at` añadido |

**Elimina de NØSEE**: `is_admin_hidden` + 5 columnas `hidden_*` (moderación).

**Escritura**: solo el **creador** (`created_by = auth.uid()`) o **admin** (override) — catálogo de uso general, escritura trazada (D36). Crear requiere `has_scope()` (gate D37).

**Índices**
- `products_pkey`
- `uq_products_barcode` — **copiar el funcional de NØSEE** (normaliza y permite repetir espacios/puntuación):
  `CREATE UNIQUE INDEX ... ON products (lower(regexp_replace(barcode,'[^a-zA-Z0-9]','','g'))) WHERE barcode IS NOT NULL AND length(trim(barcode)) > 0;`
- **Diferidos** (§5): `gin(search_vector)` y `gin(name gin_trgm_ops)`, `btree (created_by)` — con 209 productos un seq scan `ILIKE` gana; 2 GIN = escritura gratis perdida. Umbral de activación: ~50.000 productos. **`pg_trgm` NO se instala en el Sprint 1.**
- El front **nunca** debe traer `search_vector` en listados (`select=` explícito).

### 2.7 `stores`

| Atributo | Tipo | Origen |
|---|---|---|
| `id` | **bigint identity** PK | **mod** — NØSEE usa `uuid`; se cambia a bigint por consistencia con el resto de IDs internos y por joins/payloads más livianos (D1). Requiere cambiar también `price_publications.store_id` (BD vacía ⇒ costo cero) |
| `store_type_id` | integer NOT NULL FK RESTRICT | NØSEE |
| `name` | text NOT NULL | NØSEE |
| `address` | text | NØSEE |
| `city` | text | FAROX — requisito p.7 del .md (NØSEE no lo tiene) |
| `country` | char(2) NOT NULL DEFAULT `'CO'` | FAROX — prepara multi-país sin backfill ambiguo (D26) |
| `phone` | text | FAROX — requisito p.7 |
| `location` | **geography(Point,4326) NOT NULL** | NØSEE — PostGIS (decidido); único punto de verdad geográfico (D12) |
| `website_url` | text | NØSEE |
| `created_by` | uuid NOT NULL FK → users RESTRICT | mod — **dueño y actor** de la tienda (D33); escrito solo por `create_store()` ⇒ sin suplantación (el DEFAULT de PostgREST no la evitaba: el cliente podía enviar el campo explícito). Backfill al admin del seed en la migración |
| `is_active` | boolean NOT NULL DEFAULT true | NØSEE |
| `created_at` / `updated_at` | timestamptz | mod — `updated_at` añadido |

**Elimina de NØSEE**: `is_admin_hidden` + 5 `hidden_*`, `evidence_count` (comunidad).

**Alta y tope**: crear tienda solo vía **`create_store()`** (§4) — valida el tope por usuario (**1 tienda activa; 3 si `is_premium()`**; admin exento — D34), inserta la tienda y **auto-asocia al dueño en `user_stores`** (D35) ⇒ el dueño obtiene alcance con el mecanismo RLS existente. UPDATE directo permitido solo al dueño/admin; DELETE admin (soft).

**Índices**: PK · **`GIST (location)` DIFERIDO** — con 25 tiendas el planner elige seq scan siempre; el GiST es la estructura de índice más cara de escribir. Umbral de activación: **~1.000 tiendas** (D22). NØSEE tiene **dos** GIST duplicados sobre `location` — no copiar ninguno todavía. `btree (name)` también diferido (25 filas).

**Acceso lat/lng en API**: los clientes solo necesitan coordenadas para el mapa ⇒ exponer la vista `stores_geo` (§4) en vez de calcular en el front (ST_X/ST_Y se evalúan en servidor).

### 2.8 `price_publications`

| Atributo | Tipo | Origen |
|---|---|---|
| `id` | bigint identity PK | NØSEE |
| `product_id` | bigint NOT NULL FK RESTRICT | NØSEE |
| `store_id` | bigint NOT NULL FK RESTRICT | mod — era `uuid`; tipo sigue a `stores.id` (D1). RESTRICT en vez del `CASCADE` de NØSEE: con soft-delete no debe perderse historial de precios (D14) |
| `created_by` | uuid NOT NULL FK → `users` RESTRICT | **mod** — era `user_id`; D4: actor = `created_by`. Escrito solo por `set_price()` |
| `price` | numeric(12,2) NOT NULL **CHECK (> 0)** | mod — precisión fija; **0 prohibido** (¿gratis o error de captura?) (D27) |
| `currency` | char(3) NOT NULL DEFAULT `'COP'` | FAROX — divisa explícita (D26) |
| `is_active` | boolean NOT NULL DEFAULT true | NØSEE |
| `created_at` | timestamptz | mod — era `timestamp without time zone`; es el `effective_at` del precio |
| `updated_at` | timestamptz | FAROX (cambia `is_active`) |

**Elimina de NØSEE**: `photo_url`, `description`, `confidence_score`, `validated_count`, `downvoted_count`, `active_reports_count`, `comments_count`, `is_admin_hidden` + 5 `hidden_*` — mecánica de votación/comunidad de NØSEE, fuera del alcance FAROX.

**Regla de historial (corregida)**: un `UPDATE` del precio sobre la fila activa **destruiría** el histórico (el índice `(product_id, created_at DESC)` quedaría incompleto). La única forma de cambio permitida es la función **`set_price()`** (§4): inserta fila nueva `is_active=true` + desactiva la anterior, en una transacción. Un trigger **prohíbe** hacer `UPDATE` de `price` sobre una fila activa (solo se permite apagar `is_active`).

**Índices**
- PK
- **`uq_price_store_product_active`** — `UNIQUE (store_id, product_id) WHERE is_active` → **impone en BD la regla "1 fila activa por Producto↔Tienda"**. NØSEE solo tiene un índice *no único* (`idx_price_store_product`) ⇒ la regla vive solo en el código (D17).
- `btree (product_id, created_at DESC)` — histórico de precios de un producto.

### 2.9 `users`

| Atributo | Tipo | Origen |
|---|---|---|
| `id` | uuid PK → FK `auth.users(id)` **ON DELETE CASCADE** | mod — NØSEE es `NO ACTION`; CASCADE hace que borrar la cuenta de auth limpie el perfil (D8) |
| `role_id` | integer NOT NULL FK RESTRICT | NØSEE |
| `full_name` | text NOT NULL | NØSEE (varchar → text) |
| `email` | text **UNIQUE** | FAROX — copia de `auth.users.email` sincronizada por trigger (PostgREST no puede leer `auth.users` con el JWT del cliente); UNIQUE por si se redacta a mano |
| `phone_number` | text | NØSEE |
| `contact_preference` | contact_preference NOT NULL DEFAULT `whatsapp` | FAROX — requisito .md |
| `distributor_id` | bigint NULL FK → `distributors` ON DELETE SET NULL | FAROX — **sin esto el rol distribuidor no existe**: RLS "solo los suyos" necesita `mi_id`. **1 usuario ↔ 1 distribuidor** (D29); el trigger `sanitize_distributor_scope()` exige el par (rol `distribuidor` ⇒ `distributor_id NOT NULL`; otro rol ⇒ `NULL`) — evita scope RLS huérfano o incompleto (M11) |
| `premium` | boolean NOT NULL DEFAULT false | FAROX — fuente única de verdad en tabla (D7); `is_premium()` la lee. "Admin siempre premium" se resuelve en `is_premium()` (`premium OR rol = admin`), no con constraint |
| `is_active` | boolean NOT NULL DEFAULT true | NØSEE |
| `created_at` / `updated_at` | timestamptz | NØSEE |

**Elimina de NØSEE**: `reputation_points`, `avatar_url`, `mp_customer_id`, `onboarding_completed`, `is_verified` (verificación comunitaria; la verifica Supabase Auth).

**Índices**: PK · `btree (distributor_id)` (RLS del distribuidor). Diferidos: `btree (role_id)` y `btree (lower(full_name))` — con 27 usuarios son ruido puro (D22); `role_id` se cubre en el único `(role_id, is_active)` si alguna vez hiciera falta filtrar users por rol a escala.

> Nombre `users` conservado por **continuidad con NØSEE** (se desdice la recomendación previa de `profiles`; D8). El .md principal debe alinearse.

### 2.10 `orders` — nombre reutilizado, semántica propia

NØSEE: pedido de **consumidor con delivery** (dealer, pin, jsonb…). FAROX: **pedido a distribuidor**. Se conservan nombres y patrón de estados; el contenido es nuevo (D9).

| Atributo | Tipo | Origen |
|---|---|---|
| `id` | bigint identity PK | mod — NØSEE `integer` |
| `distributor_id` | bigint NOT NULL FK RESTRICT | FAROX |
| `store_id` | bigint NOT NULL FK RESTRICT | FAROX |
| `status` | order_status NOT NULL DEFAULT `pending` | mod — NØSEE `varchar` sin CHECK; enum + valores propios (D2) |
| `route_id` | bigint NULL FK → `routes` **ON DELETE RESTRICT** | FAROX — liga el pedido "en_ruta" a su ruta; RESTRICT corrige el `SET NULL` que desenganchaba pedidos en ruta |
| `created_by` | uuid NOT NULL FK → `users` RESTRICT | FAROX — quién lo creó (admin/operador) |
| `expected_at` | timestamptz NULL | FAROX — **fecha prometida/SLA**: sin ella la alerta `order_late` es inexpressible (crítica B1) |
| `delivered_at` | timestamptz NULL | FAROX — momento de entrega (reportes y créditos) |
| `notes` | text | FAROX (opcional) |
| `cancelled_at` | timestamptz NULL | FAROX — instante de cancelación (A7) |
| `cancelled_reason` | text NULL | FAROX — motivo obligatorio al cancelar (lo exige `update_order_status`) |
| `created_at` / `updated_at` | timestamptz | NØSEE |

**CHECKs de consistencia**: `CHECK (status <> 'delivered' OR delivered_at IS NOT NULL)` y `CHECK (delivered_at IS NULL OR status = 'delivered')` — un pedido no puede estar "entregado sin fecha" ni "con fecha sin entregarse". `CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)` — cancelado implica fecha de cancelación.

**Elimina de NØSEE**: `delivery_address`, `delivery_location`, `total_*` (4), `savings_percentage`, `stores`/`items`/`checked_items` jsonb, `delivery_fee`, `service_fee`, `strategy`, `payment_*`, `abandoned_*`, `delivery_pin`+`pin_verified_at`, `compromiso_*`, `llegando_at`, `local_id`, `dealer_*`, `is_priority`, `dealer_cancel_*`, `delivery_mode`, `delivery_coords`, `delivery_name/phone/apartment/instructions` — ~35 columnas de flujo de delivery que no aplican.

**Índices**: PK · `btree (distributor_id, status)` · `btree (store_id, created_at DESC)`. `route_id` **sin índice** (los pedidos en ruta por ruta son pocos; añadir si la consulta aparece en `pg_stat_statements`).

### 2.11 `order_items`

| Atributo | Tipo | Origen |
|---|---|---|
| `id` | bigint identity PK | mod |
| `order_id` | bigint NOT NULL FK → `orders` **CASCADE** | NØSEE |
| `product_id` | bigint NOT NULL FK RESTRICT | NØSEE |
| `quantity` | **numeric(12,3)** NOT NULL CHECK (> 0) | mod — NØSEE `integer` **sin CHECK**; corregido a numeric: un pedido de **2,5 kg era imposible** (crítica B10) |
| `received_quantity` | numeric(12,3) NULL CHECK (>= 0 AND <= quantity) | FAROX — recepción parcial (p.11); el CHECK `<= quantity` era inexistente |
| `status` | order_item_status NOT NULL DEFAULT `pending` | FAROX — **estado por línea** que el .md prometía al justificar `order_items` (p.11) |
| `unit_price` | numeric(12,2) NOT NULL CHECK (> 0) | FAROX — **precio congelado en la línea**; sin él no se deriva `credits.total_amount` ni el valor de ventas. No se reutiliza `assigned_price` de NØSEE: pertenece a la lógica de sustitución de tienda que FAROX no tiene |
| `created_at` / `updated_at` | timestamptz | FAROX (`received_quantity`/`status` mutan) |

**Elimina de NØSEE**: `assigned_store_id`, `status` (redefinido), `substituted_with_product_id`.

**Índices**: PK · `UNIQUE (order_id, product_id)` — una línea por producto por pedido (evita duplicados por doble submit) · el índice del unique **cubre** la FK `order_id`; `btree (product_id)` para joins inversos.
**Nota**: NØSEE deja `order_items` **sin índices FK** — no copiar ese descuido.
**Precio (D40)**: SELECT **revocado** — las líneas se leen con `get_order_items()`, que **omite `unit_price`** a los no-premium (RLS no filtra columnas ⇒ solo RPC). El flujo de pedido no se gatea: el distribuidor normal ve producto y cantidad.

**Consulta DIST-02** ("asignado a distribuidor, no movilizado") — sin tabla extra: `order_items JOIN orders WHERE orders.distributor_id = X AND orders.status = 'pending' AND order_items.status IN ('pending') AND NOT EXISTS (movements WHERE order_id = orders.id)` (calificado: hay `status` en ambas tablas — NIT corregido). Una sola fuente de verdad del "recibido": `order_items.status/received_quantity` (escritura); `movements` con `order_id` es el **efecto en stock** de esa misma operación atómica (§4 `confirm_delivery` — que **suma** entrada a la tienda destino), no una segunda opinión divergente.

---

## 3. Tablas nuevas FAROX (14)

### 3.1 `stock` — asignación Producto ↔ Tienda

| Atributo | Tipo | Notas |
|---|---|---|
| `product_id` | bigint FK RESTRICT | PK compuesta `(product_id, store_id)` |
| `store_id` | bigint FK RESTRICT | |
| `quantity` | numeric(12,3) NOT NULL DEFAULT 0 CHECK (>= 0) | Soporta kg y unidades enteras |
| `threshold` | numeric(12,3) **NULL DEFAULT NULL** CHECK (threshold IS NULL OR threshold >= 0) | "Punto de pedido" (`umbral`). **NULL = sin umbral configurado** (corregido: `DEFAULT 0` hacía que toda fila recién asignada (0,0) disparara alerta masiva al mapear productos — D28) |
| `expiry_date` | date NULL | **Caducidad vigente del par** producto↔tienda (la más próxima del remanente). Mantenida por `register_*`: entrada ⇒ `LEAST(actual, nueva)`; salida ⇒ `NULL` al llegar a 0. **Aproximación documentada**: sin lotes FEFO no se sabe qué lote salió (D30) |
| `updated_at` | timestamptz | Mutable (lo escriben las funciones de movimiento) |

- **Índices**: PK · `btree (store_id)` — la PK solo cubre filtros por `product_id`; el dashboard consulta "stock de esta tienda".
- **Sin índice parcial** `WHERE quantity <= threshold`: la condición es volátil (cambia el umbral) y el conjunto es productos×tiendas (miles de filas) ⇒ escanearlo es gratis; la señal **se materializa** en `alerts` (D11).
- Escritura **solo** vía `assign_product_to_store` / `register_entry` / `register_exit` (REVOKE a `authenticated`).
- **Regla INV-06 exacta** (documentada, no improvisada): alerta si `quantity = 0` **o** (`threshold IS NOT NULL` y `quantity <= threshold`). La evaluación ocurre **solo en transiciones** (assign + register_*), nunca por batch — así cada cruce = 1 alerta por episodio (D24).

**Parámetros de almacenamiento** (HOT/autovacuum — la tabla con más UPDATEs del sistema):
```sql
ALTER TABLE stock SET (fillfactor = 85, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
```

### 3.2 `distributors`

| Atributo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `name` | text NOT NULL | |
| `nit` | text **NOT NULL UNIQUE** | Corregido: "NIT obligatorio" no se cumplía con `UNIQUE` nullable |
| `contact_name` | text | |
| `phone` / `email` | text | |
| `contact_preference` | contact_preference NOT NULL DEFAULT whatsapp | |
| `is_active` | boolean NOT NULL DEFAULT true | |
| `created_at` / `updated_at` | timestamptz | |

### 3.3 `motives` — catálogo de motivos/origen

| Atributo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `name` | text NOT NULL UNIQUE | **Seed obligatorio** (§7) con los del DIST-04: *venta*, *reabastecimiento*, *devolución* (+ *merma*, *ajuste*) |
| `suggested_type` | movement_type **NULL** | `entry`/`exit` sugerido; **NULL = aplica a ambos** (p.ej. *ajuste*) |
| `is_active` | boolean NOT NULL DEFAULT true | |
| `created_at` | timestamptz | |

> **DIST-04 resuelto aquí**: la tipificación Venta/Reabastecimiento/Devolución vive en `motives.name` y viaja en cada `movements.motive_id` — no hace falta otra tabla ni posponerlo a Fase II.

### 3.4 `movements` — entradas y salidas (append-only)

| Atributo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `type` | movement_type NOT NULL | Tabla única con campo tipo (decisión p.10) |
| `product_id` | bigint NOT NULL FK RESTRICT | |
| `store_id` | bigint NOT NULL FK RESTRICT | Asociación obligatoria (INV-04) |
| `distributor_id` | bigint NULL FK RESTRICT | Para el dashboard agrupado (INT-01). **No es parámetro libre**: si `order_id` viene, la función **deriva** `distributor_id` del pedido (imposible atribuir al distribuidor A un movimiento del pedido B) (D25) |
| `motive_id` | bigint NOT NULL FK RESTRICT | Motivo obligatorio (INV-04) |
| `order_id` | bigint NULL FK RESTRICT | Movimiento asociado a pedido (DIST-02/04) |
| `created_by` | uuid NOT NULL FK → `users` RESTRICT | Actor |
| `quantity` | numeric(12,3) NOT NULL CHECK (> 0) | Siempre positiva; el signo lo da `type` |
| `unit_price` | numeric(12,2) NULL | **Precio del producto al momento del movimiento** (tomado de `price_publications` activo, o de `order_items.unit_price` si hay pedido) — sin esto `dashboard_daily.entries_value` no existe y el join al precio *actual* sería históricamente incorrecto (crítica A5) |
| `expiry_date` | date NULL | Solo en entradas: `CHECK (type = 'entry' OR expiry_date IS NULL)` |
| `reverso_of_id` | bigint NULL FK → `movements` RESTRICT | **Anulación por reverso** (admin corrige; el original queda intacto). **Invariantes corregidos**: `UNIQUE (reverso_of_id) WHERE reverso_of_id IS NOT NULL` (máx. 1 reverso por movimiento, prohíbe doble reverso) + validaciones en `register_reverse()` (tipo opuesto, mismo producto/tienda, original no revertido — prohíbe reverso-de-reverso) (D31) |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

- **Append-only**: ni `updated_at` ni UPDATEs (REVOKE completo).
- **Índices (reducidos de 7 a 6, de los cuales 3 parciales + 1 BRIN)**:
  - PK
  - `btree (store_id, created_at DESC)` — historial por tienda
  - `btree (product_id, created_at DESC)` — historial por producto
  - `btree (distributor_id, created_at DESC) WHERE distributor_id IS NOT NULL` — **parcial** (los movimientos manuales sin pedido quedan fuera, que son los que no se consultan por distribuidor)
  - `btree (order_id) WHERE order_id IS NOT NULL` — **parcial**: la mayoría de movimientos sueltos tienen `order_id NULL` y el índice completo pagaría ~18 MB por nada
  - **`BRIN (created_at)`** — rango global del dashboard (D18)
  - **Eliminado**: `btree (created_by)` — 27 usuarios distintos ≈ selectividad nula; el BRIN por rango + `(table_name, created_at)` del audit cubren al usuario (crítica A6: ~60 MB y 2 estructuras menos por INSERT)
  - **Sin índice en `motive_id`**: cardinalidad bajísima y siempre se filtra dentro de tienda/fecha
  - **Parcial** `btree (expiry_date) WHERE expiry_date IS NOT NULL` — alimenta el job diario de `expiry_soon` (§7); ~1-2 MB a 1M
- **Sin partición de por vida** (D23): 1M filas ≈ 180 MB de heap + BRIN; particionar rompería la FK `reverso_of_id` (PK de partición no es única globalmente) sin beneficio real. `audit_log`/`chat_messages` sí podrían `ATTACH` en el futuro (no tienen FKs entrantes).

### 3.5 `routes`

| Atributo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `distributor_id` | bigint NOT NULL FK RESTRICT | |
| `route_date` | date NOT NULL | |
| `status` | route_status NOT NULL DEFAULT `planned` | |
| `created_at` / `updated_at` | timestamptz | |

**Índices**: PK · **`UNIQUE (distributor_id, route_date) WHERE status <> 'cancelled'`** — una ruta activa por distribuidor por día; **corregido**: el unique incondicional impedía crear la ruta de reemplazo tras cancelar la del día (crítica B8) · `btree (route_date)` para "rutas de hoy".

### 3.6 `route_stops`

| Atributo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `route_id` | bigint NOT NULL FK → `routes` CASCADE | |
| `store_id` | bigint NOT NULL FK RESTRICT | Coords viven en `stores.location` (no duplicar) |
| `stop_order` | smallint NOT NULL CHECK (> 0) | Orden para Google Maps |
| `estimated_time` | time NULL | |
| `status` | stop_status NOT NULL DEFAULT `pending` | |
| `arrived_at` | timestamptz NULL | Marca real de visita |
| `created_at` | timestamptz | |

**Índices**: PK · `UNIQUE (route_id, stop_order)` — el unique **ya indexa** `route_id` (no añadir índice FK separado).

### 3.7 `credits` — fiado (MVP)

| Atributo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `order_id` | bigint NOT NULL FK RESTRICT **UNIQUE WHERE status <> 'cancelled'** | **1 crédito vigente por pedido** (D15, corregido): el unique incondicional impedía re-crédito tras anular uno (crítica B4) |
| `store_id` | bigint NOT NULL FK RESTRICT | Deudor |
| `total_amount` | numeric(14,2) NOT NULL CHECK (> 0) | Derivable de `order_items.unit_price × quantity` |
| `currency` | char(3) NOT NULL DEFAULT `'COP'` | Divisa explícita (D26) |
| `balance` | numeric(14,2) NOT NULL CHECK (>= 0 AND <= total_amount) | Denormalizado; lo mantiene `register_payment()`. Un cobro **excesivo** se corrige **revirtiendo el pago** (§3.8), nunca con `balance > total` |
| `status` | credit_status NOT NULL DEFAULT `pending` | `CHECK (status <> 'paid' OR balance = 0)` — no puede quedar `paid` con saldo; `register_payment()` pone `paid` al llegar a 0 y `settled_at` |
| `due_date` | date NULL | **Vencimiento del fiado** — habilita `credit_overdue` y "deudores vencidos" (crítica B4) |
| `settled_at` | timestamptz NULL | Cuándo se saldó |
| `cancelled_at` / `cancelled_reason` | timestamptz / text NULL | Anulación trazable (admin) |
| `created_by` | uuid NOT NULL FK → `users` RESTRICT | Admin que lo creó |
| `created_at` / `updated_at` | timestamptz | |

- "Deudores con saldo > por mis distribuidores": `credits JOIN orders USING (order_id)` — join directo por el unique, **sin columna duplicada**.
- Índices: PK · UNIQUE parcial del pedido · `btree (store_id)` · `btree (status) WHERE status IN ('pending')` (cartera abierta real; `WHERE status <> 'paid'` incluía `cancelled` — A/M5).
- **Cancelación (regla fija)**: `cancel_credit()` solo admin; exige `cancelled_at`/`cancelled_reason`; si `balance < total_amount` (ya hay cobros) **primero** exige revertir los pagos (`register_payment_reverse`) — un crédito con pagos no se anula con saldo.
- `CHECK (status <> 'paid' OR settled_at IS NOT NULL)` — `paid` exige fecha de saldado.
- `ALTER TABLE credits SET (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.05);`

### 3.8 `credit_payments`

| Atributo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `credit_id` | bigint NOT NULL FK → `credits` CASCADE | |
| `amount` | numeric(14,2) NOT NULL CHECK (> 0) | |
| `reverso_of_id` | bigint NULL FK → `credit_payments` RESTRICT **UNIQUE WHERE NOT NULL** | **Corrección de cobros**: un pago mal registrado se revierte con su reverso (append-only intacto), nunca con UPDATE |
| `payment_method` | payment_method NOT NULL | `forma_pago` del .md |
| `created_by` | uuid NOT NULL FK → `users` RESTRICT | Quien registró el cobro |
| `paid_at` | timestamptz NOT NULL DEFAULT now() | `fecha` del .md |

Append-only · **Índices**: PK · `btree (credit_id)`.

### 3.9 `alerts` — única tabla de alertas (rediseñada)

| Atributo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `type` | alert_type NOT NULL | `stock_low`, `expiry_soon`, `order_late`, `credit_overdue` |
| `store_id` | bigint NULL FK RESTRICT | |
| `product_id` | bigint NULL FK RESTRICT | |
| `order_id` | bigint NULL FK RESTRICT | |
| `distributor_id` | bigint NULL FK RESTRICT | Dueño para RLS: **solo `order_late` y `credit_overdue`** lo derivan del pedido/crédito. `stock_low`/`expiry_soon` son **de tienda** y lo dejan NULL (no existe relación tienda↔distribuidor en el esquema) — política explícita en §8: el distribuidor **no** esas alertas; las ven admin y el operador de la tienda (A4) |
| `message` | text NOT NULL | **Añadido** — texto listo para UI ("Coca-Cola en Tienda Norte: 3 < umbral 10"); la UI no debe reconstruir datos que ya cambiaron |
| `context` | jsonb | **Añadido** — snapshot al disparar: `{quantity, threshold, dias_restantes, monto}` |
| `read_at` | timestamptz NULL | Reemplaza a `is_read` (un solo campo, se consulta `read_at IS NULL`) |
| `resolved_at` | timestamptz NULL | **Añadido** — fin del episodio (condición normalizada) |
| `created_at` | timestamptz | |

- **Regla de cálculo explícita** (antes era vaga):
  - `stock_low`: en `assign_product_to_store`/`register_*` si `quantity = 0 OR (threshold IS NOT NULL AND quantity <= threshold)`; se **resuelve** (`resolved_at = now()`) cuando `quantity > threshold` (o `> 0` si no hay umbral).
  - `expiry_soon`: job diario (§7) sobre `stock.expiry_date <= CURRENT_DATE + 15` (horizonte = constante del job) AND `quantity > 0`; se **resuelve** cuando la fila sale del horizonte (`expiry_date > CURRENT_DATE + 15` o `quantity = 0`) — el job también **cierra** episodios caducos, no solo los abre (A6).
  - `order_late`: job diario sobre `orders.expected_at < now() AND delivered_at IS NULL AND status NOT IN ('delivered','cancelled')`; se **resuelve** en `confirm_delivery` (al poner `delivered_at`) y en la cancelación (A6).
  - `credit_overdue`: job diario sobre `credits.due_date < CURRENT_DATE AND balance > 0`; se **resuelve** en `register_payment`/`register_payment_reverse` cuando `balance = 0`, y al cancelar el crédito (A6).
  - Sin este cierre, el dedup `WHERE resolved_at IS NULL` impediría re-alertar **para siempre** tras la primera vez (A6).
- **Anti-duplicados por episodio** (corregido): índice **nombrado** `uq_alert_open` = `UNIQUE (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0)) WHERE resolved_at IS NULL` — con el dedup viejo (`WHERE NOT is_read`), marcar como leída y seguir por debajo del umbral re-alertaba **en cada movimiento** (spam + realtime + egress). Ahora: 1 alerta abierta por episodio; se re-abre solo cuando la condición se normaliza y vuelve a cruzarse. **El `ON CONFLICT` debe referenciar `ON CONFLICT (type, coalesce(...), ...) WHERE resolved_at IS NULL` carácter a carácter igual que la definición del índice** (si no, Postgres no matchea el índice y lanza error en caliente) (nit).
- Todo INSERT de alertas usa **`ON CONFLICT ... DO NOTHING` con el target completo** (expresiones COALESCE incluidas) — nunca `EXCEPTION` (subtransacción en el camino caliente) ni SELECT previo (carrera).
- **Índices**: PK · el único parcial cubre "alertas sin resolver" (el listado principal) · `btree (distributor_id)`.

### 3.10 `user_stores` — alcance del operador

| Atributo | Tipo | Notas |
|---|---|---|
| `user_id` | uuid FK → `users` CASCADE | PK compuesta |
| `store_id` | bigint FK → `stores` CASCADE | PK compuesta |
| `created_at` | timestamptz | |

Sin esto, "Dashboard: operador ✔ su alcance" y el RLS por tienda no tienen sobre qué filtrar. PK `(user_id, store_id)` indexa ambas direcciones.
El dueño se auto-asocia en `create_store()` (D35) — `user_stores` sigue siendo la **única** fuente de alcance.

### 3.11 `chat_conversations`

| Atributo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `user_id` | uuid NOT NULL FK → `users` CASCADE | Dueño |
| `title` | text NULL | |
| `created_at` / `updated_at` | timestamptz | `updated_at` lo toca un trigger al insertar mensaje (ordenar listados). **Sin trigger de auditoría** — auditar mensajes de chat es ruido + peso (crítica A1) |

Índices: PK · `btree (user_id, updated_at DESC)`.

### 3.12 `chat_messages`

| Atributo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `conversation_id` | bigint NOT NULL FK CASCADE | |
| `role` | chat_role NOT NULL | `tool` guarda respuestas de funciones |
| `content` | text NOT NULL | |
| `payload` | jsonb NULL | Tool-calling del chatbot; **fuera de las consultas de listado** (egress) |
| `created_at` | timestamptz | |

**Índices**: PK · `btree (conversation_id, id)` — keyset corregido: por `created_at` dos mensajes de la misma transacción (el chatbot confirma turno + tool-calling juntos) comparten timestamp y el cursor los saltaba/duplicaba. El `id` es único y monotónico (crítica A8). Cursor: `WHERE conversation_id = $1 AND id > $after ORDER BY id LIMIT 21`.

### 3.13 `dashboard_daily` — agregado del INT-01 (antes vista, ahora tabla)

| Atributo | Tipo | Notas |
|---|---|---|
| `day` | date NOT NULL | |
| `distributor_id` | bigint NOT NULL DEFAULT 0 | **0 = movimientos sin pedido/distribuidor** (NO NULL: el unique no cubriría NULLs y cada fila manual crearía una entrada nueva) |
| `entries_count` / `exits_count` | integer NOT NULL DEFAULT 0 | **Conteos, no sumas de `quantity`** — sumar kg + unidades de productos distintos es un número sin significado |
| `entries_value` / `exits_value` | numeric(14,2) NOT NULL DEFAULT 0 | Valor monetario = `quantity × movements.unit_price` |
| `updated_at` | timestamptz | |

- `UNIQUE (day, distributor_id)`.
- **Alcance por rol (A3 — decisión MVP)**: el grano es por **distribuidor** y no existe relación tienda↔distribuidor, por lo que "su alcance" del operador (tiendas) **no es servible** sin re-agregar `movements`. Decisión MVP: **el operador ve el agregado global** (desviación consciente de la matriz SEC-01, anotada en §8 y en la matriz); el distribuidor solo su `distributor_id`. Si el alcance por tienda se vuelve requisito, se añade columna `store_id` al agregado y upsert por tienda (migración aditiva).
- **`INSERT … ON CONFLICT DO UPDATE`** dentro de `register_entry/register_exit` — 1 upsert barato por movimiento en vez de **re-agregar todo el historial en cada poll** (crítica A2: la vista original leía ~150 MB lógicos por refresco a 1M movements y crecía sin límite de filas).
- Lectura vía **`get_dashboard(p_from, p_to)`** (§4): RPC `SECURITY DEFINER` con rango por defecto **30 días** y filtro por rol — además resolvía que la vista **evadía RLS** (ejecutaba como owner y el distribuidor veía el agregado de todos).
- Realtime: la tabla se publica (§5) — el front recibe la fila `(day, distributor_id)` actualizada (~100 B). **Requisito de entrega**: Supabase Realtime solo emite `postgres_changes` si el suscriptor tiene **SELECT + policy RLS** sobre la tabla ⇒ se **GRANTEA SELECT** con la policy `dashboard_read` (no se revoca; coherencia §4/§8):
  ```sql
  GRANT SELECT ON dashboard_daily TO authenticated;
  CREATE POLICY dashboard_read ON dashboard_daily FOR SELECT TO authenticated
  USING (
    is_premium()                                        -- D39: analítica = premium
    AND (
      my_role() = 'admin'
      OR my_role() = 'operador'                         -- A3: agregado global en MVP
      OR distributor_id = my_distributor_id()           -- distribuidor: solo lo suyo
    )
  );
  ```
  La policy deja ver **exactamente** lo que `get_dashboard()` devuelve al rol ⇒ sin fuga de datos vía PostgREST directo.
- **Regla de suscripción (egress)**: suscribir **solo con la pestaña visible** (unsubscribe en `visibilitychange`/unmount) y con `filter=day=eq.<fecha>` — así no se pagan eventos de días que nadie mira.

### 3.14 `audit_log` — quién, qué, cuándo (append-only, alcance acotado)

| Atributo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `created_by` | uuid NULL | Actor — **sin FK**: borrar usuarios no debe chocar con el log histórico |
| `table_name` | text NOT NULL | Cadenas cortas y acotadas (ver alcance abajo); a este volumen el texto está bien (el lookup `smallint` solo valdría con el alcance gigante viejo) |
| `action` | audit_action NOT NULL | |
| `row_id` | **text** NULL | **Corregido de `bigint`**: `users.id` es uuid ⇒ los cambios de rol/premium (los más críticos de SEC-01) quedaban con `row_id NULL` — auditoría inútil justo donde importa (crítica B10) |
| `diff` | jsonb NOT NULL DEFAULT `{}` | **Solo columnas cambiadas**, no snapshots completos (D10) |
| `created_at` | timestamptz | |

**Alcance CORREGIDO** (crítica A1 — el alcance original duplicaba el ledger): trigger `audit_diff()` **solo en** `users` (rol/premium/baja), `price_publications` (cambios de precio), `orders` (cambios de `status`), `credits`, `credit_payments`, `distributors`, **+ `products` y `stores`** (CRUD y baja lógica — su mutación es tan sensible como la de usuarios; asimetría corregida, M8).
**NO** en `movements` (el movimiento **ya es** el asiento forense — auditar su INSERT duplicaba la fuente de verdad) ni en `chat_*` (1 fila por mensaje = el volumen más alto de la BD).
**Nota**: los **SELECT** (incluidos los tools del chatbot) **no** se auditan con triggers DML — si se requiere trazabilidad de lecturas del chatbot, es un mecanismo aparte (pendiente §9; el .md principal afirma "cada consulta queda en audit_log", M8).
Estimado corregido: ~60 MB en vez de ~500 MB a 1M movements.

**Índices**: PK · `btree (table_name, row_id)` · **`BRIN (created_at)`**. **Eliminado** `btree (created_by)` — 27 valores distintos, selectividad basura, ~50 MB perdidos; para "qué hizo el usuario X" existe el BRIN por fecha + `table_name` (crítica A1).

**Lectura (D38)**: `GRANT SELECT` + policy `audit_read` (`USING (my_role() = 'admin')`) — el REVOKE original la dejaba ilegible: el admin no tenía ninguna vía (RPC o policy) para leer su propia auditoría. El front lista con **keyset sobre `created_at`** (lo cubre el BRIN) + `LIMIT`; nunca `count=exact`.

---

## 4. Funciones RPC (el conjunto completo que hace implementable la matriz SEC-01)

> Corregido: el plan anterior solo definía `register_entry/exit` — con los REVOKE, **ni admin ni operador podían hacer nada** de la matriz de roles (crítica B5). Todas las mutaciones pasan por aquí.

| Función | Rol permitido | Qué hace |
|---|---|---|
| `my_role()` | auth | `SECURITY DEFINER STABLE SET search_path` → nombre del rol del JWT (helper de todas las validaciones) |
| `is_premium()` | auth | `SECURITY DEFINER STABLE SET search_path` → **`premium OR my_role() = 'admin'`** leído de `users` (nunca del JWT) (D7) |
| `my_store_ids()` | auth | ids de `user_stores` del usuario (RLS del operador evaluado 1 vez) |
| `my_distributor_id()` | auth | `users.distributor_id` del usuario |
| `handle_new_user()` | trigger (C2) | `AFTER INSERT ON auth.users` → inserta la fila `public.users`: `role_id` = **`operador`** por defecto (rol neutro de ejecución; admin luego reasigna con `update_user_role`), `full_name` desde metadata o email, `email` copiado. **Sin esto el primer login no tiene fila y todo el sistema de permisos cae** |
| `update_user_role(p_user, p_role, p_distributor)` | **solo admin** (C2/M11) | Cambia rol: si el nuevo rol es `distribuidor` **exige** `p_distributor NOT NULL`; si no lo es, setea `distributor_id = NULL`. Única vía de asignar alcance de distribuidor |
| `set_user_premium(p_user_id, p_value)` / `set_user_active(p_user_id, p_value)` | **solo admin** (D47) | **Cierran el gap de columnas privilegiadas D45**: única ruta vía PostgREST para `premium`/`is_active` (UPDATE de tabla completa revocado a todos los roles). Mismo patrón que `update_user_role`: guard solo-admin, SET de su columna + `updated_at`; la auditoría la escribe el trigger `audit_diff` sobre `users` |
| `assign_user_stores(p_user, p_stores bigint[])` | **solo admin** (A1) | Reemplaza el alcance del operador (borra los ausentes, inserta los nuevos, 1 transacción). Única escritura de `user_stores` |
| `assign_product_to_store(p_product, p_store, p_threshold)` | admin, operador | INV-03: crea/actualiza `stock`, evalúa `stock_low` |
| `register_entry(...)` | admin, operador **+ `is_premium()`** (D39) | Valida, **actualiza stock atómicamente**, inserta `movements` (+`unit_price`), evalúa alertas, upsert `dashboard_daily`, audita — 1 transacción |
| `register_exit(...)` | admin, operador **+ `is_premium()`** (D39) | Igual, con validación de stock suficiente |
| `register_reverse(p_movement_id, p_reason)` | **solo admin** | Inserta movimiento inverso con `reverso_of_id` (1 por original, tipo opuesto, mismo producto/tienda), reevalúa alertas y dashboard |
| `set_price(p_product, p_store, p_price, p_currency)` | **solo admin** | `SELECT ... FOR UPDATE` del activo previo (serializa concurrentes) + inserta fila nueva + desactiva la anterior — única mutación de precios permitida |
| `create_order(...)` | admin · operador (**con tienda en scope**; sin premium — D39) | Crea `orders` + `order_items` (`unit_price` congelado) |
| `update_order_status(p_order, p_status, p_reason)` | admin, operador (**`cancelled` solo admin**) (A7) | Transiciones `pending → in_route → …`; `delivered` solo la pone `confirm_delivery`; `cancelled` exige rol admin + `p_reason` y escribe `cancelled_at`/`cancelled_reason` (CHECK lo exige) |
| `confirm_delivery(p_order, p_items)` | distribuidor (los suyos), operador (tiendas de su alcance) (M6) | **`register_entry` por línea, no exit** (C3): la entrega **suma** stock a la tienda destino (`motive_id` = `reabastecimiento` por defecto); `received_quantity`/`status` por línea (`received` si = quantity, `partial` si 0 < recibido < quantity); `delivered_at` + `status = 'delivered'` en el pedido (lo exige el CHECK); deriva `distributor_id`; cierra alertas `order_late` del pedido — todo atómico; **premium NO exigido** (el flujo de pedido/entrega es feature normal — D39; la entrada interna no re-chequea `is_premium()` en el límite) |
| `get_order_items(p_order)` | auth con el pedido visible | Devuelve las líneas; **omite `unit_price` si `NOT is_premium()`** (D40) — el distribuidor normal sabe QUÉ y CUÁNTO, no el precio (es el análisis del premium) |
| `save_route(...)` / `mark_stop(...)` | admin (crear), distribuidor (paradas propias) | **Nombre único `mark_stop`** (nit: antes `update_stop`/`mark_stop`); valida en servidor que la ruta sea del distribuidor del JWT |
| `update_route_status(p_route, p_status)` | admin; distribuidor solo `completed` de su ruta (A8) | Transiciones `planned → active → completed`/`cancelled` — `route_status` sin esto era decorativo |
| `create_credit(...)` / `cancel_credit(...)` | **solo admin** | Alta/baja con motivo: `cancel_credit` exige `cancelled_at`/`cancelled_reason` y — si `balance < total_amount` — revertir primero los pagos (A5) |
| `register_payment(p_credit, p_amount, p_method)` | admin, operador | Valida `amount <= balance`, inserta pago, recalcula `balance`, pone `paid`+`settled_at` si llega a 0, **cierra alertas `credit_overdue`**, audita |
| `register_payment_reverse(p_payment, p_reason)` | **solo admin** (A5) | Inserta `credit_payments` reverso (`reverso_of_id`), recalcula `credits.balance` (suma el reverso), reabre `status` si estaba `paid` (limpia `settled_at`), cierra/reabre `credit_overdue`, audita — la única corrección de cobros (append-only intacto) |
| `mark_alert_read(p_alert)` | auth | **`SECURITY DEFINER`** (el UPDATE directo está revocado): valida scope **dentro** de la función (admin · `store_id = ANY(my_store_ids())` · `distributor_id = my_distributor_id()`) y pone `read_at` — la RLS no aplica en DEFINER, el chequeo interno es obligatorio (A2) |
| `get_stock(p_store bigint, p_limit int DEFAULT 50)` | auth + scope (M3) | Tool del chatbot: filtra `p_store` contra `my_store_ids()`/`my_distributor_id()` en servidor, `LIMIT` duro, columnas mínimas |
| `get_dashboard(p_from date DEFAULT CURRENT_DATE-30, p_to date DEFAULT CURRENT_DATE)` | auth **+ `is_premium()`** (D39) | Lee `dashboard_daily` filtrando por rol: distribuidor su id; **operador ve el agregado global en MVP** (decisión A3 en §3.13) — egress mínimo. Sin premium no hay dashboard analítico |
| `create_chat(p_title)` / `send_message(p_conversation, p_content)` | auth, dueño (`user_id = auth.uid()`) (M3) | Chat solo por RPC: valida dueño en servidor, inserta, toca `updated_at` de la conversación |
| `touch_updated_at()` | trigger | `BEFORE UPDATE` de todas las mutables |
| `audit_diff()` | trigger | Solo en las tablas del alcance §3.14 (8 tablas) |
| `prevent_price_update()` | trigger (M2) | `BEFORE UPDATE OF price` en `price_publications`: rechaza si la fila está activa — el mecanismo que §2.8 prometía pero no estaba listado |
| `sync_email()` | trigger | `auth.users` → `users.email` (edición posterior) |
| `sanitize_distributor_scope()` | trigger (M11) | `BEFORE INSERT OR UPDATE` en `users`: rol `distribuidor` ⇒ `distributor_id NOT NULL`; otro rol ⇒ `NULL` (red de seguridad además de `update_user_role`) |
| `has_scope()` | auth | `SECURITY DEFINER STABLE SET search_path` → **true** si el usuario tiene alcance: admin · rol `distribuidor` con `distributor_id` · cualquier usuario con ≥1 fila en `user_stores`. Gate de **"todas las acciones"** (D37) |
| `create_store(...)` | auth (cualquier usuario) | **Bootstrap exento del gate**: valida tope de tiendas (1 activa; 3 con `is_premium()`; admin exento — D34), inserta la tienda (`created_by = auth.uid()`) y su fila en `user_stores` — dueño ⇒ alcance sin modelo nuevo (D35). Devuelve el `id` de la tienda |
| `enforce_store_cap()` | trigger | `BEFORE INSERT ON stores`: respaldo del tope D34 — si `auth.uid()` es NULL (seed/migración) o rol admin, deja pasar |

> **D44 — trigger de confirmación de email (resuelto 2026-10-15: DESCARTADO)**:
> NØSEE tiene además `handle_user_email_confirmed()` (`AFTER UPDATE ON auth.users`:
> `email_confirmed_at` NULL → NOT NULL ⇒ `users.is_verified = TRUE`; patrón
> probado en Supabase — trigger sobre `auth` desde SQL). Aprobado para recrear
> (2026-10-15) y luego **reversado**: se **confirma la eliminación de §2.9**
> (`users.is_verified` fuera, 0002: "la verifica Supabase Auth") ⇒ sin la columna
> el trigger fallaría en runtime en la primera confirmación de email.
> **No se materializa**: ni trigger, ni columna, ni cambios de conteo.

**Scope de alcance — regla fija**: ninguna RPC acepta `distributor_id` ni `store_id` como parámetro de alcance. El scope se deriva **siempre** en servidor desde el JWT: `my_distributor_id()` (distribuidor) o `my_store_ids()` (operador). Los parámetros de entrada son solo de **contenido** (qué producto, cuánta cantidad), nunca de **visibilidad** — así un JWT robado o un argumento manipulado no puede leer datos ajenos (RLS + derivación en la misma función). **Gate global (D37)**: toda acción crear/actualizar no-admin exige `has_scope()` — en las tablas con scope (stock, movements, orders, credits…) ya lo garantiza la derivación desde el JWT (scope vacío ⇒ la acción falla); en las tablas **globales** (products, stores) se añade explícitamente a la policy. Excepciones: perfil propio, `create_store()` (bootstrap) y chat.

**Atomicidad del stock (corregido — crítico)**: nunca leer-then-escribir. El UPDATE lleva el guard en el `WHERE` (lock implícito + validación en 1 sentencia):
```sql
-- Salida (register_exit):
UPDATE stock SET quantity = quantity - p_qty, updated_at = now()
WHERE product_id = p_pid AND store_id = p_sid AND quantity >= p_qty
RETURNING quantity;
IF NOT FOUND THEN RAISE EXCEPTION 'stock insuficiente o fila inexistente'; END IF;

-- Entrada (register_entry / confirm_delivery): SIN guard de suficiencia — la entrega suma
UPDATE stock SET quantity = quantity + p_qty, expiry_date = LEAST(...), updated_at = now()
WHERE product_id = p_pid AND store_id = p_sid;
-- confirm_delivery ordena las filas por (product_id, store_id) para adquirir locks en mismo orden (anti-deadlock).
-- Prohibido EXCEPTION WHEN unique_violation como control de flujo → usar ON CONFLICT.
```

**REVOKE/GRANT (A1 — ampliado; antes faltaban 6 tablas)**:
```sql
-- Todas las tablas mutables por RPC/trigger (nunca directo desde el cliente):
REVOKE INSERT, UPDATE, DELETE ON
  stock, movements, order_items, orders, credits, credit_payments,
  price_publications, alerts, routes, route_stops, user_stores,
  dashboard_daily, audit_log, chat_conversations, chat_messages
FROM authenticated;
-- Alta de tiendas solo por create_store() (D35): el INSERT directo queda revocado;
-- UPDATE de stores sí se deja vía RLS (dueño/admin) y DELETE admin soft.
REVOKE INSERT ON stores FROM authenticated;
-- D45: UPDATE de users = SOLO columnas de perfil (policy propia + grant por
-- columna; los privilegiados — role_id, email, distributor_id, premium,
-- is_active — se mutan solo vía RPC/trigger/SQL editor; D47 añade
-- set_user_premium()/set_user_active() para premium/is_active):
REVOKE UPDATE ON public.users FROM authenticated, anon;
GRANT UPDATE (full_name, phone_number, contact_preference) ON public.users TO authenticated;
-- Lecturas selectivas por RLS: en user_stores/order_items/chat_* también se revoca SELECT
-- (solo RPC las leen: my_store_ids, get_order_items, etc.) — el resto lee vía RLS.
-- audit_log NO se revoca: se GRANTEA SELECT con policy `audit_read` (solo admin, D38).
-- dashboard_daily NO se revoca: realtime (§3.13) exige SELECT + policy `dashboard_read`
-- (scope por rol, equivalente al resultado de get_dashboard) — revocarlo silencia los eventos en vivo.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;  -- el chatbot/n8n siempre viaja con JWT de usuario
```
`user_stores` **solo** se escribe con `assign_user_stores(p_user, p_stores)` (solo admin) — sin esto un operador podría auto-insertarse filas y **escalar su propio alcance RLS** (A1). `dashboard_daily` solo se escribe en el upsert interno de `register_*` y se lee con `get_dashboard` — un cliente no puede falsificar cifras.

**Search path (obligatorio)**: toda función `SECURITY DEFINER` se crea con `SET search_path = pg_catalog, public` — sin esto un objeto temporal/`public` malicioso puede redirigir la ejecución (hijack clásico de PostgREST).

---

## 5. Espacio, egress y rendimiento

**Espacio (storage)**
- `bigint` en IDs internos; enums de 4B; BRIN en append-only (KB vs MB de btree).
- `audit_log` con alcance acotado + `diff` JSONB: ~50 MB a 1M movements en vez de ~500 MB.
- `movements`: 6 índices secundarios (3 parciales + BRIN) en vez de 7 → ~55 MB menos y ~7% menos CPU por INSERT (recuento corregido: M4).
- `updated_at` solo donde hay UPDATEs; nada de `hidden_*`/votos de NØSEE (~15 columnas muertas no viajan).
- **Sin partición** (D23): 1M movements ≈ 180 MB no justifican la deuda; `audit_log`/`chat_messages` pueden `ATTACH` luego (sin FKs entrantes).
- `fillfactor`/`autovacuum` en las tablas con UPDATEs frecuentes: `stock` (85 / 0.02 / 0.01), `credits` (90 / 0.05), `alerts` (90) — `stock` recibe 1 UPDATE por movimiento del sistema.

**Egress (lo que Supabase cobra al cliente)**
- Dashboard → `get_dashboard()` sobre `dashboard_daily`: ~50 filas con rango 30d, **nunca** agregación en vivo ni `SELECT *` de movimientos.
- `select=` explícito en PostgREST (sin `search_vector`, sin `description` en listados); `count=planned` o `limit+1` — **nunca `count=exact`** sobre movimientos.
- Chat: listado **sin** `payload`; keyset por `id`; `LIMIT 21`.
- **Tools del chatbot vía RPC con `LIMIT` duro** (`get_stock` retorna ~50 filas de columnas mínimas) — PostgREST llamado por n8n **también es egress facturado**; un tool sin LIMIT metía el catálogo entero en el contexto del LLM por turno.
- Joins del front en **1 request** con embeds de PostgREST (`?select=quantity,product:products(name)&limit=50`) — prohibido el patrón N+1 (50 filas ⇒ 101 requests).
- QR: 0 egress (se genera en cliente).

**Realtime (corregido — crítico)**
- **Podar la publicación**: en proyectos nuevos Supabase publica *todas* las tablas en `supabase_realtime` ⇒ `ALTER PUBLICATION supabase_realtime DROP TABLE audit_log, chat_messages, chat_conversations, credit_payments, movements;` — dejar solo **`alerts`** y **`dashboard_daily`** (páginas pequeñas, exactamente lo que el front escucha).
- `postgres_changes` envía la **fila completa × suscriptor**: el filtro (`filter=store_id.eq.X`) reduce a quién, no cuánto. Por eso el dashboard escucha `dashboard_daily` (fila de ~100 B) y no `movements` (fila completa + refetch de agregado ⇒ cada movimiento pagado 3 veces).
- Si algún día se necesita `movements` en realtime: publicarlo **con columnas limitadas** (`FOR table movements (id, store_id, type, quantity, created_at)`).

**Rendimiento/escala**
- **Índices diferidos por umbral** (D22) — solo se crean cuando la tabla crece:

| Índice | Activar con |
|---|---|
| `GIST (stores.location)` | ~1.000 tiendas |
| `gin (search_vector)`, `gin (name gin_trgm_ops)` + `pg_trgm` | ~50.000 productos |
| `btree (stores.name)`, `btree (users.role_id)`, `btree (lower(full_name))` | solo si `pg_stat_statements` lo muestra |

- RLS con helpers `STABLE` — sin subconsultas correlacionadas por fila.
- Unicidades de negocio vía índice/`ON CONFLICT` (precios, alertas, ruta del día) — la regla la impone la BD aunque el front falle.
- Supabase **Pooler** para front + n8n + MCP; `pg_stat_statements` ya habilitado ⇒ revisar top queries cada sprint.
- **ENUMs**: ver protocolo de migración en §1 (Supabase = 1 transacción por migración).

---

## 6. Registro de decisiones

| # | Decisión | Por qué (y alternativa descartada) |
|---|---|---|
| D1 | `stores.id`: uuid (NØSEE) → **bigint** | Consistencia con todos los FK internos, payloads y QR más cortos. Costo: renombrar tipo en `price_publications.store_id` — gratis con BD vacía |
| D2 | **Enums nativos** con etiquetas en inglés, no `varchar` como NØSEE | 4B vs ~30B por fila, imposible guardar basura, tipos TS generados. Conocido: `ADD VALUE` requiere migración aparte (§1) |
| D3 | `timestamptz` en todo | NØSEE mezcla `timestamp without time zone` ⇒ ambigüedad de zona |
| D4 | Actores = `created_by`, dueños = `user_id` | Un patrón único de auditoría; el .md usaba `user_id` para "quién registró", que confunde con el dueño |
| D5 | `product_categories.parent_id` **nullable** | Reconcilia el .md (jerárquico) con NØSEE (plano): `NULL` = plana, funciona con datos semilla |
| D6 | Sin `sku`; se conserva `barcode` de NØSEE | El QR asocia **tienda↔distribuidor** (cliente, D42); `barcode` ya trae índice único funcional probado |
| D7 | `premium` vive **solo en `users`**; `is_premium()` = `premium OR rol admin` | El .md tenía premium en tabla **y** en `app_metadata` ⇒ dos fuentes que divergen; la fórmula resuelve además "admin siempre premium" sin constraint |
| D8 | Tabla **`users`**, no `profiles` | Continuidad con NØSEE; confusión con `auth.users` se mitiga con comentario en DDL |
| D9 | `orders`/`order_items`: nombre NØSEE, contenido FAROX | Reutiliza el vocabulario conocido; se elimina 100% el flujo delivery/dealer |
| D10 | `audit_log` sin FKs + `diff` JSONB | Un log que impide borrar usuarios es peor que no tener log; difs = espacio acotado vs snapshots |
| D11 | Alertas materializadas; sin índice parcial en `stock` | Condición volátil por `threshold`; la señal vive en `alerts` |
| D12 | `location geography(Point,4326)` + GIST **diferido** | Decidido por el usuario; el índice se crea al superar ~1.000 tiendas (D22) |
| D13 | `quantity numeric(12,3)` en **todas** las tablas (incluye `order_items`) | `unit_types` incluye kg ⇒ enteros no alcanzaban — un pedido de 2,5 kg era inexpressible |
| D14 | FKs de catálogo `RESTRICT` (NØSEE usa `CASCADE` en brand) | Borrar una marca no debe borrar productos con historial; el borrado real es soft-delete |
| D15 | `credits.order_id` **UNIQUE parcial** (`WHERE status <> 'cancelled'`) | 1 fiado vigente por pedido **sin bloquear** re-crédito tras anular (el unique incondicional original lo impedía) |
| D16 | `user_stores` como tabla de alcance | El rol operador necesita "su alcance" materializado; `users.store_id` no soporta multi-tienda |
| D17 | `price_publications` unique parcial activo + `set_price()` | Regla imposible de violar en BD; el cambio de precio = insert+desactivar preserva el histórico |
| D18 | BRIN en append-only | Orden temporal intrínseco ⇒ compresión de rangos; btree ×1000 más grande |
| D19 | Semilla **mínima + `motives`** + prerrequisito de admin | `motives` faltaba (rompía INV-04); ningún seed con `created_by` corre sin un admin signup previo |
| D20 | **`dashboard_daily` como tabla con upsert**, no vista | La vista re-agregaba todo el historial en cada poll (~150 MB lógicos a 1M), crecía sin límite y **evadía RLS** (ejecuta como owner). El upsert es O(1) por movimiento y la RPC filtra por rol |
| D21 | Alcance del audit acotado (8 tablas); **sin** audit de `movements` ni chat | `movements` ya es el asiento forense; auditar su INSERT = duplicar el ledger (~500 MB); 1 fila por mensaje de chat era el mayor volumen de la BD |
| D22 | **Índices diferidos por umbral** (GIST, GIN, catálogos) | Con 25 tiendas/209 productos/27 usuarios el planner ignora esos índices pero **se paga su escritura** en cada INSERT; activar cuando `pg_stat_statements` lo justifique |
| D23 | `movements` **no se particiona** | ~180 MB a 1M no es un problema de disco; particionar rompería la FK `reverso_of_id` (PK de partición no única global) — BRIN + retención por DELETE bastan |
| D24 | Alertas por **episodio** (`resolved_at`), no por lectura (`is_read`) | El dedup por `is_read` re-alertaba en cada movimiento tras marcar leída (spam de UI+realtime+egress) |
| D25 | `movements.distributor_id` se **deriva** del `order_id` en la función | Atribuir manualmente permitía mezclar distribuidor A con pedido B y corromper el agregado del INT-01 sin que nada lo notara |
| D26 | **Single-tenant** con `stores.country='CO'` y `currency='COP'` por defecto | Backfill de `country`/`currency` sobre tablas altas a 10× es ambiguo ("¿esta fila es de Colombia?"); defaults explícitos cuestan 0 hoy. Multiempresa ⇒ columna `tenant_id` en futuro (no en MVP) |
| D27 | Precios: `price > 0` + cambio solo vía `set_price()` | `>= 0` admitía capturas erróneas; `UPDATE` directo destruía el histórico que el índice `(product_id, created_at DESC)` prometía |
| D28 | `threshold` **NULL** = sin punto de pedido; evaluación solo en transiciones | `DEFAULT 0` disparaba `stock_low` masivo al mapear productos (0 ≤ 0 en toda fila nueva) |
| D29 | **1 usuario ↔ 1 distribuidor** (`users.distributor_id`) | Suficiente para RLS del MVP; si un repartidor sirve a 2 distribuidores, se promueve a tabla puente `user_distributors` (migración aditiva). Trigger limpia el scope al cambiar de rol |
| D30 | `stock.expiry_date` (aproximación) en vez de FEFO | Sin lotes no se sabe qué lote salió; la caducidad "vigente del par" + job diario dan la alerta `expiry_soon` sin el coste de lotes. Limitación documentada: al agotarse el stock, caducidad → NULL |
| D31 | Reversos: `UNIQUE (reverso_of_id)` + validación en `register_reverse()` | Sin esto: doble reverso (doble corrección de stock) y reverso-de-reverso (cadena infinita) eran imposibles de detectar |
| D32 | `dashboard_daily`: SELECT con policy `dashboard_read` (no REVOKE) + **realtime elegido sobre polling** por modelo de costo | Realtime exige SELECT+RLS para emitir: un REVOKE silenciaba los eventos en vivo (contradicción §3.13/§4). Costo: realtime = O(cambios) (~150 B × evento real); polling = O(tiempo) (~6 KB/min incondicional ⇒ ~90 MB/mes/usuario con 50 filas). Crossover ~40 mov/min por suscriptor vs proyección ~1M movements/año ≈ 0.7/min ⇒ realtime ~13× más barato, además sin re-renders ni queries en reposo (D20 ya rechazó el agregado en poll por la misma razón) |
| D33 | Dueño de tienda = `stores.created_by` (sin columna `owner_id` en MVP) | En el flujo self-serve creador y dueño coinciden; separar actor/dueño solo aporta cuando difieren — si algún día existe "admin crea tienda para un usuario", añadir `owner_id` (migración aditiva) |
| D34 | Topo de tiendas por usuario: **1 activa; 3 si `is_premium()`** (admin exento) | Regla del dueño del producto; contando solo `is_active`. Da al flag premium un gate concreto de negocio además de las features UX. Enforced en `create_store()` + respaldo `enforce_store_cap()` |
| D35 | `create_store()` RPC + **auto-asociación en `user_stores`** | El dueño obtiene alcance con el mecanismo RLS ya existente (una sola fuente de verdad: `user_stores`) en vez de un segundo modelo de visibilidad. `stores` INSERT revocado ⇒ sin suplantación de `created_by` |
| D36 | `products.created_by` + edición **solo del creador** (admin = override) | Catálogo de uso general: sin esto cualquier operador con scope editaba productos compartidos. Migrados de NØSEE ⇒ backfill al admin del seed |
| D37 | **Gate `has_scope()` en TODAS las acciones crear/actualizar no-admin** (versión estricta, decisión del dueño) | Coste aceptado y registrado: policies más pesadas (1 STABLE extra por fila en globals). Mitiga además el riesgo del rol por defecto de `handle_new_user()`: un signup sin tienda no puede escribir en ningún lado (solo perfil/chat/su primera tienda). Excepciones: perfil, `create_store()`, chat |
| D38 | `audit_log`: GRANT SELECT + policy `audit_read` (solo admin) en vez de REVOKE | El bloque §4 revocaba SELECT "solo RPC las leen" pero **no existía `get_audit()`**: el admin no podía leer su propia auditoría (la matriz §8 lo prometía). Policy admin-only = misma garantía de acceso y grants/§8 coherentes, sin RPC nueva |
| D39 | **Premium = registrar movimientos manuales + dashboard analítico** (M7 resuelto) | `register_entry`/`register_exit` y `get_dashboard`/`dashboard_read` exigen `is_premium()`. **Flujo de pedido NO** (`create_order`/`confirm_delivery`): "poder pedir" es feature normal — si `confirm_delivery` exigiera premium, el pedido normal nunca podría recibirse; su entrada interna no re-chequea en el límite. Modelo freemium: gratis = catálogo + stock + pedidos; premium = inventario real + analítica de gastos/ingresos |
| D40 | `order_items.unit_price` **solo premium**: SELECT revocado + RPC `get_order_items()` | RLS no sabe filtrar columnas ⇒ solo RPC puede omitirla. El distribuidor normal sabe QUÉ y CUÁNTO, no el precio — el precio congelado es el análisis del premium y reduce payload/egress de los usuarios gratuitos |
| D41 | **Precio privado por tienda**: SELECT de `price_publications` = admin (todas) · operador (solo sus tiendas) · distribuidor (ninguno) | El precio lo coloca la tienda y ninguna otra tienda lo ve (ventaja competitiva); el distribuidor recibe el `unit_price` congelado del pedido, no el listado vivo |
| D42 | QR = asociación **tienda↔distribuidor** (corrige D6) | El dueño aclaró el propósito: el distribuidor escanea para vincularse a la tienda — no codifica producto↔tienda. `barcode` sigue sin necesitar SKU |
| D43 | `create_order`: **admin · operador con tienda en scope** (sin premium) | "Poder pedir" es feature normal del usuario con tienda (D39): el operador pide a su distribuidor. El §4 anterior decía "solo admin" — contradecía el modelo del .md (usuario normal = catálogo + stock + pedir); alineado en §4 |
| D44 | Trigger `handle_user_email_confirmed()` de NØSEE: `auth.users.email_confirmed_at` NULL→NOT NULL ⇒ `users.is_verified = TRUE` — **aprobada 2026-10-15, luego reversada: confirma eliminación §2.9 (la verifica Supabase Auth); no se materializa** | El §4 del doc era silencioso y NØSEE lo tenía (patrón probado sobre `auth.users`), pero `users.is_verified` se **eliminó en §2.9/§2** ⇒ recrear el trigger sin la columna rompería la confirmación de email en runtime. Sin trigger, ni columna, ni cambios de conteo |
| D45 | **Perfil propio editable** (cierra la excepción D37 de "perfil"): policy `users_update_own` (`USING/WITH CHECK (id = auth.uid())`) + `GRANT UPDATE (full_name, phone_number, contact_preference)`; UPDATE de tabla completa revocado a `authenticated`/`anon` | La matriz §8 decía UPDATE = solo admin y no había RPC de perfil: un usuario no podía editar ni su propio nombre/teléfono. Grants ≠ RLS: la policy decide QUÉ filas, el grant QUÉ columnas. Consecuencia aceptada: el admin también comparte el grant (rol PG `authenticated`); los privilegiados (`role_id`, `email`, `distributor_id`, `premium`, `is_active`) se mutan solo vía RPC/trigger/SQL editor — el gap de `premium`/`is_active` ("sin RPC, solo SQL editor") **queda cerrado por D47** |
| D46 | `REVOKE EXECUTE` de `job_scan_*` (las 3 funciones de pg_cron) para `authenticated`/`anon` | Endurecimiento más allá del doc-literal: pg_cron corre como postgres (owner) y conserva EXECUTE; un cliente autenticado no debe disparar los scans a demanda |
| D47 | RPCs `set_user_premium(p_user_id, p_value)` y `set_user_active(p_user_id, p_value)` — **cierran el gap de columnas privilegiadas D45** | `premium`/`is_active` sin ruta vía PostgREST (UPDATE de tabla completa revocado a todos los roles ⇒ solo SQL editor). Mismo patrón que `update_user_role`: `SECURITY DEFINER` + `SET search_path`, guard solo-admin, SET de su columna + `updated_at`, audit vía trigger `audit_diff` sobre `users`, `GRANT EXECUTE` blanket de 0006 |

---

## 7. Migración Sprint 1 (orden de ejecución)

```sql
-- 1. Extensiones (FAROX solo tiene pg_stat_statements/pgcrypto/uuid-ossp)
CREATE EXTENSION IF NOT EXISTS postgis;   -- stores.location
CREATE EXTENSION IF NOT EXISTS pg_cron;   -- jobs diarios de alertas (expiry_soon/order_late/credit_overdue)
-- NO pg_trgm todavía (D22) — se añade al activar los GIN de búsqueda

-- 2. Enums (§1) — los tipos nuevos en migración aparte de su primer uso (§1)

-- 3. Clonar DDL de NØSEE (subconjunto §2) vía pg_dump --schema-only o a mano

-- 4. Aplicar alteraciones de este documento (tips, FKs, columnas, drops, checks)

-- 5. Funciones + triggers (§4) — INCLUYE handle_new_user(), sanitize_distributor_scope(), has_scope(), create_store() y enforce_store_cap()
--    ANTES de cualquier signup (sin el trigger, el primer login no crea fila users y RLS/permisos caen)

-- 6. Seeds en orden (D19):
--    a) roles (admin, operador, distribuidor)
--    b) unit_types, store_types
--    c) product_categories (padres ANTES que hijos por parent_id)
--    d) brands
--    e) motives: venta(exit), reabastecimiento(entry), devolución(entry), merma(exit), ajuste(NULL)

-- 7. PRERREQUISITO: signup del primer usuario admin (handle_new_user lo crea como operador)
--    → update_user_role(p_admin, 'admin', NULL) para promoverlo.
--    (Seeds con created_by NOT NULL — tiendas, órdenes, precios — solo corren DESPUÉS de este paso)

-- 8. RLS (§8): ENABLE ROW LEVEL SECURITY en todas las tablas + policies de la matriz

-- 9. Podar publicación realtime (§5):
--    ALTER PUBLICATION supabase_realtime DROP TABLE audit_log, chat_messages,
--      chat_conversations, credit_payments, movements;

-- 10. Jobs pg_cron (diario; hora fija p.ej. 06:00 America/Bogota):
--    expiry_soon   → INSERT si stock.expiry_date <= CURRENT_DATE + 15 AND quantity > 0
--                     + UPDATE resolved_at si ya NO se cumple (cierra episodios, A6)
--    order_late    → INSERT si orders.expected_at < now() AND delivered_at IS NULL AND status NOT IN ('delivered','cancelled')
--                     (también se cierra en confirm_delivery/update_order_status)
--    credit_overdue→ INSERT si credits.due_date < CURRENT_DATE AND balance > 0
--                     (también se cierra en register_payment/register_payment_reverse/cancel_credit)
--    (INSERTs con ON CONFLICT sobre el target EXACTO de uq_alert_open; ver §3.9)

-- 11. Verificaciones
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE NOT convalidated LOOP
    RAISE WARNING 'FK inválida: %', r.conname;
  END LOOP;
END $$;
-- + probar: signup (¿fila users creada con operador?) → update_user_role → assign_user_stores
--   → assign → entry → exit (concurrente) → reverse → set_price → payment → payment_reverse
--   → create_order → confirm_delivery (STOCK SUMA, no resta) → routes → mark_stop → alertas (alta y cierre)
```

**Preparación de datos (cuando se carguen productos/tiendas/precios)**
- Backfill de `created_by` (products/stores migrados) con el admin del seed y `NOT NULL` en la misma transacción de carga (§2.6/§2.7).
- Verificar duplicados de `barcode` normalizado antes del unique.
- Verificar unicidad de `unit_types.abbreviation` y `distributors.nit` en los datos de origen (si pasa, crear los uniques).
- Verificar que no existan **2 precios activos** para el mismo (store, product) de NØSEE antes de crear `uq_price_store_product_active` (limpiar dejando el más reciente).
- Verificar que NØSEE no tenga `price = 0` (el nuevo CHECK `> 0` los rechazaría).
- Migrar `created_at` de NØSEE con `USING created_at AT TIME ZONE 'UTC'` (verificar cómo se insertaron antes).

---

## 8. RLS (referencia) — especificación completa de políticas

> **Corregido (C1)**: antes este apartado remitía al `.md` principal, donde solo existía la **matriz** y un ejemplo inválido. Las policies reales viven **aquí**; el SQL se escribe en el Sprint 1 (§7 paso 7). Con `ENABLE ROW LEVEL SECURITY` sin policies = deny-all ⇒ el demo del Sprint 1 quedaría bloqueado si no se copia este apartado.

**Dependencias de scope**:

| Rol | Se filtra por | Soporte en esquema |
|---|---|---|
| distribuidor | `distributor_id = my_distributor_id()` | `users.distributor_id` (§2.9) |
| operador | `store_id ∈ my_store_ids()` | `user_stores` (§3.10) |
| premium | `is_premium()` (incluye admin) | `users.premium` (§2.9) |
| admin | sin filtro + `created_by` trazable | `created_by` en orders/movements/credits |

**Matriz de policies por tabla × operación** (solo `TO authenticated`; `anon` no tiene ninguna). Donde dice **RPC**, la lectura/escritura directa está revocada (§4) y la policy no aplica:

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `roles`, `unit_types`, `store_types`, `motives`, `brands`, `product_categories` | `true` | admin | admin | admin (soft-delete: solo `is_active`) |
| `products` | `true` | admin · operador (`has_scope()`) | admin · **creador** (`created_by = mine`, con `has_scope()`) | admin (solo `is_active = false`) |
| `stores` | `true` | — RPC `create_store` | admin · dueño (`created_by = mine`) | admin (solo `is_active = false`) |
| `distributors` | admin, operador | admin | admin | admin (solo `is_active = false`) |
| `price_publications` | admin (todas) · operador (**solo `store_id = ANY(my_store_ids())`** — precio privado por tienda, D41; distribuidor: **ninguno**) | — RPC `set_price` | — RPC `set_price` | admin (soft) |
| `users` | fila propia, o admin | — RPC `update_user_role` / trigger | **admin** (rol/premium/actividad) · **fila propia** — solo columnas de perfil vía `GRANT` (D45: `full_name`, `phone_number`, `contact_preference`; el resto solo RPC/SQL editor) | — (baja = `is_active`) |
| `orders` | admin · operador (`store_id ∈ my_store_ids()`) · distribuidor (`distributor_id = mine`) | — RPC `create_order` | — RPC `update_order_status`/`confirm_delivery` | — |
| `order_items` | — RPC `get_order_items` (SELECT revocado; `unit_price` solo premium — D40) | — RPC | — RPC | — |
| `stock` | admin · operador (`store_id ∈ mine`) · distribuidor (tiendas de sus pedidos/ruta) | — RPC | — RPC | — |
| `movements` | admin · operador (`store_id ∈ mine`) · distribuidor (solo `distributor_id = mine`) | — RPC | — (append-only) | — |
| `routes`/`route_stops` | admin · operador · distribuidor (`distributor_id = mine`) | — RPC | — RPC | — |
| `credits`/`credit_payments` | admin, operador (cobros) | — RPC | — RPC | — |
| `alerts` | admin (todas) · operador (`store_id ∈ mine`) · distribuidor (**solo `distributor_id = mine`** — nunca NULL, A4) | — jobs/trigger | — RPC `mark_alert_read` | — |
| `user_stores` | fila propia, admin | — RPC admin | — | — RPC admin |
| `chat_conversations`/`chat_messages` | `user_id = auth.uid()` / conversación propia | — RPC `create_chat`/`send_message` | — (trigger solo) | — |
| `audit_log` | admin (policy `audit_read`) | — trigger | — (append-only) | — |
| `dashboard_daily` | policy `dashboard_read` (admin · operador global A3 · distribuidor `distributor_id = mine`) + RPC `get_dashboard` | — upsert interno RPC | — | — |

**Reglas de composición**:
- Policies **por operación** (`SELECT`/`INSERT`/`UPDATE`/`DELETE` separados). **Prohibido `FOR ALL`** en tablas sensibles: el ejemplo `crud_products FOR ALL USING (is_premium())` del `.md` principal incluiría DELETE y violaría la matriz.
- "Eliminar" de la matriz = **soft-delete** (`is_active = false`) — las FK `RESTRICT` bloquean hard delete con historial.
- `is_premium()` como gate **solo** donde la matriz lo diga explícitamente (QR masivo, features premium) — nunca como único filtro de una policy de escritura general.
- Alcance del operador **solo** se modifica con `assign_user_stores()` (solo admin); nadie más escribe `user_stores`.
- **Gate de alcance (D37 — estricto)**: toda INSERT/UPDATE no-admin exige `has_scope()`. En tablas con scope ya lo garantiza la derivación de RPC/RLS; en **globales** (products, stores) se suma a la policy. **Excepciones**: perfil propio, `create_store()` (bootstrap) y chat (`create_chat`/`send_message`) — el canal de onboarding no se bloquea. Si se quiere endurecer después, quitar chat de las excepciones es un renglón.
- **Perfil propio (D45 — materializa la excepción "perfil" de D37)**: UPDATE de `users` = policy `users_update_own` (`USING/WITH CHECK (id = auth.uid())`) **+** `GRANT UPDATE (full_name, phone_number, contact_preference)` con el UPDATE de tabla completa revocado. Son dos mecanismos independientes (**grants ≠ RLS**): la policy decide QUÉ **filas**, el grant QUÉ **columnas**. `role_id`, `email` y `distributor_id` siguen sin RPC de mutación (solo trigger/SQL editor); `premium`/`is_active` se mutan con `set_user_premium`/`set_user_active` (D47 — cierra el gap registrado en D45).
- Todas las tablas con `ENABLE ROW LEVEL SECURITY` desde el Sprint 1 (default deny).
- **Desviación MVP registrada (A3)**: `get_dashboard` da al operador el agregado **global** (no por tienda) mientras `dashboard_daily` sea por `(day, distributor_id)` — ver §3.13.

---

## 9. Pendientes

- [ ] Checklist del .md **p.6** "Crear la base de datos" → ejecutar §7.
- [ ] Checklist **p.15** → este documento es la especificación base; cambios futuros se anotan aquí primero.
- [x] Premium alineado en el `.md` principal (tabla `users`, no `app_metadata`; `is_premium()` única y con `SET search_path`).
- [x] **.md principal alineado** (pasada completa: vocabulario, precios privados por tienda, alertas materializadas, audit Sprint 1, dashboard tabla+realtime, SEC-01 → S2, M7/M8, QR tienda↔distribuidor, campos nuevos expected_at/due_date/currency).
- [ ] **Umbrales de índices diferidos (D22)**: crear `GIST(location)` al llegar a ~1.000 tiendas; `pg_trgm`+GIN al llegar a ~50.000 productos — revisar con `pg_stat_statements` en cada sprint.
- [ ] Validar `unit_types.abbreviation` único en seed (§7).
- [ ] Revisar con `pg_stat_statements` el costo de `has_scope()` en policies de products/stores (D37) — si aparece en el top, materializar el flag en columna.
- [ ] Lectura de chat_* (mitad pendiente del ALTO-3): elegir entre RPC de listado (keyset §3.12) o GRANT SELECT + policy de dueño (`user_id = auth.uid()`) — hoy §4 revoca SELECT y no hay RPC ⇒ historial ilegible (contradice §8).
- [ ] Confirmar nombre de proyecto (checklist p.4) → afecta `project_ref` en el MCP.
- [x] **M7 resuelto (D39/D40)**: CRUD premium = registrar movimientos manuales + dashboard analítico + QR masivo + `unit_price`; normal = catálogo + stock + pedidos.
- [x] **M8 resuelto**: se elimina la frase del .md — los triggers DML no auditan SELECT; la trazabilidad de tools del chatbot la lleva **n8n** (un registro por invocación en el flujo de trabajo).
- [ ] Decisión pendiente (A4/§3.9): si el distribuidor debe ver `stock_low`/`expiry_soon`, requerirá relación tienda↔distribuidor (hoy no existe); MVP: no las ve.
- [ ] Decisión pendiente (A3/§3.13): si el operador requiere dashboard "por su alcance", añadir `store_id` a `dashboard_daily` (MVP: agregado global).

### Inconsistencias detectadas entre este doc y `idea basica proy admin de proys.md`
*(agente revisor; corregir al alinear el .md — son nombres/semántica, este doc manda)*

1. `.md` tiene `products.sku` → aquí no existe `sku` (D6: se usa `barcode`).
2. `.md` describe `unit_types` con `code` → aquí es `name`+`abbreviation`+`category`.
3. `.md` dice `stores.lat, lng` → aquí `location geography(Point,4326)` + vista `stores_geo`.
4. `.md` enum alertas en español y de 3 valores (`stock_bajo`, `caducidad_proxima`, `pedido_retrasado`) → aquí 4 en inglés, **+`credit_overdue`** (§1).
5. `.md` contradice su modelo: dice "la alerta se calcula, no se almacena" y "se llena por trigger" → aquí están **materializadas** en `alerts` (D11).
6. `.md` INV-06 usa `Stock < Umbral` → la regla de este doc es `<=` (§3.1). *(línea del .md corregida a ≤ en este pase)*
7. `.md` `audit_log` con `antes`/`después` JSONB y `registro_id` → aquí `diff` (solo cambios), `row_id text`.
8. `.md` afirma "cada consulta [del chatbot] queda en audit_log" → imposible con triggers DML (ver pendiente M8).
9. `.md` `credits`: `monto_total`, `saldo_pendiente` → aquí `total_amount`, `balance`.
10. `.md` `credit_payments`: `user_id`, `fecha`, `forma_pago` → aquí `created_by`, `paid_at`, `payment_method`.
11. `.md` `order_items`: `cantidad_solicitada`, `cantidad_recibida` → aquí `quantity`, `received_quantity` (+`unit_price`, `status`).
12. `.md` `price_publication`: `published_at`, `active` → aquí `created_at`, `is_active` (+`currency`).
13. `.md` `users`: `nombre` → aquí `full_name`.
14. `.md` ejemplo `registrar_entrada(...)` → nombre real `register_entry(...)` (§4).
15. `.md` dice "audit_log activo desde Sprint 2" → este doc lo crea en Sprint 1 (§7 paso 5/8).
16. `.md` llama "vista" al Dashboard (INT-01) → aquí es la **tabla** `dashboard_daily` (D20).
17. `.md` cronograma: SEC-01 en Sprint 3 vs backlog que lo marca S2 (contradicción interna del .md).
18. `.md` modelo: `price_publication.user_id` vs convención D4 (`created_by`) — ya corregido en §2.8 de este doc; falta renombrar en el .md.
