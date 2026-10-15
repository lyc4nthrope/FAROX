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
| `base_quantity` | numeric(12,3) NOT NULL CHECK (> 0) | NØSEE + CHECK |
| `barcode` | text NULL | NØSEE — **no existe `sku`**: se reutiliza `barcode` (D6). El QR de producto↔tienda se genera en cliente y no necesita SKU |
| `is_active` | boolean NOT NULL DEFAULT true | NØSEE |
| `search_vector` | tsvector GENERATED STORED | mod — **`to_tsvector('spanish', coalesce(name,'') || ' ' || coalesce(description,''))`**: la versión `name ∥ description` **devolvía NULL** para todo producto sin descripción (casi todos los de NØSEE) — bug corregido |
| `created_at` / `updated_at` | timestamptz | mod — `updated_at` añadido |

**Elimina de NØSEE**: `is_admin_hidden` + 5 columnas `hidden_*` (moderación).

**Índices**
- `products_pkey`
- `uq_products_barcode` — **copiar el funcional de NØSEE** (normaliza y permite repetir espacios/puntuación):
  `CREATE UNIQUE INDEX ... ON products (lower(regexp_replace(barcode,'[^a-zA-Z0-9]','','g'))) WHERE barcode IS NOT NULL AND length(trim(barcode)) > 0;`
- **Diferidos** (§5): `gin(search_vector)` y `gin(name gin_trgm_ops)` — con 209 productos un seq scan `ILIKE` gana; 2 GIN = escritura gratis perdida. Umbral de activación: ~50.000 productos. **`pg_trgm` NO se instala en el Sprint 1.**
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
| `created_by` | uuid FK → `users` RESTRICT | NØSEE (patrón de actor) |
| `is_active` | boolean NOT NULL DEFAULT true | NØSEE |
| `created_at` / `updated_at` | timestamptz | mod — `updated_at` añadido |

**Elimina de NØSEE**: `is_admin_hidden` + 5 `hidden_*`, `evidence_count` (comunidad).

**Índices**: PK · **`GIST (location)` DIFERIDO** — con 25 tiendas el planner elige seq scan siempre; el GiST es la estructura de índice más cara de escribir. Umbral de activación: **~1.000 tiendas** (D22). NØSEE tiene **dos** GIST duplicados sobre `location` — no copiar ninguno todavía. `btree (name)` también diferido (25 filas).

**Acceso lat/lng en API**: los clientes solo necesitan coordenadas para el mapa ⇒ exponer la vista `stores_geo` (§4) en vez de calcular en el front (ST_X/ST_Y se evalúan en servidor).

### 2.8 `price_publications`

| Atributo | Tipo | Origen |
|---|---|---|
| `id` | bigint identity PK | NØSEE |
| `product_id` | bigint NOT NULL FK RESTRICT | NØSEE |
| `store_id` | bigint NOT NULL FK RESTRICT | mod — era `uuid`; tipo sigue a `stores.id` (D1). RESTRICT en vez del `CASCADE` de NØSEE: con soft-delete no debe perderse historial de precios (D14) |
| `user_id` | uuid NOT NULL FK → `users` RESTRICT | NØSEE — quién publicó |
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
| `distributor_id` | bigint NULL FK → `distributors` ON DELETE SET NULL | FAROX — **sin esto el rol distribuidor no existe**: RLS "solo los suyos" necesita `mi_id`. **1 usuario ↔ 1 distribuidor** (D29); un trigger **limpia esta columna** al cambiar `role_id` a un rol que no sea `distribuidor` (evita scope RLS huérfano) |
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
| `created_at` / `updated_at` | timestamptz | NØSEE |

**CHECKs de consistencia**: `CHECK (status <> 'delivered' OR delivered_at IS NOT NULL)` y `CHECK (delivered_at IS NULL OR status = 'delivered')` — un pedido no puede estar "entregado sin fecha" ni "con fecha sin entregarse".

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

