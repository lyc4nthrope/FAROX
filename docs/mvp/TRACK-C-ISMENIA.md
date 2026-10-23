# Track C — Ismenia

> **Alcance:** pedidos y entregas (DIST-02), dashboard (INT-01), pruebas E2E (H1–H4), manual de usuario, informe final y ensayo de la demo.
> **Antes de empezar:** leer `docs/mvp/PLAN.md` §0–§6. Patrón a copiar: `src/features/stores` (escritura por RPC) y `src/features/distributors` (listados).
> **Datos para probar:** mientras B4/B5 no estén, pedirle a Daniel que cargue por SQL editor stock de prueba en una tienda (asignaciones con `assign_product_to_store`).

| ID | Tarea | Día | Depende de | Estado |
|---|---|---|---|---|
| C1 | Pedidos: api + listado por rol | 1–2 | — | ⬜ |
| C2 | Crear pedido | 2–3 | C1 | ⬜ |
| C3 | Detalle de pedido + cambios de estado | 3 | C2 | ⬜ |
| C4 | Confirmar entrega (incluye parcial) | 4 | C3 | ⬜ |
| C5 | Dashboard + realtime | 5–6 | C4, B6 (regla de realtime) | ⬜ |
| C6 | Playwright: H1–H4 | 6–8 | C5, A4, A7 | ⬜ |
| C7 | Manual de usuario | 8–9 | C6 | ⬜ |
| C8 | Informe final + ensayo de demo ×2 | 10 | todo | ⬜ |

---

## C1 — Pedidos: api + listado por rol (DIST-02)

- **Archivos:** `src/features/orders/{types.ts,schemas.ts,api.ts,components/,routes/OrdersPage.tsx,index.ts}` + pruebas; `router.tsx`, `navigation.ts`, `check-scope.mjs`.
- **Pasos:**
  1. `check-scope`: quitar la tabla `orders` (las RPC se quitan en C2–C4 cuando se usan).
  2. `fetchOrders(query, filtros)`: `orders` con `id,status,expected_at,delivered_at,created_at,store:stores(name),distributor:distributors(name)`, `count: 'planned'`, `range`, orden `created_at desc`, filtro por `status`. La RLS ya devuelve solo lo visible por rol.
  3. `/orders` para admin, operador y distribuidor (para el distribuidor es **"Mis pedidos"**; la entrada de navegación la agrega A7). Pestañas por estado: Pendientes · En ruta · Entregados · Cancelados.
  4. Formato: código `#<id>`, fechas en `es-CO`, estado con etiqueta en español (`pending` Pendiente, `in_route` En ruta, `delivered` Entregado, `cancelled` Cancelado).
- **Pruebas:** columnas pedidas; filtro por estado; render por rol; estados vacío/error.
- **Commit:** `feat(front): orders list by role`

## C2 — Crear pedido

- **Pasos:**
  1. `check-scope`: quitar `create_order`.
  2. `/orders/new` (admin y operador con alcance): tienda (sus tiendas; admin todas) → distribuidor activo → productos (buscador de productos activos) con cantidad (decimales permitidos, > 0, sin repetidos) → fecha prometida opcional → notas.
  3. Envío: `create_order(p_distributor, p_store, p_items, p_expected_at, p_notes)` con `p_items = [{"product_id": 1, "quantity": 24}, …]` (formato verificado en 0004: `jsonb_to_recordset(p_items) AS x(product_id bigint, quantity numeric)`).
  4. zod: al menos 1 línea, sin productos repetidos, cantidades > 0.
  5. `mapError`: producto repetido, entidad inactiva, tienda fuera de alcance.
- **Pruebas:** `p_items` exacto; validaciones de zod; error de la RPC mostrado amigable; redirección al detalle con el id devuelto.
- **Commit:** `feat(front): create orders`

## C3 — Detalle de pedido + cambios de estado

- **Pasos:**
  1. `check-scope`: quitar `get_order_items`, `update_order_status`.
  2. `/orders/:id`: cabecera (tienda, distribuidor, estado, fechas, notas) + líneas con `get_order_items(p_order)` (para no Premium la RPC **omite** `unit_price`: mostrar la columna Precio solo si viene).
  3. Acciones según estado y rol (la BD igual valida):
     - `pending → in_route`: admin/operador → `update_order_status(p_order, 'in_route')`.
     - Cancelar: **solo admin**, con motivo obligatorio → `update_order_status(p_order, 'cancelled', p_reason)`.
     - `delivered` **no** se pone por aquí (es C4).
  4. Espacio reservado para el bloque "Fiado" que agrega B8 en pedidos entregados.
