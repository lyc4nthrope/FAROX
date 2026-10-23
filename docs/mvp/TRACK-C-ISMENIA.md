# Track C — Ismenia

> **Alcance:** pedidos y entregas (DIST-02), dashboard (INT-01), pruebas E2E (H1–H4), manual de usuario, informe final y ensayo de la demo.
> **Antes de empezar:** leer `docs/mvp/PLAN.md` §0–§6. Patrón a copiar: `src/features/stores` (escritura por RPC) y `src/features/distributors` (listados).
> **Datos para probar:** mientras B4/B5 no estén, pedirle a Daniel que cargue por SQL editor stock de prueba en una tienda (asignaciones con `assign_product_to_store`).

> **Orden:** primero la Fase 0 (C0.1–C0.6), después las funcionalidades (C1–C8).

| ID | Tarea | Día | Depende de | Estado |
|---|---|---|---|---|
| **C0.1** | Paginación en todas las listas + conteos acotados | 1 | — | ⬜ |
| **C0.2** | "Eliminar" = desactivar (+ reactivar) y formularios de edición seguros | 2 | C0.1 | ⬜ |
| **C0.3** | Errores: `mapError` para 0013, NIT vs nombre, perfil | 2 | — | ⬜ |
| **C0.4** | Roles, categorías, auditoría y límites entre features | 2 | — | ⬜ |
| **C0.5** | Pruebas de la capa `api.ts` (productos, tiendas, catálogos, perfil) | 3 | C0.2 | ⬜ |
| **C0.6** | Política de privacidad alineada con el sistema (Ley 1581) | 3 | — | ⬜ |
| C1 | Pedidos: api + listado por rol | 4 | Fase 0 | ⬜ |
| C2 | Crear pedido | 4–5 | C1 | ⬜ |
| C3 | Detalle de pedido + cambios de estado | 5 | C2 | ⬜ |
| C4 | Confirmar entrega (incluye parcial) | 6 | C3 | ⬜ |
| C5 | Dashboard + realtime | 7 | C4, B6 (regla de realtime) | ⬜ |
| C6 | Playwright: H1–H4 | 8–9 | C5, A4, A7 | ⬜ |
| C7 | Manual de usuario | 9 | C6 | ⬜ |
| C8 | Informe final + ensayo de demo ×2 | 10 | todo | ⬜ |

---

## Fase 0 — Correcciones de la auditoría (hacer primero)

