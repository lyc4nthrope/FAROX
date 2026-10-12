1. Jira según los siguientes requerimientos  
2. Escoger arquitectura del proyecto — **Resuelto: ver sección "Decisiones de Arquitectura" más abajo**  
3. Escoger metodologia/s del proyecto  
4. Escoger nombre al proyecto — *pendiente; el README ya usa "FAROX" (confirmar)*   
5. Escoger base de datos, si relacional o no relacional o híbrida — **Resuelto: relacional (PostgreSQL vía Supabase)**  
6. Crear la base de datos — *pendiente: esquema SQL en Supabase (paso del Sprint 1)*  
7. definir atributos tienda — **Resuelto: ver Modelo de Datos (`stores`)**  
8. definir atributos distribuidor — **Resuelto: ver Modelo de Datos (`distributors`)**  
9. definir atributos o relaciones ruta del distribuidor — **Resuelto: `routes` + `route_stops`**   
10. definir atributos entradas y salidas, sí la clase va separada o junta — **Resuelto: juntas en `movements` con campo `tipo`**  
11. definir si clase de lista de pedido distribuidor — **Resuelto: sí, `order` + `order_items`**  
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
| QR | Librería en cliente (`qrcode`), vinculado a Producto ↔ Tienda | Escaneo en campo sin dependencia del servidor |
| Mapas / rutas | Google Maps JavaScript API en el front (o OpenFleet) | Requisito explícito DIST-03 |
| Chatbot | **n8n** (webhook → AI Agent → tools) + **OpenRouter** (LLM multimodelo) | Orquestación visual reutilizable en Fase III (notificaciones); OpenRouter = un endpoint para varios modelos, sin lock-in. Tools invocan PostgREST **con el JWT del usuario** → RLS aplicado |

## **Pilares de Implementación (obligatorios)**

1. **Toda mutación de stock pasa por funciones SQL** (`SECURITY DEFINER`): entrada/salida + recálculo del umbral + registro en log dentro de una única transacción atómica. Nunca un `UPDATE`/`INSERT` directo desde el front.
2. **RLS desde el Sprint 1** en todas las tablas nuevas; el bloqueo Premium (SEC-01) se implementa como policy `USING (is_premium())`.
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
| `unit_types` | id, code (unidad, kg, caja…), nombre | Catálogo — INV-01 |
| `brands` | id, nombre | Catálogo |
| `product_categories` | id, nombre, **parent_id** | Jerárquica — **incluida en MVP** |
| `products` | id, sku, nombre, descripción, unit_type_id, brand_id, category_id, activo | CRUD INV-01 |
| `price_publication` | id, product_id, store_id, price, published_at, **active** | Precio por tienda: 1 fila activa por par Producto ↔ Tienda |
| `stores` | id, nombre, dirección, ciudad, **lat, lng**, teléfono, activa | p.7 — INV-02 |
| `roles` | id, name (admin, operador, distribuidor) | Ver sección Roles y Permisos |
| `users` | id (FK → `auth.users`), nombre, role_id, **premium**, phone, email, contact_preference | Premium = flag, no rol; contact_preference enum(whatsapp/teléfono/email) |
| `alerts` | id, **tipo** enum(stock_bajo, caducidad_proxima, pedido_retrasado), store_id, product_id?, order_id?, leída, created_at | **Única tabla de alertas** (descarta `stock_alert`); se llena por trigger — INV-06 |
| `order` | id, distributor_id, store_id, estado enum(pendiente, en_ruta, entregado, cancelado), fecha | p.11 — DIST-02 |
| `order_items` | order_id, product_id, cantidad_solicitada, cantidad_recibida | Líneas del pedido |

## **Tablas nuevas**