**Consulta DIST-02** ("asignado a distribuidor, no movilizado") — sin tabla extra: `order_items JOIN orders WHERE distributor_id = X AND status IN ('pending') AND NOT EXISTS (movements WHERE order_id = orders.id)`. Una sola fuente de verdad del "recibido": `order_items.status/received_quantity` (escritura); `movements` con `order_id` es el **efecto en stock** de esa misma operación atómica (§4 `confirm_delivery`), no una segunda opinión divergente.

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
- **Índices (reducidos de 7 a 5)**:
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
- Índices: PK · UNIQUE parcial del pedido · `btree (store_id)` · `btree (status) WHERE status <> 'paid'` (cartera abierta).
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
| `distributor_id` | bigint NULL FK RESTRICT | **Añadido** — el distribuidor solo ve "sus" alertas sin join (crítica B7) |
| `message` | text NOT NULL | **Añadido** — texto listo para UI ("Coca-Cola en Tienda Norte: 3 < umbral 10"); la UI no debe reconstruir datos que ya cambiaron |
| `context` | jsonb | **Añadido** — snapshot al disparar: `{quantity, threshold, dias_restantes, monto}` |
| `read_at` | timestamptz NULL | Reemplaza a `is_read` (un solo campo, se consulta `read_at IS NULL`) |
| `resolved_at` | timestamptz NULL | **Añadido** — fin del episodio (condición normalizada) |
| `created_at` | timestamptz | |

- **Regla de cálculo explícita** (antes era vaga):
  - `stock_low`: en `assign_product_to_store`/`register_*` si `quantity = 0 OR (threshold IS NOT NULL AND quantity <= threshold)`; se **resuelve** (`resolved_at = now()`) cuando `quantity > threshold` (o `> 0` si no hay umbral).
  - `expiry_soon`: job diario (§7) sobre `stock.expiry_date <= CURRENT_DATE + 15` (horizonte = constante del job) AND `quantity > 0`.
  - `order_late`: job diario sobre `orders.expected_at < now() AND delivered_at IS NULL AND status NOT IN ('delivered','cancelled')`.
  - `credit_overdue`: job diario sobre `credits.due_date < CURRENT_DATE AND balance > 0`.
- **Anti-duplicados por episodio** (corregido): `UNIQUE (type, coalesce(store_id,0), coalesce(product_id,0), coalesce(order_id,0)) WHERE resolved_at IS NULL` — con el dedup viejo (`WHERE NOT is_read`), marcar como leída y seguir por debajo del umbral re-alertaba **en cada movimiento** (spam + realtime + egress). Ahora: 1 alerta abierta por episodio; se re-abre solo cuando la condición se normaliza y vuelve a cruzarse.
- Todo INSERT de alertas usa **`ON CONFLICT ... DO NOTHING` con el target completo** (expresiones COALESCE incluidas) — nunca `EXCEPTION` (subtransacción en el camino caliente) ni SELECT previo (carrera).
- **Índices**: PK · el único parcial cubre "alertas sin resolver" (el listado principal) · `btree (distributor_id)`.

### 3.10 `user_stores` — alcance del operador

| Atributo | Tipo | Notas |
|---|---|---|
| `user_id` | uuid FK → `users` CASCADE | PK compuesta |
| `store_id` | bigint FK → `stores` CASCADE | PK compuesta |
| `created_at` | timestamptz | |

Sin esto, "Dashboard: operador ✔ su alcance" y el RLS por tienda no tienen sobre qué filtrar. PK `(user_id, store_id)` indexa ambas direcciones.

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
- **`INSERT … ON CONFLICT DO UPDATE`** dentro de `register_entry/register_exit` — 1 upsert barato por movimiento en vez de **re-agregar todo el historial en cada poll** (crítica A2: la vista original leía ~150 MB lógicos por refresco a 1M movements y crecía sin límite de filas).
- Lectura vía **`get_dashboard(p_from, p_to)`** (§4): RPC `SECURITY DEFINER` con rango por defecto **30 días** y filtro por rol — además resolvía que la vista **evadía RLS** (ejecutaba como owner y el distribuidor veía el agregado de todos).
- Realtime: la tabla se publica (§5) — el front recibe la fila `(day, distributor_id)` actualizada, payload minúsculo.

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

