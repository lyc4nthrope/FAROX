1. Jira según los siguientes requerimientos  
2. Escoger arquitectura del proyecto — **Resuelto: ver sección "Decisiones de Arquitectura" más abajo**  
3. Escoger metodologia/s del proyecto  
4. Escoger nombre al proyecto — *pendiente; el README ya usa "FAROX" (confirmar)*   
5. Escoger base de datos, si relacional o no relacional o híbrida — **Resuelto: relacional (PostgreSQL vía Supabase)**  
6. Crear la base de datos — *pendiente: esquema SQL en Supabase (paso del Sprint 1)*  
7. definir atributos tienda — **Resuelto: ver Modelo de Datos (`stores`)**  
8. definir atributos distribuidor — **Resuelto: ver Modelo de Datos (`distributors`)**  
9. definir atributos o relaciones ruta del distribuidor — **Resuelto: `routes` + `route_stops`**   
10. definir atributos entradas y salidas, sí la clase va separada o junta — **Resuelto: juntas en `movements` con campo `type`**  
11. definir si clase de lista de pedido distribuidor — **Resuelto: sí, `orders` + `order_items`**  
12. Revisar si clase para código QR y las implicaciones — **Resuelto: librería en el cliente (`qrcode`), sin clase propia**  
13. definir cómo manejar la seguridad y privacidad de la información — **Resuelto: ver sección "Seguridad y Privacidad" (Supabase Auth + RLS + funciones SQL)**  
14. revisar si falta algo en la base de datos — **Resuelto: users/roles, stock, motives, movements, alerts, credits, chat, audit_log, caducidad**  
15. terminar modificaciones y/o adiciones a la base de datos, teniendo en cuenta que puede cambiar  
16. escoger plataforma, si sitio web o app o 2 o web responsive — **Resuelto: web responsive (SPA) + app móvil futura sobre el mismo backend**  
17. escoger lenguaje de programación — **Resuelto: TypeScript (front; workflows n8n en JS) y SQL/plpgsql (lógica de negocio)**  
18. definir frameworks o librerías a usar según los requisitos — **Resuelto: React + Vite, Tailwind CSS, @supabase/supabase-js, `qrcode`, n8n (chatbot), OpenRouter (LLM)**


# **Decisiones de Arquitectura (Sprint 0)**

Resuelve los puntos 2, 5, 12, 13, 16, 17 y 18 de la lista anterior. Pendientes: 1 (Jira), 3 (metodología), 4 (nombre), 6 (crear la BD) y 15.

## **Stack Seleccionado**

| Componente | Decisión | Justificación |
| :---- | :---- | :---- |
| Arquitectura | Monolito modular en 3 capas (presentación / lógica / datos), **front y back separados** | Desacoplamiento real: el backend atiende a la web y a la futura app móvil |
| Base de datos | **PostgreSQL** (relacional), gestionado por **Supabase** | Transacciones ACID del inventario, integridad producto ↔ tienda ↔ stock, auditoría |
| Backend | **Supabase**: Postgres + Auth (JWT) + RLS + Realtime | API REST automática (PostgREST) compartida por web y móvil; infraestructura managed = escalabilidad |
| Frontend web | **React + Vite (SPA)** + **Tailwind CSS** (mobile-first) | App privada/backoffice sin SEO; responsive con una sola base de código |
| Lenguaje | **TypeScript** (front; workflows n8n en JS), **SQL/plpgsql** (lógica de negocio) | Tipado de extremo a extremo; la lógica crítica vive en el servidor |
| App móvil futura | React Native o Flutter consumiendo **la misma API de Supabase** | Justificación de escalabilidad: backend independiente del cliente |
| QR | Librería en cliente (`qrcode`), **0 egress**, para la **asociación Tienda ↔ Distribuidor** (el distribuidor escanea para vincularse) | Escaneo en campo sin dependencia del servidor; no necesita SKU |
| Mapas / rutas | Google Maps JavaScript API en el front (o OpenFleet) | Requisito explícito DIST-03 |
| Chatbot | **n8n** (webhook → AI Agent → tools) + **OpenRouter** (LLM multimodelo) | Orquestación visual reutilizable en Fase III (notificaciones); OpenRouter = un endpoint para varios modelos, sin lock-in. Tools invocan PostgREST **con el JWT del usuario** → RLS aplicado |