| Tabla | Atributos clave | Notas |
| :---- | :---- | :---- |
| `stock` | (product_id, store_id) PK, cantidad, **umbral** | Asignación Producto ↔ Tienda + punto de pedido — INV-03/06. La alerta se **calcula** (`cantidad <= umbral`), no se almacena |
| `distributors` | id, nombre, NIT, contacto, phone, email, contact_preference, activo | p.8 — DIST-01 |
| `motives` | id, nombre, tipo_sugerido (entrada/salida) | Catálogo de motivos/origen (requerido en cada movimiento) |
| `movements` | id, **tipo** enum(entrada, salida), product_id, store_id, **distribuidor_id?**, motive_id, order_id?, user_id, cantidad, **expiry_date?**, created_at | p.10: entradas y salidas **juntas**; append-only; `expiry_date` solo en entradas |
| `routes` | id, distributor_id, fecha, estado | p.9 — DIST-03 |
| `route_stops` | route_id, store_id, orden, hora_estimada, estado_visita | Paradas → Google Maps / PostGIS |
| `credits` | id, order_id, store_id (deudor), monto_total, saldo_pendiente, estado, created_at | **Desde el MVP** — ciclo de vida del fiado |
| `credit_payments` | credit_id, monto, fecha, user_id, forma_pago | Pagos parciales + historial |
| `chat_conversations` | id, user_id, created_at | CHAT-01 |
| `chat_messages` | conversation_id, role (user/assistant/tool), content, **payload JSONB** | payload = tool-calling del chatbot |
| `audit_log` | user_id, tabla, acción, registro_id, antes JSONB, después JSONB, created_at | Auditoría: quién, qué, cuándo |

## **Decisiones de modelado (p. 7-11, 14)**

- **p.10 — Junta**: una sola tabla `movements` con campo `tipo`. Mismos atributos en ambos casos; el Dashboard consulta entradas y salidas juntas; la regla de umbral se escribe una vez. Tablas separadas obligarían a `UNION` y duplicarían la lógica.
- **p.11 — Sí existe la clase**: `order` + `order_items` — una lista simple no soporta estados por línea ni recepciones parciales.
- **p.12 — QR no es tabla**: se genera en cliente (`qrcode.react`) sobre el par (product_id, store_id); no persiste nada nuevo.
- **p.14 — Completado con**: `stock`, `users`/`roles`, `motives`, `movements`, `credits`, `alerts`, chat y `audit_log`.
- **Caducidad**: registro simple (`expiry_date` en la entrada) + alerta `caducidad_proxima` por trigger. **Sin lotes FEFO** (complicaría cada salida sin beneficio MVP).
- **Deudas**: `credits` + `credit_payments` ligadas a `order` (decidido en planificación).

## **Relaciones principales**

- `products` N:N `stores` → vía `stock` (cantidad/umbral) y `price_publication` (precio)
- `movements` N:1 → products, stores, motives, order; **nullable** distributors
- `order` N:1 → distributors, stores; 1:N → `order_items`
- `routes` N:1 → distributors; 1:N → `route_stops` N:1 → stores
- `credits` N:1 → `order`; 1:N → `credit_payments`
- `users` N:1 → roles; `users.id` FK → `auth.users` (Supabase)

# **Roles y Permisos (SEC-01)**

| Operación | Admin | Operador | Distribuidor |
| :---- | :---- | :---- | :---- |
| CRUD Productos/Marcas/Categorías (INV-01) | ✔ total (incluye eliminar) | ✔ crear/editar, ✘ eliminar | ✘ |
| CRUD Tiendas (INV-02) | ✔ total | ✔ crear/editar | ✘ |
| Asignar Producto↔Tienda, umbrales (INV-03) | ✔ | ✔ | ✘ |
| Registrar entradas/salidas (INV-04) | ✔ | ✔ | ✘ |
| Corregir/anular movimientos existentes | ✔ (reverso) | ✘ | ✘ |
| Publicar/editar precios (`price_publication`) | ✔ | ✘ solo lectura | ✘ |
| CRUD Distribuidores (DIST-01) | ✔ | ✘ solo lectura | ✘ |
| Pedidos (DIST-02) | ✔ crear/cancelar | ✔ recepción/estados | ✔ **solo los suyos** + confirmar entrega |
| Rutas (DIST-03) | ✔ crear/asignar | ✔ ver | ✔ **solo su ruta** + marcar paradas |
| Credits: crear/anular | ✔ | ✘ | ✘ |
| Credits: registrar cobros | ✔ | ✔ | ✘ |
| Usuarios, roles, flag Premium | ✔ | ✘ | ✘ |
| Dashboard (INT-01) | ✔ todas las tiendas | ✔ su alcance | ✔ su actividad |
| QR individual / masivo (INV-05) | ✔ masivo | ✔ individual | ✘ |
| Chatbot (CHAT-01/02) | ✔ | ✔ (su alcance) | ✔ (solo consulta propia) |