**Alcance CORREGIDO** (crítica A1 — el alcance original duplicaba el ledger): trigger `audit_diff()` **solo en** `users` (rol/premium/baja), `price_publications` (cambios de precio), `orders` (cambios de `status`), `credits`, `credit_payments`, `distributors`.
**NO** en `movements` (el movimiento **ya es** el asiento forense — auditar su INSERT duplicaba la fuente de verdad) ni en `chat_*` (1 fila por mensaje = el volumen más alto de la BD).
Estimado corregido: ~50 MB en vez de ~500 MB a 1M movements.

**Índices**: PK · `btree (table_name, row_id)` · **`BRIN (created_at)`**. **Eliminado** `btree (created_by)` — 27 valores distintos, selectividad basura, ~50 MB perdidos; para "qué hizo el usuario X" existe el BRIN por fecha + `table_name` (crítica A1).

---

## 4. Funciones RPC (el conjunto completo que hace implementable la matriz SEC-01)

> Corregido: el plan anterior solo definía `register_entry/exit` — con los REVOKE, **ni admin ni operador podían hacer nada** de la matriz de roles (crítica B5). Todas las mutaciones pasan por aquí.

| Función | Rol permitido | Qué hace |
|---|---|---|
| `my_role()` | auth | `SECURITY DEFINER STABLE` → nombre del rol del JWT (helper de todas las validaciones) |
| `is_premium()` | auth | `SECURITY DEFINER STABLE` → **`premium OR my_role() = 'admin'`** (satisface "admin siempre premium" sin constraint) (D7) |
| `my_store_ids()` | auth | ids de `user_stores` del usuario (RLS del operador evaluado 1 vez) |
| `my_distributor_id()` | auth | `users.distributor_id` del usuario |
| `assign_product_to_store(p_product, p_store, p_threshold)` | admin, operador | INV-03: crea/actualiza `stock`, evalúa `stock_low` |
| `register_entry(...)` | admin, operador | Valida, **actualiza stock atómicamente**, inserta `movements` (+`unit_price`), evalúa alertas, upsert `dashboard_daily`, audita — 1 transacción |
| `register_exit(...)` | admin, operador | Igual, con validación de stock suficiente |
| `register_reverse(p_movement_id, p_reason)` | **solo admin** | Inserta movimiento inverso con `reverso_of_id` (1 por original, tipo opuesto, mismo producto/tienda), reevalúa alertas y dashboard |
| `set_price(p_product, p_store, p_price, p_currency)` | **solo admin** | Inserta fila nueva + desactiva la anterior (única mutación de precios permitida) |
| `create_order(...)` | admin | Crea `orders` + `order_items` (`unit_price` congelado) |
| `update_order_status(p_order, p_status)` | admin, operador | Transiciones pendiente→en_ruta→…; cancelación con motivo |
| `confirm_delivery(p_order, p_items)` | distribuidor (los suyos) | `received_quantity`/`status` por línea + `delivered_at` + `register_exit` por línea + derivar `distributor_id` — todo atómico |
| `save_route(...)` / `update_stop(...)` | admin (crear), distribuidor (paradas propias) | `mark_stop` valida que la ruta sea del distribuidor del JWT |
| `create_credit(...)` / `cancel_credit(...)` | **solo admin** | Alta/baja con motivo (matriz) |
| `register_payment(p_credit, p_amount, p_method)` | admin, operador | Valida `amount <= balance`, inserta pago, recalcula `balance`, pone `paid`+`settled_at` si llega a 0, audita |
| `mark_alert_read(p_alert)` | auth + scope | Pone `read_at` (solo alertas visibles según RLS) |
| `get_dashboard(p_from date DEFAULT CURRENT_DATE-30, p_to date DEFAULT CURRENT_DATE)` | auth | Lee `dashboard_daily` filtrando por rol (distribuidor: su id) — egress mínimo, RLS resuelta en servidor |
| `touch_updated_at()` | trigger | `BEFORE UPDATE` de todas las mutables |
| `audit_diff()` | trigger | Solo en las tablas del alcance §3.14 |
| `sync_email()` | trigger | `auth.users` → `users.email` (onboarding/edición) |
| `sanitize_distributor_role()` | trigger | `BEFORE UPDATE OF role_id` en `users`: si el nuevo rol no es `distribuidor` → `distributor_id = NULL` |