## **Pilares de Implementación (obligatorios)**

1. **Toda mutación de stock pasa por funciones SQL** (`SECURITY DEFINER`): entrada/salida + recálculo del stock y evaluación del `threshold` + registro en log dentro de una única transacción atómica. Nunca un `UPDATE`/`INSERT` directo desde el front.
2. **RLS desde el Sprint 1** en todas las tablas nuevas; el bloqueo Premium (SEC-01) se implementa en RPCs y policies **concretas** (`register_entry`/`register_exit`, `get_dashboard`, QR masivo) — **nunca** como único filtro de una policy de escritura general.
3. **Chatbot en n8n con seguridad verificada**: el webhook **valida la firma del JWT** (JWT secret de Supabase) y las tools invocan las funciones SQL del punto 1 **con el JWT del usuario** — nunca `service_role` — así el RLS sigue aplicando. LLM vía OpenRouter.
4. **Realtime de Supabase** para el Dashboard (INT-01) en lugar de montar WebSockets manualmente.

## **Riesgos asumidos y mitigación**

| Riesgo | Mitigación |
| :---- | :---- |
| Lock-in de Supabase | Schema y lógica en SQL estándar (portable a cualquier PostgreSQL) |
| Curva de aprendizaje de RLS | Plantilla de policies por rol desde el Sprint 1; revisión en cada CRUD |
| Reglas de negocio fugándose al front | Revisión explícita en cada demo: sin escrituras directas a la BD desde el cliente |
| n8n como servicio externo (+1 infra) | JWT verificado en el webhook; `service_role` prohibido en tools; self-host con Docker actualizado y backups (o n8n cloud) |

# **Modelo de Datos (Sprint 0)**

Resuelve los puntos 7-11 y 14. Se parte de una base de datos existente y se extiende. Convención: snake_case en plural.

## **Tablas existentes (se conservan)**