**Patrones**: Admin = configuración + destrucción + usuarios · Operador = ejecución diaria **sin destruir** (no borra, no toca usuarios ni precios) · Distribuidor = RLS filtrado por `distributor_id = mi_id` · **Premium** = flag orthogonal que desbloquea QR masivo y CRUD avanzado (admin siempre premium).

# **Seguridad y Privacidad (p. 13)**

Regla de oro: **el front nunca da seguridad** — solo UX. El enforcement real vive en la BD. Cinco capas:

## **1. Autenticación — Supabase Auth**
JWT corto + refresh token. Rol y premium en **`app_metadata`** (firmado por Supabase), jamás en `user_metadata` (el cliente puede escribirlo con su propio token y elevarse a premium).

## **2. Autorización — RLS en todas las tablas (desde Sprint 1)**

```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;  -- default deny

CREATE policy leer_products ON products FOR SELECT
  TO authenticated USING (true);

CREATE policy crud_products ON products FOR ALL
  TO authenticated USING (public.is_premium());
```

`is_premium()` es `SECURITY DEFINER` y lee el JWT:

```sql
CREATE FUNCTION public.is_premium() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COALESCE((auth.jwt()->'app_metadata'->>'premium')::boolean, false)
$$;
```

## **3. Lógica de negocio en funciones SQL (pilar 1)**

```sql
REVOKE INSERT, UPDATE, DELETE ON stock, movements FROM authenticated;
GRANT EXECUTE ON FUNCTION registrar_entrada(...) TO authenticated;
```

La función valida (cantidad > 0, stock suficiente, tienda existe), actualiza stock, inserta el movimiento y loguea **en una sola transacción**. Un JWT robado o script trucado no puede inflar stock: el ataque se bloquea en la BD.

## **4. Secretos y servicios externos (n8n)**
- **Service role key NUNCA en el front** (toda variable `VITE_*` de Vite es pública) **ni en n8n**: solo anon key + el JWT del usuario → el RLS protege todo.
- API key de OpenRouter solo en las credenciales de n8n; webhook con rate limit por usuario.
- Google Maps key restringida por HTTP referrer; QR codifica solo IDs, el servidor revalida al escanear.

## **5. Chatbot (CHAT-01/02) — n8n + OpenRouter**
- El webhook de n8n **verifica la firma del JWT** con el JWT secret de Supabase (decodificar sin verificar = no cuenta) y extrae `user_id`/`premium` de `app_metadata` — **nunca del texto del usuario** (anti prompt-injection).
- Cada tool (`get_stock`, `crear_orden`) llama a PostgREST con `Authorization: Bearer <JWT del usuario>` + anon key → **hereda el RLS**; `service_role` prohibido en el workflow.
- El LLM (OpenRouter) decide *qué* llamar, no *a quién* accede; cada consulta queda en `audit_log`.

## **6. Higiene básica**
HTTPS obligatorio, validación Zod en cada formulario, `npm audit` + Dependabot en CI, backups PITR de Supabase, `audit_log` activo desde Sprint 2.

**Requerimientos**

## **Módulo Central: Gestión de Inventario y Productos**

Objetivo: Administrar el catálogo de bienes, su estado físico y su trazabilidad a través de las tiendas asociadas.

1. CRUD de Productos: Capacidad completa para Crear, Leer, Actualizar y Eliminar productos (incluyendo la definición de Unidad de Medida Base).  
2. Gestión de Tiendas: CRUD completo de entidades tiendas, incluyendo la capacidad de registrar su ubicación geográfica (Latitud,Longitud).  
3. Asignación de Productos a Tienda: Mapeo lógico para definir qué productos están disponibles en cada punto de venta específico.  
4. Gestión de Inventario (Transacciones): Registro granular de Entradas y Salidas, obligando la asociación a una entidad tienda y un motivo/origen definido.  
   * Flag de Alerta de Stock: Mecanismo para señalar automáticamente cuando el inventario cae por debajo de un umbral predefinido (punto de pedido).  
5. Trazabilidad y QR: Generación de Códigos de Respuesta Rápida (QR) vinculados a la relación Producto ↔ Tienda, facilitando su escaneo para identificación rápida en campo.  
6. Identificación de Faltantes: Funcionalidad específica para identificar productos que requieren reabastecimiento (Stock \= 0 o Stock < Umbral).