- **Pruebas:** columna precio presente/ausente según respuesta; botones por rol y estado; cancelar sin motivo deshabilitado.
- **Commit:** `feat(front): order detail and status changes`

## C4 — Confirmar entrega (parcial incluida)

- **Pasos:**
  1. `check-scope`: quitar `confirm_delivery`.
  2. En el detalle, para pedidos `pending` o `in_route`: "Confirmar entrega" (distribuidor de ese pedido u operador de la tienda) → formulario con cada línea y su **cantidad recibida** (por defecto = pedida; mínimo 0; máximo = pedida).
  3. Envío: `confirm_delivery(p_order, p_items)` con `p_items = [{"product_id": 1, "received_quantity": 20}, …]`.
  4. Resultado: pedido `delivered`; líneas `received` o `partial`; aviso "El stock de la tienda se actualizó".
  5. `mapError`: pedido ya entregado o cancelado, cantidad mayor a la pedida, producto repetido, fuera de alcance.
- **Pruebas:** `p_items` exacto; validación de máximos; doble confirmación muestra error amigable; pgTAP: entrega suma stock, segunda confirmación → error.
- **Commit:** `feat(front): confirm deliveries`

## C5 — Dashboard + realtime (INT-01)

- **Pasos:**
  1. `check-scope`: quitar `get_dashboard` y `dashboard_daily` (la excepción de realtime para `src/features/dashboard/` la agrega B6).
  2. `/dashboard` (admin, operador y distribuidor **con Premium**; sin Premium: pantalla con explicación): rango de fechas (por defecto últimos 30 días, máximo 366) → `get_dashboard(p_from, p_to)`.
  3. Mostrar: tarjetas (entradas, salidas, valor de entradas y de salidas del rango), barras por día (entradas vs salidas), tabla por distribuidor. **Conteos y valores; nunca sumar cantidades de productos distintos.** Antes de dibujar, leer el skill `dataviz`.
  4. Realtime: suscripción a `dashboard_daily` filtrada por el día de hoy y **solo con la pestaña visible**; al recibir un evento, refetch.
- **Pruebas:** rango > 366 días bloqueado en la UI; no Premium ve el bloqueo; suscripción y desuscripción según visibilidad (mock del canal).
- **Commit:** `feat(front): realtime operations dashboard`

## C6 — Playwright: H1–H4 (D3-14)

- **Archivos:** `playwright.config.ts`, `e2e/h1-registro-catalogo.spec.ts`, `e2e/h2-stock.spec.ts`, `e2e/h3-logistica.spec.ts`, `e2e/h4-asistente.spec.ts`, script `npm run e2e`.
- **Pasos:**
  1. Instalar `@playwright/test`; `webServer` = `npm run dev`.
  2. Entorno: cuando exista `supabase/config.toml` (B10) → stack local; mientras tanto, contra producción con **usuarios de prueba dedicados** y solo en ejecución manual (no en CI). Credenciales por variables de entorno, nunca en el repo.
  3. Guiones = PLAN §7. El webhook del asistente se simula con `page.route` en H4 (la integración real la prueba A8).
  4. Emails de confirmación: usar usuarios ya confirmados (o el stack local, sin confirmación).
- **Aceptación:** los 4 escenarios en verde; capturas o video adjuntos al PR.
- **Commit:** `test(e2e): demo scenarios h1-h4`

## C7 — Manual de usuario

- **Archivo:** `docs/manual/MANUAL.md` (español).
- **Contenido:** un capítulo por rol (admin, operador, distribuidor): registro y onboarding, tiendas y mapa, productos, stock y movimientos, alertas, pedidos y entregas, rutas, QR, dashboard, fiado, asistente, perfil y privacidad. Capturas de cada flujo H1–H4 (se pueden tomar de Playwright).
- **Commit:** `docs: add user manual`

## C8 — Informe final + ensayo de demo

- **Informe** (formato PMBOK del curso): alcance cumplido vs requisitos (tabla requisito → pantalla → prueba), cronograma real vs plan, riesgos materializados y respuesta, métricas de calidad (número de pruebas front/pgTAP/E2E, CI en verde), lecciones aprendidas. Anotar el cambio de alcance de INV-05 (QR producto–tienda → tienda↔distribuidor, D42).
- **Demo:** guion H1 → H4 con los usuarios de demo en producción; responsable por escena; plan B (video de H4, código QR manual, refresco manual del dashboard). Dos ensayos completos el jueves 5 nov.
- **Jira:** mantener el tablero con los IDs A*/B*/C* de estos archivos durante todo el proyecto.