Referencia: `docs/audits/AUDITORIA-2026-10-23.md`. Cada tarea cita los hallazgos (F#) que cierra.

### C0.1 — Paginación en todas las listas (cierra F6, F24-conteos)

- **Archivos:** `src/shared/ui/DataTable/DataTable.tsx` (o un componente nuevo `src/shared/ui/Pagination.tsx`), `src/shared/hooks/useList.ts`, páginas de `users`, `products`, `stores`, `distributors`, `catalogs` + pruebas; `api.ts` de `users` y `distributors`.
- **Pasos:**
  1. Componente de paginación: "Anterior / Siguiente" y "Página X de Y" usando `list.count` (planned) y `list.setPage`; botones deshabilitados en los extremos; accesible (`nav` con `aria-label="Paginación"`).
  2. Conectarlo en **todas** las listas que usan `useList`.
  3. Orden estable: añadir `.order("id")` como segundo criterio después del orden visible (p. ej. `full_name`, `name`).
  4. Conteos sin límite (`users/api.ts` `user_stores`, `distributors/api.ts` `users.distributor_id`): pedir solo los ids de la página visible (`.in("user_id", ids)` / `.in("distributor_id", ids)`), nunca la tabla completa. `onboarding/api.ts`: tiendas propias con `.limit(1)`.
- **Pruebas:** con `count = 60` aparecen 3 páginas y "Siguiente" pide la página 2; los conteos solo piden los ids de la página.
- **Commit:** `fix(front): paginate every list`

### C0.2 — "Eliminar" = desactivar, y formularios de edición seguros (cierra F7)

- **Archivos:** `ProductFormPage.tsx`, `StoreFormPage.tsx`, `DistributorFormPage.tsx`, sus `api.ts` y listas + pruebas.
- **Pasos:**
  1. Quitar el segundo paso (`DELETE` físico). El botón pasa a llamarse **"Desactivar"** (solo admin) y solo hace `is_active = false`, como dice la regla del proyecto ("eliminar = soft-delete").
  2. Agregar **"Reactivar"** en los registros inactivos (admin) y un filtro "Mostrar inactivos" en las listas.
  3. Borrar las funciones `deleteProduct`/`deleteStore`/`deleteDistributor` que queden sin uso y sus pruebas.
  4. Si el registro no existe (`PGRST116`), mostrar "No se encontró" **sin** el formulario (no un formulario vacío que se pueda enviar).
  5. `StoresPage`: mostrar el aviso de tope solo cuando el usuario ya tiene 1 tienda activa (no Premium) o 3 (Premium).
- **Pruebas:** desactivar llama solo al UPDATE; reactivar vuelve `is_active = true`; un id inexistente no muestra el formulario; aviso de tope con 0 tiendas → no aparece.
- **Commit:** `fix(front): deactivate instead of delete`

### C0.3 — Errores y perfil (cierra F8, F24-perfil, F24-precisión)

- **Archivos:** `src/shared/lib/errors/mapError.ts` + prueba, `src/features/onboarding/routes/OnboardingPage.test.tsx`, `src/features/profile/*`, `src/features/products/schemas.ts`.
- **Pasos:**
  1. `mapError`: textos amigables para los mensajes de 0013 — "ya existe un distribuidor con ese NIT" → "Ya hay un distribuidor registrado con ese NIT. Si es tu empresa, contactá al administrador."; "ya tenés un distribuidor asociado"; "ya registraste un distribuidor (1 por usuario)"; "usuario inactivo" → "Tu cuenta está desactivada."; "ubicación requerida" → "Elegí la ubicación de la tienda en el mapa."; "NIT requerido"; y los de A0.1 si ya están en `main`.
  2. `23505`: distinguir por el nombre de la restricción (`details`/`message` contiene `nit`) → "Ya existe un distribuidor con ese NIT", y dejar "Ya existe un registro con ese nombre" para el resto.
  3. Pruebas de onboarding: simular el error real (código `P0001` con el mensaje de la RPC), no un `23505`.
  4. Perfil: `try/catch` en la carga, estado de carga, guarda de "0 filas" (`.select("id")` → 42501) en `updateMyProfile`, y errores por `mapError`.
  5. `products/schemas.ts`: `base_quantity` con máximo 3 decimales y menor que 1.000.000.000 (como la columna `numeric(12,3)`).
- **Commit:** `fix(front): friendly errors for registration and profile`

### C0.4 — Roles, categorías, auditoría y límites entre features (cierra F9, F21, F24-categorías, F24-auditoría)

- **Pasos:**
  1. **Roles:** quitar "Nuevo rol" (los 3 roles son fijos del sistema). Cada fila enlaza a su edición, y en la edición solo se cambia la **descripción** (el nombre se muestra de solo lectura). Un id inexistente → "No se encontró", sin formulario.
  2. **Categorías:** el selector de categoría padre excluye la propia categoría y **todos sus descendientes** (evita ciclos).
  3. **Auditoría:** si "Cargar más" falla, mantener las filas ya cargadas y mostrar el error debajo con "Reintentar"; descartar respuestas de un filtro anterior (contador de secuencia); mostrar el nombre del actor (no el uuid truncado); fechas con `es-CO`.
  4. **Límites entre features:** mover `ROLE_NAMES`, `RoleName`, `normalizeRole` y `roleLabel` a `src/shared/lib/auth/roles.ts`, y el esquema de perfil compartido a `src/shared/lib/profile/`; `users` y `roles` dejan de importar `../auth`, `../profile` y `app/shell`. Unificar `UserProfileForm` y `ProfileForm` en un componente de `shared/ui` si queda idéntico.
  5. Restaurar los `vi.spyOn(window, "confirm")` en `afterEach` (`vi.restoreAllMocks()`).
- **Commit:** `fix(front): roles, categories and audit correctness`

### C0.5 — Pruebas de la capa `api.ts` (cierra F14)

- **Archivos:** `src/features/{products,stores,catalogs,profile}/api.test.ts` (copiar el patrón de `src/features/users/api.test.ts`).
- **Casos mínimos por archivo:** columnas exactas pedidas, `range` y `count: 'planned'`; parámetros exactos de cada RPC (`create_store`: `p_store_type_id` elegido y `p_location` con lng primero); cada UPDATE con `.select("id")` y "0 filas" → error `42501`; errores crudos devueltos tal cual (los traduce `mapError`).
- **Aceptación:** cobertura de líneas de esos 4 archivos ≥ 90 %; las mutaciones M7 (quitar la guarda de "0 filas" en `products/api.ts`) y M8 (fijar `p_store_type_id`) hacen fallar alguna prueba (probarlo localmente y pegar el resultado en el PR).
- **Commit:** `test(front): cover data access layer`

### C0.6 — Política de privacidad alineada con el sistema (cierra F13)

- **Archivo:** `src/features/legal/privacyContent.ts` (+ su prueba), `src/shared/lib/legal/privacyVersion.ts`.
- **Pasos:**
  1. Quitar la promesa de "eliminar la cuenta": describir lo que el sistema hace (el titular pide la supresión al administrador; el admin desactiva la cuenta y anonimiza nombre, teléfono y email por SQL; los registros de auditoría se conservan por obligación de trazabilidad durante el plazo definido).
  2. Base legal según Ley 1581: autorización previa, expresa e informada (quitar "interés legítimo"); lista completa de derechos del art. 8; transferencia internacional (Supabase) con la región real que confirme Daniel; fecha de vigencia y plazos de respuesta (10 días hábiles para consultas y 15 para reclamos).
  3. Subir la versión de la política (el registro guarda la versión aceptada).
  4. Revisión del equipo antes del merge (es un texto legal).
- **Commit:** `docs(legal): align privacy policy with system behavior`

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