## **Módulo Operacional: Distribuidor y Logística**

Objetivo: Gestionar la entidad comercializadora, sus movimientos de stock asociados a pedidos y optimizar su logística.

1. CRUD de Distribuidores: Gestión completa de las entidades distribuidoras.  
2. Gestión de Pedidos Pendientes (Stock Asignado): Módulo para visualizar qué productos están asignados a un Distribuidor pero aún no han sido movilizados/recibidos en destino.  
3. Ruta del Distribuidor: Funcionalidad para la planificación y visualización geográfica de las rutas, con soporte explícito para integración vía Google Maps API o OpenFleet.  
4. Tipificación de Movimientos (Adicional Clave): Capacidad de diferenciar el tipo de movimiento asociado al pedido: *Venta*, *Reabastecimiento*, *Devolución*.

## **Módulo Interfaz y Servicios Avanzados**

Objetivo: Proveer interfaces interactivas y capacidades avanzadas de consulta.

1. Dashboard Operativo: Vista consolidada que permita monitorear en tiempo real las entradas, salidas y el estado general del inventario agrupado por Distribuidor.  
2. Control de Acceso (Premium): Mecanismo robusto para validar el estatus *Premium* del usuario, aplicando bloqueos a funcionalidades clave (CRUD avanzado, generación masiva de QR, etc.).  
3. Chatbot Inteligente: Implementación de un agente conversacional con capacidades avanzadas:  
   * Validación Robusta de Usuario: Verificación estricta (ej: token de sesión \+ verificación de nivel premium).  
   * Modelo API/Local: Definición clara del método de servicio para ejecutar consultas o acciones.  
   * Capacidad Transaccional: El chatbot debe poder invocar funciones del sistema (Ej: "Consulta el stock de la Tienda X" o "Genera una orden de reabastecimiento").

# **Mejoras de Escalabilidad y Fase II (Roadmap)**

Estos requisitos no son estrictamente necesarios para un MVP funcional, pero son vitales si esperas que el proyecto crezca en volumen o complejidad.

| Requisito | Descripción Detallada | Impacto en la Escalabilidad |
| :---- | :---- | :---- |
| Gestión de Categorías | Creación de una tabla jerárquica para clasificar productos (Ej: Bebidas → Refrescos). | Permite consultas complejas y filtros rápidos en el Dashboard. |
| Historial Detallado (Auditoría) | Registro inmutable de cada evento: Quién, Qué, Cuándo, Por qué. | Esencial para trazabilidad forense; permite auditar discrepancias de inventario con precisión milimétrica. |
| Roles y Permisos (RBAC) | Implementación granular del Control de Acceso basado en Roles (ej: Cliente vs. Gerente vs. Operador). | Facilita la gestión de múltiples usuarios en un entorno corporativo sin sobrecargar el login. |
| Gestión de Precios Dinámicos | Capacidad de aplicar precios variables al mismo producto según el perfil del usuario que consulta (Premium o Standard). | Soporte para diferentes modelos de negocio (Ej: Descuento especial a distribuidores). |
| Notificaciones Proactivas | Sistema de event listeners que dispara alertas automáticas cuando se cumple una condición, incluso sin interacción del usuario. | Mejora drásticamente la usabilidad al avisar antes de que el problema sea grave (Ej: "Stock en 3 días \= Bajo"). |
| Gestión de Proveedores Externos | Entidad separada para registrar a los proveedores primarios que alimentan a los distribuidores. | Separa la cadena de suministro interna (Distribuidor→Tienda) de la externa (Proveedor→Distribuidor). |

# **Planificación del Proyecto: 2 Meses (8 Semanas / 4 Sprints)**

## ***Mapeo General de Requisitos***