**Scope de alcance — regla fija**: ninguna RPC acepta `distributor_id` ni `store_id` como parámetro de alcance. El scope se deriva **siempre** en servidor desde el JWT: `my_distributor_id()` (distribuidor) o `my_store_ids()` (operador). Los parámetros de entrada son solo de **contenido** (qué producto, cuánta cantidad), nunca de **visibilidad** — así un JWT robado o un argumento manipulado no puede leer datos ajenos (RLS + derivación en la misma función).

**Atomicidad del stock (corregido — crítico)**: nunca leer-then-escribir. El UPDATE lleva el guard en el `WHERE` (lock implícito + validación en 1 sentencia):
```sql
UPDATE stock SET quantity = quantity - p_qty, updated_at = now()
WHERE product_id = p_pid AND store_id = p_sid AND quantity >= p_qty
RETURNING quantity;
IF NOT FOUND THEN RAISE EXCEPTION 'stock insuficiente o fila inexistente'; END IF;
-- En batches (confirm_delivery): ordenar filas por (product_id, store_id) para adquirir locks en mismo orden (anti-deadlock).
-- Prohibido EXCEPTION WHEN unique_violation como control de flujo → usar ON CONFLICT.
```

**REVOKE/GRANT**: `REVOKE INSERT, UPDATE, DELETE ON stock, movements, order_items, orders, credits, credit_payments, price_publications, alerts FROM authenticated;` + `GRANT EXECUTE` solo a las funciones de esta tabla. Lecturas vía RLS normal. `REVOKE EXECUTE ... FROM anon` en helpers y RPC (el chatbot/n8n siempre viaja con JWT de usuario, nunca anon sin sesión).

**Search path (obligatorio)**: toda función `SECURITY DEFINER` se crea con `SET search_path = public` — sin esto un objeto temporal/`public` malicioso puede redirigir la ejecución (hijack clásico de PostgREST).

---

## 5. Espacio, egress y rendimiento

**Espacio (storage)**
- `bigint` en IDs internos; enums de 4B; BRIN en append-only (KB vs MB de btree).
- `audit_log` con alcance acotado + `diff` JSONB: ~50 MB a 1M movements en vez de ~500 MB.
- `movements`: 5 índices (2 parciales) en vez de 7 → ~60 MB menos y ~7% menos CPU por INSERT.
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
| D6 | Sin `sku`; se conserva `barcode` de NØSEE | El QR codifica producto↔tienda (cliente); `barcode` ya trae índice único funcional probado |
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
| D21 | Alcance del audit acotado (6 tablas); **sin** audit de `movements` ni chat | `movements` ya es el asiento forense; auditar su INSERT = duplicar el ledger (~500 MB); 1 fila por mensaje de chat era el mayor volumen de la BD |
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

-- 5. Seeds en orden (D19):
--    a) roles (admin, operador, distribuidor)
--    b) unit_types, store_types
--    c) product_categories (padres ANTES que hijos por parent_id)
--    d) brands
--    e) motives: venta(exit), reabastecimiento(entry), devolución(entry), merma(exit), ajuste(NULL)

-- 6. PRERREQUISITO: signup del primer usuario admin (users.created_by NOT NULL en stores etc.)

-- 7. Funciones + triggers (§4) y RLS (§8)

-- 8. Podar publicación realtime (§5):
--    ALTER PUBLICATION supabase_realtime DROP TABLE audit_log, chat_messages,
--      chat_conversations, credit_payments, movements;

-- 9. Jobs pg_cron (diario):
--    expiry_soon   → stock.expiry_date <= CURRENT_DATE + 15 AND quantity > 0
--    order_late    → orders.expected_at < now() AND delivered_at IS NULL AND status NOT IN ('delivered','cancelled')
--    credit_overdue→ credits.due_date < CURRENT_DATE AND balance > 0
--    (todas con INSERT ... ON CONFLICT DO NOTHING sobre uq_alert_open)