| Tabla | Atributos clave | Notas |
| :---- | :---- | :---- |
| `unit_types` | id, name, abbreviation, category | Catálogo — INV-01; sin `code` |
| `brands` | id, name | Catálogo |
| `product_categories` | id, name, **parent_id** | Jerárquica — **incluida en MVP** |
| `products` | id, name, description, unit_type_id, brand_id, category_id, **barcode**, created_by, is_active | Catálogo de uso general — **no existe SKU**: se usa **`barcode`** (el QR asocia tienda ↔ distribuidor y no necesita SKU) — CRUD INV-01 |
| `price_publications` | id, product_id, store_id, **created_by**, price, **currency** `char(3)` default `'COP'`, **is_active**, **created_at** | **Precio que coloca la tienda a un producto y es PRIVADO de esa tienda**: admin ve todas · operador solo las de sus tiendas · distribuidor **ninguna** (recibe solo `unit_price` congelado en `order_items`); 1 fila activa por par Producto ↔ Tienda; cambio **solo vía `set_price()`** (append-only: inserta fila nueva + desactiva la anterior, **jamás UPDATE del precio**) |
| `stores` | id, store_type_id, name, address, city, **location** `geography(Point,4326)` (PostGIS), phone, created_by, is_active | p.7 — INV-02; **único punto de verdad geográfico**: la API expone las coordenadas vía la vista **`stores_geo`** (ST_X/ST_Y en servidor) |
| `roles` | id, name (admin, operador, distribuidor) | Ver sección Roles y Permisos |
| `users` | id (FK → `auth.users`), **full_name**, role_id, **premium**, **phone_number**, email, contact_preference, distributor_id, is_active | Premium = flag en la tabla (**no** `app_metadata`), leído con `is_premium()`; contact_preference enum(whatsapp/phone/email) |
| `alerts` | id, **type** enum(**stock_low, expiry_soon, order_late, credit_overdue**), store_id, product_id?, order_id?, distributor_id?, **message**, **context** jsonb, **read_at**, **resolved_at**, created_at | **Única tabla de alertas** (descarta `stock_alert`); **se materializan al ocurrir la condición** (transiciones de stock, jobs diarios, entrega/cobro) con dedup **por episodio** (`resolved_at IS NULL`) — así no se re-alerta en cada movimiento — INV-06 |
| `orders` | id, distributor_id, store_id, route_id?, **status** enum(pending, in_route, delivered, cancelled), created_by, **expected_at**, delivered_at?, **cancelled_at**/**cancelled_reason**, created_at | p.11 — DIST-02; **`expected_at`** = fecha prometida/SLA (habilita la alerta `order_late`) |
| `order_items` | order_id, product_id, **quantity** `numeric(12,3)`, **received_quantity** `numeric(12,3)`, status, **unit_price** (solo premium lo ve) | Líneas del pedido; `unit_price` congelado al crearlo |

## **Tablas nuevas**

| Tabla | Atributos clave | Notas |
| :---- | :---- | :---- |
| `stock` | (product_id, store_id) PK, **quantity** `numeric(12,3)`, **threshold** `numeric(12,3)` NULL, expiry_date, updated_at | Asignación Producto ↔ Tienda + punto de pedido — INV-03/06. **`threshold` es OPCIONAL**: NULL = ese producto **no tiene alerta de stock**; la señal **se materializa en `alerts`** |
| `distributors` | id, name, nit (UNIQUE), contact_name, phone, email, contact_preference, is_active | p.8 — DIST-01 |
| `motives` | id, name, **suggested_type** (entry/exit) | Catálogo de motivos/origen (requerido en cada movimiento) — **aquí vive la tipificación DIST-04**: venta / reabastecimiento / devolución / merma / ajuste |
| `movements` | id, **type** enum(entry, exit), product_id, store_id, **distributor_id?**, motive_id, order_id?, **created_by**, **quantity** `numeric(12,3)`, unit_price?, **expiry_date?**, created_at | p.10: entradas y salidas **juntas**; append-only; `expiry_date` solo en entradas; **`quantity` `numeric(12,3)` en todo** (soporta kg) |
| `routes` | id, distributor_id, **route_date**, **status** enum(planned, active, completed, cancelled) | p.9 — DIST-03 |
| `route_stops` | route_id, store_id, **stop_order**, **estimated_time**, **status**, arrived_at | Paradas → Google Maps / PostGIS |
| `credits` | id, order_id, store_id (deudor), **total_amount**, **currency** `char(3)` default `'COP'`, **balance**, **status** enum(pending, paid, cancelled), **due_date**, settled_at?, cancelled_at/cancelled_reason?, created_by, created_at | **Desde el MVP** — ciclo de vida del fiado; **`due_date`** = vencimiento del fiado (habilita la alerta `credit_overdue`) |
| `credit_payments` | credit_id, **amount**, **paid_at**, **created_by**, **payment_method** enum(cash, transfer, card, other) | Pagos parciales + historial (append-only; corrección por reverso) |
| `chat_conversations` | id, user_id, created_at | CHAT-01 |
| `chat_messages` | conversation_id, role (user/assistant/tool), content, **payload JSONB** | payload = tool-calling del chatbot |
| `audit_log` | id, **created_by** (sin FK), **table_name**, **action** enum(insert, update, delete), **row_id** (**text** — guarda el uuid de `users` y el bigint del resto de tablas), **diff** jsonb (**solo columnas cambiadas**, no snapshots), created_at | Auditoría: quién, qué, cuándo. **Activo desde Sprint 1**; alcance = 8 tablas (users, price_publications, orders, credits, credit_payments, distributors, products, stores); **NO** audita `movements` (ya es el asiento forense — duplicarlo ~10× el peso) ni chat |

## **Decisiones de modelado (p. 7-11, 14)**

- **p.10 — Junta**: una sola tabla `movements` con campo `type`. Mismos atributos en ambos casos; el Dashboard consulta entradas y salidas juntas; la regla de `threshold` se escribe una vez. Tablas separadas obligarían a `UNION` y duplicarían la lógica.
- **p.11 — Sí existe la clase**: `orders` + `order_items` — una lista simple no soporta estados por línea ni recepciones parciales.
- **p.12 — QR no es tabla**: se genera en cliente (`qrcode.react`) con **0 egress**; su propósito es la **asociación fácil tienda ↔ distribuidor** (el distribuidor escanea para vincularse) y **no necesita SKU**; no persiste nada nuevo.
- **p.14 — Completado con**: `stock`, `users`/`roles`, `motives`, `movements`, `credits`, `alerts`, chat y `audit_log`.
- **Caducidad**: registro simple (`expiry_date` en la entrada) + alerta **`expiry_soon` materializada** en `alerts` (job diario). **Sin lotes FEFO** (complicaría cada salida sin beneficio MVP).
- **Deudas**: `credits` + `credit_payments` ligadas a `orders` (decidido en planificación).

## **Relaciones principales**

- `products` N:N `stores` → vía `stock` (quantity/threshold) y `price_publications` (precio privado por tienda)
- `movements` N:1 → products, stores, motives, orders; **nullable** `distributor_id`
- `orders` N:1 → distributors, stores; 1:N → `order_items`
- `routes` N:1 → distributors; 1:N → `route_stops` N:1 → stores
- `credits` N:1 → `orders`; 1:N → `credit_payments`
- `users` N:1 → roles; `users.id` FK → `auth.users` (Supabase)

# **Roles y Permisos (SEC-01)**

| Operación | Admin | Operador | Distribuidor |
| :---- | :---- | :---- | :---- |
| CRUD Productos/Marcas/Categorías (INV-01) | ✔ total (incluye eliminar; puede editar **cualquiera**) | ✔ crear/editar, ✘ eliminar — edita **solo los suyos** (`created_by`) | ✔ solo lectura (catálogo de uso general) |
| CRUD Tiendas (INV-02) — alta solo vía `create_store()` (**tope: 1 tienda activa; 3 si `is_premium()`**; admin exento, auto-asocia al dueño) | ✔ total | ✔ crear/editar (sus tiendas) | ✘ |
| Asignar Producto↔Tienda, `threshold` (INV-03) | ✔ | ✔ | ✘ |
| Registrar entradas/salidas manuales (INV-04) — `register_entry`/`register_exit` **exigen `is_premium()`** | ✔ (siempre premium) | ✔ **solo premium** | ✘ |
| Corregir/anular movimientos existentes | ✔ (reverso) | ✘ | ✘ |
| Publicar/editar precios (`price_publications`, **privados por tienda**) | ✔ (única vía `set_price()`) | ✔ solo lectura (**solo los de sus tiendas**) | ✘ **ninguna** |
| CRUD Distribuidores (DIST-01) | ✔ | ✘ solo lectura | ✘ |
| Catálogos (roles, unit_types, store_types, motives, brands, categorías) | ✔ crear/editar | ✘ | ✘ |
| Pedidos (DIST-02) | ✔ crear/cancelar | ✔ crear (`create_order`), estados y recepción (`confirm_delivery`) de sus tiendas | ✔ **solo los suyos** + confirmar entrega (`confirm_delivery`) |
| Rutas (DIST-03) | ✔ crear/asignar | ✔ ver | ✔ **solo su ruta** + marcar paradas |
| Credits: crear/anular | ✔ | ✘ | ✘ |
| Credits: registrar cobros | ✔ | ✔ | ✘ |
| Usuarios, roles, flag Premium | ✔ | ✘ | ✘ |
| Dashboard (INT-01) — RPC `get_dashboard(from, to)` + realtime, **exige `is_premium()`** | ✔ todas las tiendas | ✔ agregado **global** (MVP) | ✔ solo lo suyo |
| QR individual / masivo (INV-05) | ✔ masivo | ✔ individual; **masivo solo `is_premium()`** | ✘ |
| Chatbot (CHAT-01/02) | ✔ | ✔ (su alcance) | ✔ (solo consulta propia) |

**Patrones**: Admin = configuración + destrucción + usuarios (siempre premium) · Operador = ejecución diaria **sin destruir** (no borra, no toca usuarios ni precios) · Distribuidor = RLS filtrado por `distributor_id = mi_id` · **Usuario normal (no premium)** = catálogo de productos + `stock` de su tienda + **pedir** (`create_order`) y confirmar recepción (`confirm_delivery`) — **no** registra movimientos manuales ni ve el dashboard analítico · **Premium** = flag en la tabla `users` (leído con `is_premium()`; admin siempre premium) que además habilita **movimientos manuales** (`register_entry`/`register_exit`), **dashboard analítico** (`get_dashboard` + realtime), **QR masivo** y la lectura de `order_items.unit_price` — *esto es el "CRUD avanzado"* · **Productos** = catálogo de uso general: solo el creador (`created_by`) modifica, admin edita cualquiera, todos leen · **Topo de tiendas** = máximo 1 tienda activa; 3 si es premium (admin exento; se crean con `create_store()`, que auto-asocia al dueño) · **Gate de alcance** = toda acción crear/actualizar exige estar asociado a **≥1 tienda** (distribuidor: su `distributor_id`), excepto perfil propio, `create_store()` y chat.

# **Seguridad y Privacidad (p. 13)**

Regla de oro: **el front nunca da seguridad** — solo UX. El enforcement real vive en la BD. Cinco capas:

## **1. Autenticación — Supabase Auth**
JWT corto + refresh token. Rol y premium viven en la tabla **`users`** (`role_id`, `premium`) y se leen con `my_role()`/`is_premium()` (SECURITY DEFINER) — nunca en claims del JWT, en `user_metadata` ni en `app_metadata` (el cliente puede escribir metadata con su propio token y elevarse a premium; los claims quedan stale hasta refrescar el token). Fuente única de verdad: decisión D7 del esquema de BD.

## **2. Autorización — RLS en todas las tablas (desde Sprint 1)**

```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;  -- default deny

-- Policies POR OPERACIÓN (SELECT/INSERT/UPDATE/DELETE separados):
CREATE policy leer_products ON products FOR SELECT
  TO authenticated USING (true);                       -- todos leen el catálogo

CREATE policy insert_products ON products FOR INSERT
  TO authenticated WITH CHECK (
    public.my_role() = 'admin'
    OR (public.my_role() = 'operador' AND public.has_scope()));

CREATE policy update_products ON products FOR UPDATE
  TO authenticated USING (
    public.my_role() = 'admin'
    OR (products.created_by = auth.uid() AND public.has_scope()));  -- solo el creador

CREATE policy delete_products ON products FOR DELETE    -- soft-delete: is_active = false
  TO authenticated USING (public.my_role() = 'admin');
```

**Nunca `FOR ALL` en tablas sensibles**: `FOR ALL` incluye DELETE y violaría el soft-delete (en `products` el DELETE solo debe apagar `is_active`). El gate premium vive en RPCs/policies **concretas** (`register_entry`/`register_exit`, `get_dashboard` + realtime, QR masivo) — **nunca** como único filtro de una policy de escritura general.

**Gate de alcance**: toda acción crear/actualizar exige estar asociado a **≥1 tienda** (`has_scope()`; distribuidor: su `distributor_id`), excepto: perfil propio, `create_store()` y chat.

`is_premium()` es `SECURITY DEFINER` y lee la tabla `users` (no el JWT). "Admin siempre premium" se resuelve en la fórmula, no con constraint:

```sql
CREATE FUNCTION public.is_premium() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(u.premium, false) OR COALESCE(r.name = 'admin', false)
  FROM users u
  LEFT JOIN roles r ON r.id = u.role_id
  WHERE u.id = auth.uid()
$$;
```

## **3. Lógica de negocio en funciones SQL (pilar 1)**

```sql
REVOKE INSERT, UPDATE, DELETE ON stock, movements FROM authenticated;
GRANT EXECUTE ON FUNCTION register_entry(...), register_exit(...) TO authenticated;
```

La función valida (cantidad > 0, stock suficiente, tienda existe), actualiza stock, inserta el movimiento y loguea **en una sola transacción**. Un JWT robado o script trucado no puede inflar stock: el ataque se bloquea en la BD.

## **4. Secretos y servicios externos (n8n)**
- **Service role key NUNCA en el front** (toda variable `VITE_*` de Vite es pública) **ni en n8n**: solo anon key + el JWT del usuario → el RLS protege todo.
- API key de OpenRouter solo en las credenciales de n8n; webhook con rate limit por usuario.
- Google Maps key restringida por HTTP referrer; QR codifica solo IDs, el servidor revalida al escanear.

## **5. Chatbot (CHAT-01/02) — n8n + OpenRouter**
- El webhook de n8n **verifica la firma del JWT** con el JWT secret de Supabase (decodificar sin verificar = no cuenta) y extrae solo `user_id` del claim verificado — **nunca del texto del usuario** (anti prompt-injection). Premium y rol se consultan con el JWT del usuario vía `is_premium()`/`my_role()` (tabla `users`, no claims).
- Cada tool (`get_stock`, `create_order`) llama a PostgREST con `Authorization: Bearer <JWT del usuario>` + anon key → **hereda el RLS**; `service_role` prohibido en el workflow.
- El LLM (OpenRouter) decide *qué* llamar, no *a quién* accede; la trazabilidad de las consultas/tools del chatbot la lleva **n8n** (un registro por invocación de tool dentro del flujo de trabajo) — los triggers DML de `audit_log` **nunca ven un SELECT**.

## **6. Higiene básica**
HTTPS obligatorio, validación Zod en cada formulario, `npm audit` + Dependabot en CI, backups PITR de Supabase, `audit_log` activo desde Sprint 1.

**Requerimientos**

## **Módulo Central: Gestión de Inventario y Productos**

Objetivo: Administrar el catálogo de bienes, su estado físico y su trazabilidad a través de las tiendas asociadas.

1. CRUD de Productos: Capacidad completa para Crear, Leer, Actualizar y Eliminar productos (incluyendo la definición de Unidad de Medida Base) — catálogo de uso general: **solo el creador** (`created_by`) lo modifica, **admin puede editar cualquiera**, todos leen; eliminar = soft-delete (`is_active`), solo admin (SEC-01).  
2. Gestión de Tiendas: CRUD completo de entidades tiendas, registrando su ubicación geográfica en **una sola columna `location geography(Point,4326)`** (PostGIS — único punto de verdad geográfico); la API expone las coordenadas a través de la vista **`stores_geo`** (ST_X/ST_Y en servidor). Alta solo vía la RPC **`create_store()`** (auto-asocia al dueño; tope: 1 tienda activa, 3 si es premium, admin exento).  
3. Asignación de Productos a Tienda: Mapeo lógico para definir qué productos están disponibles en cada punto de venta específico.  
4. Gestión de Inventario (Transacciones): Registro granular de Entradas y Salidas (RPC `register_entry`/`register_exit`, **solo premium**), obligando la asociación a una entidad tienda y un motivo/origen definido; cantidades **`numeric(12,3)` en todo** (soporta kg).  
   * Flag de Alerta de Stock: las alertas **se materializan en la tabla `alerts`** cuando el inventario cumple la regla INV-06: `quantity = 0` **o** (`threshold IS NOT NULL` **y** `quantity <= threshold`) — **`threshold` es opcional**: NULL = ese producto no tiene alerta de stock.
5. Trazabilidad y QR: Generación de Códigos de Respuesta Rápida (QR) para la **asociación fácil Tienda ↔ Distribuidor** (el distribuidor escanea para vincularse); se genera **en cliente (0 egress)** y no necesita SKU.  
6. Identificación de Faltantes: Funcionalidad específica para identificar productos que requieren reabastecimiento — regla INV-06 exacta: alerta si `quantity = 0` **o** (`threshold IS NOT NULL` **y** `quantity <= threshold`); `threshold` NULL = sin alerta de stock.

## **Módulo Operacional: Distribuidor y Logística**

Objetivo: Gestionar la entidad comercializadora, sus movimientos de stock asociados a pedidos y optimizar su logística.

1. CRUD de Distribuidores: Gestión completa de las entidades distribuidoras.  
2. Gestión de Pedidos Pendientes (Stock Asignado): Módulo para visualizar qué productos están asignados a un Distribuidor pero aún no han sido movilizados/recibidos en destino, con su **fecha prometida `expected_at`** (habilita la alerta `order_late`) y su anulación trazable **`cancelled_at` / `cancelled_reason`**.  
3. Ruta del Distribuidor: Funcionalidad para la planificación y visualización geográfica de las rutas, con soporte explícito para integración vía Google Maps API o OpenFleet.  
4. Tipificación de Movimientos (Adicional Clave — DIST-04): vive en la tabla **`motives`** (`name` + `suggested_type` entry/exit), sembrada con *Venta*, *Reabastecimiento*, *Devolución*, *Merma* y *Ajuste*; viaja en cada `movements.motive_id`.

## **Módulo Interfaz y Servicios Avanzados**

Objetivo: Proveer interfaces interactivas y capacidades avanzadas de consulta.

1. Dashboard Operativo (INT-01): es la **tabla `dashboard_daily`** — agregado diario por `distributor_id` con **upsert O(1) por movimiento**; **no es una vista** (la vista re-agregaba todo el historial en cada refresco **y evadía RLS**: se ejecuta como owner). Lectura vía RPC **`get_dashboard(from, to)`** (rango por defecto 30 días, filtrado por rol y **exige `is_premium()`**). En tiempo real, `dashboard_daily` y `alerts` están **publicados en Realtime** (entrega = SELECT + RLS ⇒ policy `dashboard_read`: admin · operador global MVP · distribuidor solo lo suyo, **y `is_premium()`**); el front se suscribe **solo mientras la pestaña está visible**.  
2. Control de Acceso (Premium): flag en la tabla **`users`** (no `app_metadata`) validado con **`is_premium()`**. Desbloquea: **movimientos manuales** (`register_entry`/`register_exit`), **dashboard analítico** de gastos/ingresos (`get_dashboard` + realtime), **QR masivo** y la lectura de `order_items.unit_price` (lo sirve la RPC `get_order_items()`; el distribuidor normal sabe QUÉ y CUÁNTO, no el precio).  
3. Chatbot Inteligente: Implementación de un agente conversacional con capacidades avanzadas:  
   * Validación Robusta de Usuario: Verificación estricta (ej: token de sesión \+ verificación de nivel premium).  
   * Modelo API/Local: Definición clara del método de servicio para ejecutar consultas o acciones.  
   * Capacidad Transaccional: El chatbot debe poder invocar funciones del sistema (Ej: "Consulta el stock de la Tienda X" o "Genera una orden de reabastecimiento").

# **Mejoras de Escalabilidad y Fase II (Roadmap)**

Estos requisitos no son estrictamente necesarios para un MVP funcional, pero son vitales si esperas que el proyecto crezca en volumen o complejidad.

| Requisito | Descripción Detallada | Impacto en la Escalabilidad |
| :---- | :---- | :---- |
| Gestión de Categorías | Creación de una tabla jerárquica para clasificar productos (Ej: Bebidas → Refrescos). | Permite consultas complejas y filtros rápidos en el Dashboard. |
| Historial Detallado (Auditoría) | Registro inmutable de cada evento: Quién, Qué, Cuándo, Por qué. **`audit_log` ya está activo desde Sprint 1** (8 tablas; `diff` jsonb = solo columnas cambiadas; NO audita `movements` ni chat). | Esencial para trazabilidad forense; permite auditar discrepancias de inventario con precisión milimétrica. |
| Roles y Permisos (RBAC) | Implementación granular del Control de Acceso basado en Roles (ej: Cliente vs. Gerente vs. Operador). | Facilita la gestión de múltiples usuarios en un entorno corporativo sin sobrecargar el login. |
| Gestión de Precios Dinámicos | Capacidad de aplicar precios variables al mismo producto según el perfil del usuario que consulta (Premium o Standard). **Nota**: en el MVP `price_publications` es **privado por tienda** (admin/operador-scope; el distribuidor recibe solo `unit_price` congelado) — esto sería un cambio de modelo posterior. | Soporte para diferentes modelos de negocio (Ej: Descuento especial a distribuidores). |
| Notificaciones Proactivas | Sistema de event listeners que dispara alertas automáticas cuando se cumple una condición, incluso sin interacción del usuario. | Mejora drásticamente la usabilidad al avisar antes de que el problema sea grave (Ej: "Stock en 3 días \= Bajo"). |
| Gestión de Proveedores Externos | Entidad separada para registrar a los proveedores primarios que alimentan a los distribuidores. | Separa la cadena de suministro interna (Distribuidor→Tienda) de la externa (Proveedor→Distribuidor). |

# **Planificación del Proyecto: 2 Meses (8 Semanas / 4 Sprints)**

## ***Mapeo General de Requisitos***

| Área Principal | ID Requisito | Descripción Detallada | Prioridad MVP |
| ----- | ----- | ----- | ----- |
| Inventario | INV-01 | CRUD Productos (incluye Unidad de Medida Base). | Alta (S2) |
| Inventario | INV-02 | CRUD Tiendas y Geolocalización (`location geography(Point,4326)` PostGIS + vista `stores_geo`). | Alta (S1) |
| Inventario | INV-03 | Asignación Producto →Tienda. | Media (S2) |
| Inventario | INV-04 | Registro de Entradas y Salidas (con asociación). | Alta (S2) |
| Inventario | INV-05 | Generación QR para la asociación Tienda ↔ Distribuidor. | Media (S3) |
| Inventario | INV-06 | Detección de "Productos Faltantes" (Regla clara). | Alta (S2) |
| Distribuidor | DIST-01 | CRUD Distribuidor. | Alta (S1) |
| Distribuidor | DIST-02 | Módulo de Pedidos: Gestión y Estado del Ciclo de Vida (Ej: Pendiente → Recibido). | Alta (S3) |
| Distribuidor | DIST-03 | Ruta Logística con integración Mapas/OpenFleet. | Media (S3) |
| Interacción | INT-01 | Dashboard (tabla `dashboard_daily`: Entradas/Salidas por Distribuidor). | Alta (S3) |
| Seguridad | SEC-01 | Bloqueo de Acciones basado en Rol Premium. | Alta (**Sprint 2**, unificado con el cronograma) |
| Chatbot | CHAT-01 | Chatbot: Verificación robusta de usuario y enlace a su información. | Media (S4) |
| Chatbot | CHAT-02 | Chatbot: Capacidad de realizar consultas/acciones sobre la información del usuario. | Alta (S4) |

## **Cronograma Detallado por Sprint**

### ***SPRINT 1: Cimientos y Estructura (Semanas 1 \- 2\)***

Objetivo: Tener el esqueleto funcional. Guardar, leer y definir quién eres.

* Tareas Clave: Configuración de Infraestructura, Creación de DB Schema, CRUD Tiendas & Productos, RLS (Sprint 1) y **`audit_log` desde Sprint 1**.  
* Requisitos a Finalizar: INV-01,INV-02,DIST-01.  
* Entregable (Demo): Poder ingresar datos en el sistema y verlos listados correctamente por tipo de entidad.

### ***SPRINT 2: Flujo Operativo Core (Semanas 3 \- 4\)***

Objetivo: El sistema debe registrar un evento de negocio real. ¡Ya estamos moviendo stock\!

* Tareas Clave: Implementar Transacciones (INV-04), Mapeo Inv→Tienda, definir la regla del Poco Stock (INV-06) y el bloqueo Premium (**SEC-01**).  
* Requisitos a Finalizar: INV-03,INV-04,INV-06,**SEC-01** (alineado con el backlog: SEC-01 vive en **Sprint 2**).  
* Entregable (Demo): Registrar una entrada de producto, ver cómo el stock de esa tienda se actualiza y que una alerta `stock_low` aparece si cruza el `threshold`.

### ***SPRINT 3: Logística e Interfaz (Semanas 5 \- 6\)***

Objetivo: El sistema es usable por los usuarios finales. ¡Pueden ver dónde están las cosas\!

* Tareas Clave: Implementar la lógica de Pedidos (DIST-02), integrar el mapa (DIST-03) y construir el Dashboard inicial (INT-01).  
* Requisitos a Finalizar: INV-05,DIST-02,DIST-03,INT-01.  
* Entregable (Demo): Un usuario puede ver el dashboard, hacer clic en un distribuidor y ver su ruta marcada en Google Maps.

### ***SPRINT 4: Inteligencia y Refinamiento (Semanas 7 \- 8\)***

Objetivo: Añadir la capa de valor añadido y pulir la experiencia. ¡Estamos listos para el lanzamiento\!

* Tareas Clave: Desarrollo del Chatbot (CHAT-01,CHAT-02), cerrar brechas como la vista del Historial (`audit_log`, activo desde Sprint 1) y Categorías.  
* Requisitos a Finalizar: CHAT-01,CHAT-02, Refinamiento de Logs/Cat..  
* Entregable (Demo): Un usuario premium puede iniciar sesión, preguntar al bot sobre el estado de un pedido específico y ver la ruta asociada en tiempo real desde el dashboard.

## Roadmap de Escalabilidad (Post-MVP \- Si hay más tiempo)

Si cumples los 8 sprints a tiempo, usa este camino para ir construyendo la V2.0:

| Fase | Enfoque Principal | Requisitos a Priorizar |
| ----- | ----- | ----- |
| Fase II | Robustez y Análisis | Historial de Transacciones (la base `audit_log` ya vive desde Sprint 1 — aquí: UI de consulta y retención), Categorías de Productos. |
| Fase III | Experiencia Avanzada | Precios Dinámicos por Usuario, Notificaciones Proactivas en tiempo real. |
| Fase IV | Expansión y Gestión Completa | Roles de Acceso Granulares (RBAC), Módulo de Proveedores Externos. |