| Área Principal | ID Requisito | Descripción Detallada | Prioridad MVP |
| ----- | ----- | ----- | ----- |
| Inventario | INV-01 | CRUD Productos (incluye Unidad de Medida Base). | Alta (S2) |
| Inventario | INV-02 | CRUD Tiendas y Geolocalización (Lat/Lng). | Alta (S1) |
| Inventario | INV-03 | Asignación Producto →Tienda. | Media (S2) |
| Inventario | INV-04 | Registro de Entradas y Salidas (con asociación). | Alta (S2) |
| Inventario | INV-05 | Generación QR / Código para Producto/Tienda. | Media (S3) |
| Inventario | INV-06 | Detección de "Productos Faltantes" (Regla clara). | Alta (S2) |
| Distribuidor | DIST-01 | CRUD Distribuidor. | Alta (S1) |
| Distribuidor | DIST-02 | Módulo de Pedidos: Gestión y Estado del Ciclo de Vida (Ej: Pendiente → Recibido). | Alta (S3) |
| Distribuidor | DIST-03 | Ruta Logística con integración Mapas/OpenFleet. | Media (S3) |
| Interacción | INT-01 | Dashboard (Entradas/Salidas por Distribuidor). | Alta (S3) |
| Seguridad | SEC-01 | Bloqueo de Acciones basado en Rol Premium. | Alta (S2) |
| Chatbot | CHAT-01 | Chatbot: Verificación robusta de usuario y enlace a su información. | Media (S4) |
| Chatbot | CHAT-02 | Chatbot: Capacidad de realizar consultas/acciones sobre la información del usuario. | Alta (S4) |

## **Cronograma Detallado por Sprint**

### ***SPRINT 1: Cimientos y Estructura (Semanas 1 \- 2\)***

Objetivo: Tener el esqueleto funcional. Guardar, leer y definir quién eres.

* Tareas Clave: Configuración de Infraestructura, Creación de DB Schema, CRUD Tiendas & Productos.  
* Requisitos a Finalizar: INV-01,INV-02,DIST-01.  
* Entregable (Demo): Poder ingresar datos en el sistema y verlos listados correctamente por tipo de entidad.

### ***SPRINT 2: Flujo Operativo Core (Semanas 3 \- 4\)***

Objetivo: El sistema debe registrar un evento de negocio real. ¡Ya estamos moviendo stock\!

* Tareas Clave: Implementar Transacciones (INV-04), Mapeo Inv→Tienda, y definir la regla del Poco Stock (INV-06).  
* Requisitos a Finalizar: INV-03,INV-04,INV-06.  
* Entregable (Demo): Registrar una entrada de producto, ver cómo el stock de esa tienda se actualiza y que un flag aparece si baja bajo el umbral.

### ***SPRINT 3: Logística e Interfaz (Semanas 5 \- 6\)***

Objetivo: El sistema es usable por los usuarios finales. ¡Pueden ver dónde están las cosas\!

* Tareas Clave: Implementar la lógica de Pedidos (DIST-02), integrar el mapa (DIST-03) y construir el Dashboard inicial (INT-01).  
* Requisitos a Finalizar: INV-05,SEC-01,DIST-02,DIST-03,INT-01.  
* Entregable (Demo): Un usuario puede ver el dashboard, hacer clic en un distribuidor y ver su ruta marcada en Google Maps.

### ***SPRINT 4: Inteligencia y Refinamiento (Semanas 7 \- 8\)***

Objetivo: Añadir la capa de valor añadido y pulir la experiencia. ¡Estamos listos para el lanzamiento\!

* Tareas Clave: Desarrollo del Chatbot (CHAT-01,CHAT-02), cerrar brechas como el Historial Transaccional (Log) y Categorías.  
* Requisitos a Finalizar: CHAT-01,CHAT-02, Refinamiento de Logs/Cat..  
* Entregable (Demo): Un usuario premium puede iniciar sesión, preguntar al bot sobre el estado de un pedido específico y ver la ruta asociada en tiempo real desde el dashboard.

## Roadmap de Escalabilidad (Post-MVP \- Si hay más tiempo)

Si cumples los 8 sprints a tiempo, usa este camino para ir construyendo la V2.0:

| Fase | Enfoque Principal | Requisitos a Priorizar |
| ----- | ----- | ----- |
| Fase II | Robustez y Análisis | Historial de Transacciones (Log), Categorías de Productos, Tipos de Movimiento (Venta/Devolución). |
| Fase III | Experiencia Avanzada | Precios Dinámicos por Usuario, Notificaciones Proactivas en tiempo real. |
| Fase IV | Expansión y Gestión Completa | Roles de Acceso Granulares (RBAC), Módulo de Proveedores Externos. |