-- 10. Verificaciones
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE NOT convalidated LOOP
    RAISE WARNING 'FK inválida: %', r.conname;
  END LOOP;
END $$;
-- + probar: assign → entry → exit (concurrente) → reverse → set_price → payment
```

**Preparación de datos (cuando se carguen productos/tiendas/precios)**
- Verificar duplicados de `barcode` normalizado antes del unique.
- Verificar unicidad de `unit_types.abbreviation` y `distributors.nit` en los datos de origen (si pasa, crear los uniques).
- Verificar que no existan **2 precios activos** para el mismo (store, product) de NØSEE antes de crear `uq_price_store_product_active` (limpiar dejando el más reciente).
- Verificar que NØSEE no tenga `price = 0` (el nuevo CHECK `> 0` los rechazaría).
- Migrar `created_at` de NØSEE con `USING created_at AT TIME ZONE 'UTC'` (verificar cómo se insertaron antes).

---

## 8. RLS (referencia)

Políticas completas en `idea basica proy admin de proys.md` → sección *Roles y Permisos (SEC-01)*. Resumen de dependencias del esquema:

| Rol | Se filtra por | Soporte en esquema |
|---|---|---|
| distribuidor | `distributor_id = my_distributor_id()` | `users.distributor_id` (§2.9) |
| operador | `store_id ∈ my_store_ids()` | `user_stores` (§3.10) |
| premium | `is_premium()` (incluye admin) | `users.premium` (§2.9) |
| admin | sin filtro + `created_by` trazable | `created_by` en orders/movements/credits |

**Matriz → funciones**: cada operación de la matriz SEC-01 se resuelve con la función de §4 que valida rol **y** scope (la RLS sola no expresa transiciones de estado ni "solo los suyos" al crear). Las políticas `SELECT` se abren a `authenticated` con filtros de scope; **INSERT/UPDATE/DELETE directos están revocados** en las tablas sensibles.

**Corrección documentada contra el `.md`**: el ejemplo `crud_products FOR ALL USING (is_premium())` del .md **está mal** — `FOR ALL` incluye DELETE y daría borrado a un operador premium, violando la matriz. Las policies deben ser **por operación** (`SELECT`/`INSERT`/`UPDATE` separados) y el "eliminar" de admin es **soft-delete** (`is_active = false`) porque las FK `RESTRICT` bloquean el hard delete con historial.

Todas las tablas con `ENABLE ROW LEVEL SECURITY` desde el Sprint 1.

---

## 9. Pendientes

- [ ] Checklist del .md **p.6** "Crear la base de datos" → ejecutar §7.
- [ ] Checklist **p.15** → este documento es la especificación base; cambios futuros se anotan aquí primero.
- [x] Premium alineado en el `.md` principal (tabla `users`, no `app_metadata`; `is_premium()` única y con `SET search_path`).
- [ ] Alinear el `.md` principal (resto): `order` → `orders`, `price_publication` → `price_publications`, `umbral` → `threshold`, `user_id` de movimientos → `created_by`, `leída` → `read_at`, **eliminar el ejemplo `FOR ALL is_premium()`** (§8), `phone` → `phone_number`, DIST-04 en `motives`, `quantity` en kg (`numeric`), `expected_at`/`due_date`/`currency` como nuevos campos de requisito.
- [ ] Corregir referencias cruzadas en este doc: §3.4→D18 (BRIN), §3.7→D15 (unique de créditos).
- [ ] **Umbrales de índices diferidos (D22)**: crear `GIST(location)` al llegar a ~1.000 tiendas; `pg_trgm`+GIN al llegar a ~50.000 productos — revisar con `pg_stat_statements` en cada sprint.
- [ ] Validar `unit_types.abbreviation` único en seed (§7).
- [ ] Confirmar nombre de proyecto (checklist p.4) → afecta `project_ref` en el MCP.
