# FARØX — Plan del MVP (v4, estado real)

> **Para quién:** los tres integrantes y sus agentes de IA.
> Este archivo tiene lo **común**: estado real, decisiones, convenciones, calidad, calendario y demo.
> El trabajo está **dividido en 3**, un archivo autocontenido por persona:
>
> | Track | Responsable | Archivo | Alcance |
> |---|---|---|---|
> | **A** | Cristhian | [`TRACK-A-CRISTHIAN.md`](TRACK-A-CRISTHIAN.md) | Asistente (Edge Function), rutas y mapa, QR tienda↔distribuidor, vistas del distribuidor, pasada de seguridad |
> | **B** | Daniel | [`TRACK-B-DANIEL.md`](TRACK-B-DANIEL.md) | DevOps y BD (estado remoto, baseline, pgTAP, despliegue), inventario, alertas, precios, fiado |
> | **C** | Ismenia | [`TRACK-C-ISMENIA.md`](TRACK-C-ISMENIA.md) | Pedidos y entregas, dashboard, pruebas E2E, manual, informe y demo |
>
> **Cómo se usa:** cada persona le pasa a su agente este archivo (secciones 0–6) + su archivo de track, y ejecuta las tareas en orden.

| Campo | Valor |
|---|---|
| Versión | 4.0 — 2026-11-12 (estado real; reemplaza el plan del 23 oct) |
| Plan original | 3.1 — 2026-10-23 (v3 + **Fase 0: correcciones de la auditoría**) — histórico |
| Entrega | **Demo final: viernes 2026-11-06** (plan original; la ejecución siguió después) · congelamiento: **miércoles 2026-11-04, 23:59** |
| Días hábiles restantes | — (plan original vencido; ver estado real) |

### Estado real al 2026-11-12 (autoritativo)

> El plan original es del 23-24 oct. Desde entonces el trabajo se ejecutó integrado y la arquitectura del asistente cambió: **n8n fue reemplazado por Edge Functions** (`agent` + `whatsapp-webhook`). Las secciones §3.2, §3.3, §6 y §7 se conservan como registro histórico; lo que sigue describe lo que existe hoy y lo que falta.

**Producto:** MVP funcional desplegado en Azure Static Web Apps, con Supabase como backend. Los 52 archivos de migración llegan hasta `20261113021000_agent_wrappers_volatile.sql`; el historial remoto está baselineado hasta 0051 y 0052 queda pendiente de aplicar.

| Área | Estado | Qué existe |
|---|---|---|
| Auth, roles y onboarding | ✅ | Registro con consentimiento versionado, callback, guards de rol, último admin, onboarding por rol |
| Catálogo y tiendas | ✅ | Productos, tiendas con mapa, distribuidores, catálogos, soft-delete/reactivación, auditoría |
| Inventario | ✅ | Stock por tienda, umbral, entradas/salidas, reversos, movimientos masivos |
| Alertas | 🟡 | Listado y marcar leída; **sin realtime** (solo dashboard) |
| Precios | ✅ | Precios por tienda/distribuidor, carga masiva, autollenado, margen y costo manual |
| Pedidos y entregas | ✅ | Crear, listar por rol, estados, entrega total/parcial, precio congelado |
| Rutas | ✅ | Planificación admin, mi ruta, paradas, mapa y Google Maps |
| Fiado | ✅ | Créditos, pagos, reversos y anulación (bajo `orders`) |
| Dashboard | ✅ | `get_dashboard`, gráficos y **realtime** con `dashboard_daily` |
| QR tienda↔distribuidor | ✅ | Código a demanda, regenerar, desvincular, escáner; **QR masivo Premium** aparece como "Próximamente" (sin implementar) |
| Asistente | ✅ | Edge Function `agent` (lectura + borradores), `agent_actions`, WhatsApp con `CONFIRMAR <code>`; precios solo web |
| Teléfono verificado | ✅ | `phone_verifications`, E.164, único por cuenta, verificación por WhatsApp |
| Límites y egreso | ✅ | Topes de texto/jsonb, rate limit de chat, batching del dashboard, egreso de chat |
| Legal | 🟡 | Política publicada, pero C0.6 sigue pendiente: "interés legítimo" y promesa de eliminación de cuenta sin flujo real |
| Despliegue | ✅ | `deploy-front.yml`, `public/staticwebapp.config.json` con `navigationFallback` |
| Backup | 🟡 | Workflow listo, pero `schedule` desactivado y sin cifrado `age` |
| pgTAP | ❌ | No existe `supabase/tests/`; la cobertura de BD es `scripts/smoke-local.mjs` |
| E2E | ❌ | No hay Playwright, ni `e2e/`, ni dependencia |
| Manual | 🟡 | `docs/manual/USO-POR-ROL.md` (98 líneas) es una guía rápida, no el manual C7 |
| Informe final | 🟡 | `docs/informe/INFORME-DE-DESARROLLO.md` existe con corte al 26 oct; no cubre el último mes |

**Pendientes reales, en orden de impacto:**

1. **C6 — Playwright H1-H4.** No hay nada; `smoke-local.mjs` cubre H1-H3 + QR + fiado a nivel RPC, no UI.
2. **B3 — Harness pgTAP.** Sin `supabase/tests/`; las invariantes de BD no tienen prueba automatizada por RPC.
3. **C0.5 — Tests de `api.ts`.** Faltan `stores`, `catalogs` y `profile`; `products` solo tiene paginación.
4. **C0.6 — Privacidad.** Quitar "interés legítimo", alinear la eliminación de cuenta con lo que el sistema hace y subir `PRIVACY_VERSION` (hoy 1.1).
5. **C7 — Manual.** Completar `docs/manual/MANUAL.md` con un capítulo por rol y capturas.
6. **C8 — Informe final.** Actualizar el corte al 12 nov e incluir asistente, precios, teléfono, límites y WhatsApp.
7. **Realtime de alertas.** El dashboard ya se suscribe; `/alertas` no.
8. **A0.4/F11.** Los inputs de lat/lng solo aparecen si falla Leaflet; el plan pedía que estuvieran siempre visibles.
9. **Backup.** Cifrar con `age`, mover secretos a los pasos y reactivar el `schedule` (B0.4).
10. **Documentación.** `supabase/README.md` y `Base de datos FAROX.md` quedaron actualizados con el índice 0013-0051; `.atl/skill-registry.md` sigue con rutas absolutas de una máquina.
11. **C0.4 — Ciclos de categorías.** El picker de categoría padre solo excluye la propia fila; falta excluir sus descendientes.

**Arquitectura vigente del asistente (reemplaza A1-A4 y A8 del Track A):**

| Pieza | Qué hace |
|---|---|
| `supabase/functions/agent` | Endpoint único con JWT; proveedor compatible con OpenAI; tools de lectura y de borrador |
| `supabase/functions/whatsapp-webhook` | Verifica `x-hub-signature-256`, resuelve al usuario por teléfono verificado y responde `CONFIRMAR <code>` |
| `agent_actions` | Borradores con expiración, ejecución única y `confirmation_code` para WhatsApp |
| `chat_conversations` / `chat_messages` | Persistencia del hilo; el navegador escribe solo `user`; `assistant`/`tool` los inserta la Edge Function con `service_role` **después** de validar el JWT |
| `phone_verifications` | Código hasheado, expiración, intentos y unicidad del teléfono verificado |

**Reglas que cambiaron:** el asistente no usa n8n; `service_role` vive solo en las Edge Functions (nunca en `src/`); las escrituras son borradores y requieren confirmación humana; los precios se cambian solo en la web; WhatsApp exige teléfono verificado y código de confirmación.

### Estado integrado al 2026-10-24 (histórico — no usar para planificar)

Desde el 24 oct el trabajo se ejecuta **integrado** (sin dividir en 3): se avanza en orden sobre esta lista única. Los archivos de track quedan como detalle técnico de cada tarea.

| Estado | Tarea | Qué quedó |
|---|---|---|
| ✅ | B0.1 · 0011 corregida | `session_user` sin paréntesis (Daniel, `45d00ea`) |
| ✅ | A0.1 BD · migración 0015 | guards de `register_distributor` y último admin (Daniel, `45d00ea`) — **falta aplicarla en producción** |
| ✅ | A0.1 front | admin y distribuidor no pasan por el onboarding; el "Entendido" sobrevive a remontajes |
| ✅ | C0.3 (parte) | `mapError` traduce los errores de negocio de todas las RPC (NIT duplicado, stock insuficiente, sin precio, premium, etc.) |
| ✅ | B4 + B5 + B7 · Inventario | `/inventario/:tienda`: stock con estado, asignar producto + umbral, entrada/salida con motivo y vencimiento, reverso (admin), precios (admin) |
| ✅ | B6 · Alertas | `/alertas`: abiertas + marcar leída (sin realtime todavía) |
| ✅ | C1–C4 · Pedidos | `/pedidos`, `/pedidos/nuevo`, `/pedidos/:id`: listar por rol, crear, en ruta, cancelar (admin), confirmar entrega parcial |
| ✅ | B8 · Fiado | `/fiado` + bloque en pedido entregado: crear crédito, pagos, reverso, anular |
| ✅ | A6 + A7 · Rutas | `/rutas` (admin planifica), `/rutas/:id`, `/mi-ruta` (distribuidor): paradas, llegada/completar/omitir, enlace a Google Maps |
| ✅ | C5 · Dashboard | `/dashboard`: `get_dashboard` por rango, totales, por distribuidor y por día (sin realtime) |
| ✅ | Migración 0018 · recursión de RLS | `routes`↔`route_stops`↔`stock` en ciclo (42P17): sin esto inventario y rutas fallan para no-admin. Corregida con helpers `SECURITY DEFINER` |
| ✅ | Verificación de punta a punta | `scripts/smoke-local.mjs`: 45/45 flujos (H1–H3 + QR + fiado) en verde contra Supabase local con 0001–0018 |
| ⬜ | **Aplicar 0015, 0017 y 0018 en producción** + verificar con 0012 | Daniel (gate H1). Sin 0018 el inventario y las rutas fallan en producción |
| ⬜ | A1–A4, A8 · Chatbot | migración 0016, n8n en VPS, tools, pantalla |
| ✅ | A5 · QR (INV-05) | migración 0017 (`store_distributors`, `link_code` no legible por SELECT, 4 RPC); `/tiendas/:id/qr` (QR imprimible, regenerar, desvincular) y `/vincular` (distribuidor; el QR abre la URL desde la cámara del celular). Falta: QR masivo Premium |
| ✅ | C0.1 paginación | Anterior/Siguiente en productos, tiendas, distribuidores, usuarios y catálogos |
| ✅ | C0.2 desactivar / reactivar | "Eliminar" ahora es "Desactivar" (soft-delete, sin DELETE físico) y el admin puede **Reactivar** desde el formulario |
| ✅ | C0.4 (parte) roles | sin "Nuevo rol" (los 3 roles son fijos); toda fila enlaza a su edición; el nombre queda bloqueado y se edita la descripción |
| ✅ | A0.3 confirmaciones | cambiar rol, Premium o activar/desactivar un usuario pide confirmación |
| ⬜ | C0.5 pruebas api viejas · C0.6 privacidad · resto de C0.4 (ciclos de categorías, auditoría) | correcciones de la auditoría pendientes |
| ✅ | A0.2 callback y privilegios | `emailRedirectTo` a `/auth/callback`; el callback acepta una sesión ya creada (flujo implícito); un error de red pasajero ya no le quita el rol al usuario. **Daniel:** confirmar en Supabase Auth que la Site URL y las Redirect URLs incluyen `/auth/callback` del dominio de producción |
| ✅ | A0.4 (parte) ubicación | el pin ya no se fija con la ubicación en caché ni con la aproximada por IP: solo con GPS fresco o eligiendo en el mapa (F10) |
| ⬜ | A0.4 resto | coordenadas manuales siempre visibles (F11, teclado), cuota de Nominatim, teselas sin subdominios |
| ⬜ | B0.3–B0.5 · CI, backup, protección de `main`, higiene | correcciones de la auditoría pendientes |
| ⬜ | Realtime (alertas, dashboard) · C6 Playwright · B9 despliegue · C7 manual · C8 informe | cierre |

> **Nota:** varias filas de esta tabla ya se resolvieron (0015 aplicada, asistente implementado, dashboard con realtime, despliegue activo). La fuente de verdad es "Estado real al 2026-11-12".

UI de las pantallas nuevas: intencionalmente simple ("cajas"), con estados de carga/error y textos amigables; el pulido visual queda para el final.

### Jerarquía de documentos

| Tema | Documento autoridad |
|---|---|
| Esquema, tablas, RPC, RLS, decisiones D1–D55 y estado 0013-0051 (§10) | [`Base de datos FAROX.md`](../../Base%20de%20datos%20FAROX.md) |
| Requisitos, matriz de roles, seguridad | [`idea basica proy admin de proys.md`](../../idea%20basica%20proy%20admin%20de%20proys.md) |
| SQL ejecutable y orden de migración | [`supabase/migrations/`](../../supabase/migrations) + [`supabase/README.md`](../../supabase/README.md) |
| Qué se hace, quién, cuándo y cómo se demuestra | **este archivo + los 3 archivos de track** |

---

## 0. Reglas para todos (y para los agentes)

0. **Primero la Fase 0.** Cada track empieza por sus tareas `X0.*` (correcciones de la auditoría). **Ninguna funcionalidad nueva se empieza hasta que la Fase 0 de ese track esté en `main`.** La excepción es B0.1, que es urgente y desbloquea a todos: va antes que todo lo demás.
1. **Una tarea a la vez**, en el orden de tu archivo de track. No empezar una tarea cuyas dependencias no estén en `main`.
2. **No tocar archivos fuera del alcance de la tarea.** Los únicos archivos compartidos que todos editan son los de la §4.4; ahí, cambios mínimos y PR pequeño.
3. **La base de datos manda.** Toda regla de negocio y seguridad vive en Postgres (RLS + RPC). El front llama con el JWT del usuario; las Edge Functions validan ese JWT y confinan `service_role` a `supabase/functions/` (nunca en `src/`; `check-scope` lo bloquea ahí).
4. **Migraciones aplicadas no se editan.** Cambio de esquema = migración nueva con timestamp (`YYYYMMDDHHMMSS`).
5. **Terminado = [Definición de Terminado](#5-definición-de-terminado)**: `npm run ci` en verde, pruebas nuevas, PR revisado por otro integrante.
6. **Si el plan contradice el código o los documentos autoridad: parar y avisar** (Cristhian mantiene el plan; Daniel tiene la última palabra sobre la BD).
7. Al cerrar una tarea, marcarla en tu archivo de track (`⬜ → ✅`) dentro del mismo PR.

### 0.1 Prompt para tu agente

```text
Trabajas en el repositorio FARØX (React + Supabase).
1. Lee docs/mvp/PLAN.md (secciones 0 a 6) y docs/mvp/TRACK-<X>-<NOMBRE>.md.
2. Implementa SOLO la tarea <ID> de tu track. Lee únicamente los archivos y secciones que la tarea cite.
3. Sigue la "receta de slice" de PLAN.md §4 al pie de la letra; copia la estructura de src/features/distributors.
4. Test-first: escribe primero las pruebas que la tarea lista, verifica que fallan, luego implementa.
5. Toda regla de negocio va en la BD. Si la tarea necesita un cambio de BD, sigue §4.2 (doc-first + migración nueva).
6. Ejecuta `npm run ci` y pega la salida. Abre un PR (≤ 400 líneas) con la plantilla de §5.
7. Si algo es ambiguo o contradice el código, DETENTE y repórtalo.
```

---

## 1. Estado real (verificado el 2026-10-23 sobre `main` = `93c6405`)

> **Histórico (23 oct).** El estado vigente está al inicio del documento.

`npm run ci` en verde: **48 archivos de prueba, 432 pruebas**, lint, typecheck y `check-scope` (0 violaciones en 175 archivos).

### 1.1 Hecho

| Área | Qué existe | Dónde |
|---|---|---|
| BD | 25 tablas, 26 RPC + helpers, RLS por rol, jobs, hardening (0001–0012) | `supabase/migrations/` |
| BD | **0013** `registration_hardening`: `create_store` exige ubicación y usuario activo; RPC nueva `register_distributor` (autoregistro, 1 por usuario) — whitelist 31 → 32 | `20261019000013_…` |
| BD | **0014** `user_stores_read`: `GRANT SELECT` en `user_stores` (activa la policy existente) | `20261020000014_…` |
| Front base | Vite 6 + React 19 + TS + Tailwind 4 + React Router 7 + zod + supabase-js, en la **raíz** del repo, con **npm** | `package.json`, `src/` |
| Auth | Login, registro con consentimiento de privacidad versionado, callback de confirmación de email, `RequireAuth`, `RequireRole`, `AuthProvider` | `src/features/auth`, `src/app` |
| Onboarding | Pregunta derivada "¿qué eres?": Distribuidor (`register_distributor`) · Mi tienda (`create_store`) · Trabajo en tienda (espera asignación del admin) | `src/features/onboarding` |
| Catálogo | Productos (CRUD), Tiendas (`create_store` + **mapa Leaflet/OSM**, geolocalización, geocodificación inversa con Nominatim), Distribuidores (CRUD) | `src/features/{products,stores,distributors}` |
| Admin | Usuarios (rol, premium, activo, tiendas), Roles, Catálogos (marcas, categorías, unidades, tipos de tienda, motivos), Auditoría | `src/features/{users,roles,catalogs,audit}` |
| Perfil y legal | Perfil propio, página de privacidad | `src/features/{profile,legal}` |
| Compartido | `useList` (listados paginados), `mapError` (errores amigables), `DataTable`, `EmptyState`, `ErrorBanner`, `LocationPicker` | `src/shared` |
| CI | `ci.yml` (build, lint, typecheck, test, check-scope, `npm audit`), `schema-check.yml` (aplica 0001–0012 en stack fresco + `db lint`), `backup-weekly.yml`, `spike-repair.yml`, Dependabot | `.github/` |
| Docs | Plantilla de email de confirmación, protocolos de spikes U1/U3 | `docs/emails`, `docs/spikes` |

### 1.2 Pendiente (lo que reparten los 3 tracks)

| Requisito | Pendiente | Track |
|---|---|---|
| INV-03/04/06, DIST-04 | Asignar producto↔tienda, entradas/salidas, reverso, alertas | B |
| Precios privados | `set_price` + historial | B |
| Fiado | Créditos y pagos | B |
| DIST-02 | Pedidos: crear, listar por rol, detalle, estados, **confirmar entrega** | C |
| INT-01 | Dashboard (`get_dashboard`) + tiempo real | C |
| DIST-03 | Rutas: planificar (admin), "mi ruta" (distribuidor), mapa, paradas | A |
| INV-05 | QR tienda↔distribuidor (necesita migración **0017**) | A |
| CHAT-01/02 | Chatbot n8n + pantalla (necesita migración **0016**) | A |
| Rol distribuidor | Hoy solo ve Productos: le faltan "Mis pedidos" y "Mi ruta" | A (nav) + C (pedidos) |
| DevOps | Confirmar estado remoto de 0013/0014; `config.toml` + baseline (spike U3); despliegue del front (Azure SWA, spike U1); `schema-check` cubre solo 0001–0012 | B |
| Calidad BD | No hay pruebas automatizadas por RPC (solo los scripts 0008/0012) | B (harness) + cada track (sus RPC) |
| E2E | No hay Playwright | C |
| Cierre | Manual, informe final, ensayo de demo | C |

### 1.3 Deudas detectadas (se resuelven en las tareas indicadas)

| # | Deuda | Evidencia | Tarea |
|---|---|---|---|
| G1 | `send_message()` solo inserta `role='user'`: el bot no puede guardar sus respuestas | `supabase/entities/23_chat_messages.sql` | A1 (migración 0016) |
| G2 | D42 dice que el QR vincula tienda↔distribuidor, pero no hay tabla de vínculo | `Base de datos FAROX.md` §3.9 | A5 (migración 0017) |
| G3 | Contradicción: n8n con `service_role` (doc BD, D48) vs prohibido (requisitos, pilar 3) | ambos docs | Decisión D3-7 |
| G4 | 0013 exigía anotar `Base de datos FAROX.md` §4/§9 antes de aplicarse ("doc-first"), pero el documento no se modificó | `git log` del doc | B0.2 |
| G5 | `schema-check.yml` lista a mano las versiones 0001–0012: no verifica 0013/0014 ni las siguientes | `.github/workflows/schema-check.yml` | B0.3 |
| G6 | `check-scope.mjs` bloquea las RPC/tablas "diferidas": cada slice debe sacarlas de la lista en su PR | `scripts/check-scope.mjs` | todas las slices (§4.1 paso 2) |

### 1.4 Auditoría del 23 oct y Fase 0

La auditoría completa está en [`docs/audits/AUDITORIA-2026-10-23.md`](../audits/AUDITORIA-2026-10-23.md) (hallazgos F1–F24 con evidencia). Resumen de lo que se midió: 432 pruebas en verde, 0 errores de lint y tipos, 0 vulnerabilidades, cobertura de líneas 81,7 %, 6 de 8 mutaciones detectadas. **Pero:**

| Hallazgo | Gravedad | Se corrige en |
|---|---|---|
| F1 La migración 0011 tiene `session_user()` (error de sintaxis): no se aplica en ningún lado; Schema Check 17/17 en rojo | Bloqueante | **B0.1** |
| F2 El admin cae en el onboarding y puede degradarse a distribuidor con un clic | Bloqueante | **A0.1** |
| F3 El backup subiría datos de producción sin cifrar a un repo **público** | Bloqueante (latente) | **B0.4** |
| F4 `main` sin protección: los checks en rojo no bloquean merges | Grave | **B0.4** |
| F5 Autorregistro de distribuidor sin guard de rol y con condición de carrera | Grave | **A0.1** |
| F6 Ninguna lista pagina: desde el registro 26 no se ve nada | Grave | **C0.1** |
| F7 "Eliminar" desactiva y luego borra en dos pasos (deja registros ocultos) | Grave | **C0.2** |
| F8 Errores de 0013 sin traducir (NIT duplicado, etc.) | Grave | **C0.3** |
| F9 Roles: crear/editar nunca funciona | Grave | **C0.4** |
| F10/F11 Ubicación: la caché fija un pin equivocado; sin teclado no se puede ubicar una tienda | Grave | **A0.4** |
| F12 Desactivar/Premium/rol con un clic, sin confirmación ni protección del último admin | Grave | **A0.1** (BD) + **A0.3** (UI) |
| F13 La política de privacidad promete un borrado que el sistema no hace | Grave | **C0.6** |
| F14 Capa `api.ts` de productos, tiendas, catálogos y perfil sin pruebas | Grave | **C0.5** |
| F15 Doc-first de 0013/0014 sin hacer; 0012 fallará por la whitelist | Grave | **B0.2** |
| F16 `schema-check` verifica solo 12 migraciones; parser no reconoce la salida real | Grave | **B0.3** |
| F17 Secretos del backup expuestos a todo el job; entorno sin restricción | Grave | **B0.4** |
| F18 Callback de confirmación de email muestra "link inválido" con sesión válida | Grave | **A0.2** |
| F19–F24 Menores (ack del onboarding, Nominatim, límites entre features, Prettier, `.atl`, varios) | Menor | A0.1, A0.2, A0.4, B0.5, C0.1, C0.3, C0.4 |

---

## 2. Qué es FARØX (resumen)

Web responsive para **tiendas y distribuidores**: qué tiene cada tienda, qué se agota o vence, qué pedidos faltan por entregar y por qué ruta. Roles **admin**, **operador** y **distribuidor**; **Premium** (`users.premium`; admin siempre) habilita movimientos manuales, dashboard analítico, QR masivo y precios en pedidos. Valor agregado: QR de vínculo tienda↔distribuidor, dashboard en tiempo real, fiado y chatbot. Restricciones: Ley 1581 de 2012, código abierto y planes gratuitos.

---

## 3. Decisiones

### 3.1 Vigentes por lo ya construido (no se reabren)

| ID | Decisión | Origen |
|---|---|---|
| D3-1 | Front en la **raíz** del repo, **npm** (`package-lock.json` obligatorio), Node 22 en CI | Daniel, `package.json`, `ci.yml` |
| D3-2 | **Sin TanStack Query**: listados con `useList`; refresco por refetch | Daniel, `useList.ts` (D4) |
| D3-3 | Errores solo vía `mapError()`: el texto crudo del backend nunca llega a la UI | Daniel, `mapError.ts` (D5) |
| D3-4 | Mapas: **Leaflet + teselas OSM + Nominatim** (reemplaza a Google Maps). Las rutas se dibujan como polilínea entre paradas ordenadas + botón "Abrir en Google Maps" (URL con waypoints, sin API key) | Daniel (`src/shared/lib/geo`); extensión para rutas: este plan |
| D3-5 | Un solo proyecto Supabase = producción. Migraciones se aplican por **SQL editor (gate humano H1, lo hace Daniel)** hasta cerrar el baseline (spike U3); después, `supabase db push` | Daniel, encabezado de 0013, spike U3 |
| D3-6 | Front se despliega en **Azure Static Web Apps**, sin entornos de preview (apuntarían a producción) | Daniel, spike U1 |
| D3-8 | `check-scope` como compuerta: lo no habilitado no se puede usar en `src/` | Daniel, `check-scope.mjs` |

### 3.2 Propuestas de este plan (histórico — n8n reemplazado)

> **Actualización 2026-11-12:** D3-7, D3-9 y D3-13 describen n8n. La implementación real usa Edge Functions y está en D3-15…D3-18. Se conservan como registro.

| ID | Decisión | Por qué |
|---|---|---|
| D3-7 | **n8n solo con la anon key + JWT del usuario**; prohibido `service_role` en n8n. El webhook valida el token con `GET {SUPABASE_URL}/auth/v1/user` | La RLS aplica a cada tool; con `service_role` un prompt injection lee todo (resuelve G3) |
| D3-9 | El chatbot **propone** escrituras; solo se ejecutan con el botón **Confirmar** de la UI (n8n relee la propuesta guardada y llama la RPC con el JWT del usuario) | Un prompt injection no puede crear pedidos |
| D3-10 | Vínculo QR: tabla `store_distributors` + `stores.link_code` aleatorio; el QR lleva `https://<app>/vincular/<code>`, nunca el `store_id` | Sin tabla, D42 no hace nada; un id adivinable permite vincularse a cualquier tienda |
| D3-11 | **Realtime permitido solo** en `alerts` y `dashboard_daily`, suscrito solo con la pestaña visible; `check-scope` se ajusta para permitir `.channel(` únicamente en esos dos módulos | Requisito INT-01 sin abrir la puerta a suscripciones en todo el front |
| D3-12 | **Pruebas pgTAP** de las RPC que usa cada slice (flujo feliz + 2 negativos mínimo), con el harness que entrega B | Hoy no hay prueba automatizada de la BD por RPC |
| D3-13 | n8n se aloja en un **VPS** con Docker Compose + Caddy (HTTPS) | El acta incluye VPS; Azure SWA solo sirve estáticos |
| D3-14 | E2E con **Playwright** para H1–H4; corre contra el stack local cuando exista `config.toml` (B10); mientras tanto, contra el proyecto de producción con usuarios de prueba y solo en ejecución manual | Prueba de punta a punta sin tocar datos reales en CI |

### 3.2.1 Decisiones vigentes (2026-11-12)

| ID | Decisión | Por qué |
|---|---|---|
| D3-15 | **Asistente = Edge Functions** `agent` + `whatsapp-webhook`: JWT del usuario, proveedor compatible con OpenAI, tools de lectura y borradores; sin n8n | Reemplaza D3-7/D3-9/D3-13. Menos infraestructura, mismo aislamiento por RLS y un solo despliegue |
| D3-16 | **Escrituras = borradores** en `agent_actions` + confirmación humana; WhatsApp exige `CONFIRMAR <code>`; `price_update` solo web | Un prompt injection no escribe solo. El código de WhatsApp evita confirmar por error desde otro chat |
| D3-17 | **Identidad de WhatsApp = teléfono verificado** (`phone_verified_at`), no auto-declarado | Sin verificación, cualquiera que escriba al número opera como otra cuenta |
| D3-18 | **Migraciones por timestamp** desde 0019; 0015-0017 son históricas y 0016 nunca se creó | Evita choques entre ramas; el esquema vigente es `supabase/migrations/` hasta 0051 |

### 3.3 Números de migración reservados (histórico)

> Los números 0015-0017 se usaron (0016 nunca se creó). Desde 0019 se numera con timestamp. La lista vigente es `supabase/migrations/`.

| Número | Contenido | Track |
|---|---|---|
| (0011, 0012) | Se **corrigen en el mismo archivo** (B0.1): nunca se pudieron aplicar en ningún lado por el error de sintaxis, así que no hay historia que romper. Única excepción a la regla 4 | B |
| 0015 | `registration_guards` — guard de rol y `FOR UPDATE` en `register_distributor`, protección del último admin | A (A0.1) |
| 0016 | `append_chat_reply()` — respuestas del bot | A (A1) |
| 0017 | `store_distributors` + `link_code` + RPC de vínculo | A (A5) |
| 0018+ | Correcciones que encuentren las pruebas pgTAP | Pedir el número en el canal del equipo antes de crear el archivo |

---

## 4. Cómo se construye una slice (receta obligatoria)

Patrón de referencia: **`src/features/distributors`** (CRUD por tabla) y **`src/features/stores`** (escritura por RPC).

### 4.1 Pasos

1. **Leer** en `Base de datos FAROX.md` las tablas y RPC de la slice, y la fila de la matriz de roles en `idea basica…`.
2. **`check-scope`**: en el mismo PR, quitar de `DEFERRED_RPCS` / `DEFERRED_TABLES` exactamente las RPC y tablas que la slice empieza a usar (y nada más).
3. **Estructura** `src/features/<feature>/`:
   - `types.ts` — tipos de filas y enums (las features **no se importan entre sí**; si dos necesitan el mismo enum, se duplica a propósito, como `contact_preference`).
   - `schemas.ts` — zod para formularios.
   - `api.ts` — única capa que importa `supabase`: columnas explícitas, `count: 'planned'` + `.range()` en listados, escrituras sensibles solo por `supabase.rpc()`, guarda de "0 filas afectadas" → error `42501` en UPDATE/DELETE por tabla, errores **crudos** hacia arriba (los traduce `mapError`).
   - `components/` (presentacionales: reciben props) y `routes/` (páginas: usan `useList` y la `api`).
   - `index.ts` — exporta solo las páginas.
4. **Errores**: agregar a `mapError.ts` los mensajes nuevos de `RAISE EXCEPTION` de las RPC de la slice (por substring) con su prueba en `mapError.test.ts`.
5. **Rutas y navegación**: registrar en `src/app/router.tsx` con `RequireRole`; agregar la entrada en `navigation.ts` con su visibilidad por rol; actualizar `router.test.tsx` y `navigation.test.ts`.
6. **Pruebas del front**: `api.test.ts` (supabase simulado: columnas pedidas, parámetros de la RPC, mapeo de errores) y una prueba por página (render por rol, estados de carga/vacío/error, envío del formulario, error de la RPC mostrado con texto amigable).
7. **Pruebas de BD (D3-12)**: un archivo pgTAP por RPC usada: flujo feliz + rol no permitido + regla de negocio propia. Hasta que exista el harness (B3), la prueba se reemplaza por `scripts/smoke-local.mjs` contra el stack local (H1-H3 + QR + fiado) y el resultado pegado en el PR.
8. `npm run ci` en verde → PR → revisión de otro integrante → merge.

### 4.2 Si la slice necesita cambiar la BD

1. **Doc-first**: anotar el cambio en `Base de datos FAROX.md` (§3/§4/§9 y registro de decisiones) en el mismo PR.
2. Migración nueva con timestamp (`YYYYMMDDHHMMSS`), encabezado como el de 0013 (qué hace, por qué, contrato), `SECURITY DEFINER` + `SET search_path = pg_catalog, public`, `GRANT EXECUTE` explícito solo a `authenticated` (deny-by-default, D48), guard `assert_admin()` si es solo-admin, bloque `-- INVERSE:` **comentado**.
3. Actualizar la lista de la whitelist donde se verifique (0012/pgTAP) y `schema-check` (B0.3 lo vuelve automático).
4. **Aplicación al remoto** después del merge; luego correr `schema-check` y `scripts/smoke-local.mjs`, y pegar el resultado en el PR. `0012_verify_hardening.sql` solo cubre el baseline 0009-0012; no re-ejecutar 0011 después de 0013/0015/0017 (revoca grants de las funciones nuevas).

### 4.3 UI

- Mobile-first, objetivos táctiles ≥ 44 px, etiquetas en todos los campos, navegable con teclado.
- Estados de carga, vacío y error en cada lista y página.
- Acciones que el rol o Premium no permiten: **deshabilitadas con explicación** (la BD igual las rechaza).
- Al cerrar cada pantalla: checklists `web-design-guidelines` y `antislop-ui`.

### 4.4 Archivos compartidos (todos los tracks los tocan)

`src/app/router.tsx`, `src/app/shell/navigation.ts`, `src/shared/lib/errors/mapError.ts`, `scripts/check-scope.mjs`, `Base de datos FAROX.md`. Regla: cambios mínimos, PR chico, **rebase sobre `main` antes de pedir revisión** y avisar en el canal al fusionar.

---

## 5. Definición de Terminado

- [ ] Criterios de aceptación de la tarea cumplidos.
- [ ] Pruebas nuevas (front y, si usa RPC, pgTAP o smoke) en verde.
- [ ] `npm run ci` en verde local y en CI (y `schema-check` si tocó BD).
- [ ] `check-scope` actualizado solo con lo que la slice habilita.
- [ ] Si tocó BD: doc-first, migración nueva, aplicada al remoto y verificada con `schema-check` + `scripts/smoke-local.mjs` (`0012_verify_hardening.sql` solo cubre 0009-0012).
- [ ] Sin secretos ni datos personales en código, logs o fixtures.
- [ ] Revisado y aprobado por otro integrante; tarea marcada ✅ en su track.

Plantilla de PR:

```markdown
## Tarea
Track X · ID: __ · Jira: FAROX-__

## Qué cambió
-

## Cómo se verificó
- [ ] `npm run ci` (salida abajo)
- [ ] pgTAP o smoke SQL de las RPC usadas
- [ ] Probado en el navegador con el rol correspondiente

## Checklist
- [ ] check-scope: solo lo que esta slice habilita
- [ ] mapError con los errores nuevos
- [ ] Doc de BD actualizado (si aplica)
```

---

## 6. Calendario (histórico)

> **Planificado, no real.** El calendario original (23 oct → 6 nov) no refleja la ejecución: el trabajo siguió después del 6 nov con el asistente, precios, teléfono y límites. Ver "Estado real al 2026-11-12".

Sincronización diaria de 15 minutos: qué se fusionó, qué está bloqueado. Detalle de cada tarea en su archivo de track.

| Día | Fecha | A — Cristhian | B — Daniel | C — Ismenia |
|---|---|---|---|---|
| 1 | vie 23 oct | **A0.1** migración 0015 (guards) + gate del admin | **B0.1** arreglar 0011 + estado remoto · **B0.2** doc-first | **C0.1** paginación |
| 2 | lun 26 oct | **A0.2** callback de Auth + privilegios · **A0.3** confirmaciones | **B0.3** schema-check · **B0.4** proteger `main` + backup | **C0.2** eliminar = desactivar · **C0.3** errores · **C0.4** roles |
| 3 | mar 27 oct | **A0.4** ubicación y Nominatim · A1 migración 0016 | **B0.5** higiene + Prettier · B3 harness pgTAP | **C0.5** pruebas de `api.ts` · **C0.6** política de privacidad |
| 4 | mié 28 oct | A2 n8n en VPS + webhook seguro | B4 inventario: asignar producto + umbral | C1 pedidos: api + listado · C2 crear pedido |
| 5 | jue 29 oct | A3 tools + propuestas · A4 pantalla de chat | B5 movimientos (entrada/salida/reverso) | C2 (cont.) · C3 detalle + estados |
| 6 | vie 30 oct | A4 (cont.) · A5 migración 0017 + QR + escáner | B6 alertas + realtime · B7 precios | C4 confirmar entrega (parcial) |
| 7 | lun 2 nov | A6 rutas (admin) · A7 mi ruta + nav del distribuidor | B8 fiado · B9 despliegue del front | C5 dashboard + realtime |
| 8 | mar 3 nov | A7 (cont.) · A8 pruebas de seguridad del chatbot | B9 (cont.) · pgTAP de B4–B8 | C6 Playwright H1–H4 |
| 9 | mié 4 nov | A9 pasada de seguridad · **congelamiento 23:59** | B10 baseline + aplicar todo al remoto + verificación | C6 (cont.) · C7 manual |
| 10 | jue 5 nov | Corrección de defectos · ensayo | Verificación final en producción · ensayo | C8 informe final · **ensayo ×2** |
| — | **vie 6 nov** | **Demo final** | | |

**Ruta crítica:** B0.1 → B0.4 (protección de `main`) → A0.1 → (A1, B4) → C2 → C4 → C5 → A3 → A4 → C6 → B10. Se revisa primero cada día.

**Si vamos tarde, se recorta en este orden (las pruebas y la Fase 0 no se recortan):** (1) fiado en UI (B8; queda en BD), (2) QR masivo, (3) historial de precios, (4) realtime del dashboard (queda refresco manual), (5) regenerar código QR.

---

## 7. Escenarios de demo (H1–H4)

Cada escenario se prueba con Playwright (C6) y se ensaya en vivo.

**H1 — Registro y catálogo (INV-01, INV-02, DIST-01).** Un usuario se registra aceptando la política, confirma el email, elige "Mi tienda" y crea "Tienda La 14" en el mapa. Intenta una segunda tienda → mensaje de tope. Otro usuario se registra como distribuidor ("Distribuidora Quindío"). El admin ve ambos en Usuarios y crea el producto "Arroz Diana 500 g".

**H2 — Stock (INV-03, INV-04, INV-06, SEC-01).** El operador asigna el arroz a su tienda con umbral 10. Sin Premium, la entrada está bloqueada con explicación; el admin le activa Premium. Entrada 20 → salida 12 → stock 8 → aparece **una** alerta. Salida 9 → "stock insuficiente". Entrada 30 → la alerta se resuelve.

**H3 — Logística (INV-05, DIST-02, DIST-03, INT-01).** El distribuidor escanea el QR de la tienda y queda vinculado. El operador le hace un pedido de 24 unidades. El admin planifica la ruta del día. El distribuidor abre "Mi ruta", ve el mapa, marca la parada y confirma la entrega de 20 de 24 (parcial). El stock sube 20 y el dashboard Premium se actualiza sin recargar.

**H4 — Asistente (CHAT-01, CHAT-02).** El operador Premium pregunta qué se está agotando y el estado de su último pedido (respuestas reales). Pide "prepará una salida de 30 unidades de arroz": el asistente muestra una tarjeta de borrador; **Confirmar** ejecuta la acción y confirmar de nuevo → "ya fue confirmada". Sin sesión, la Edge Function responde 401. En WhatsApp, el mismo flujo exige teléfono verificado y `CONFIRMAR <code>`; los cambios de precio se rechazan por ese canal.

---

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| 10 días para 8 módulos | 3 tracks independientes por dominio; lista de recortes §6; sincronización diaria |
| Choques en archivos compartidos (§4.4) | PR chicos, rebase antes de revisión, aviso al fusionar |
| Estado del remoto desconocido (0013/0014, baseline) | B0.1 lo confirma el día 1; solo Daniel aplica migraciones |
| Sin pruebas automáticas de BD | Harness pgTAP (B3) el día 2; mientras tanto, smoke SQL en cada PR |
| Proveedor de IA caído en la demo | `AGENT_FALLBACK_MODEL` configurado, `agent-health` diario y video de respaldo de H4 |
| WhatsApp/Meta no disponible | El asistente web sigue funcionando; el canal WhatsApp es opcional para la demo |
| La cámara no lee el QR | HTTPS en producción; ingreso manual del código; prueba en Android e iOS |
| Prompt injection en el chatbot | JWT del usuario + RLS en cada tool; escrituras solo con confirmación en la UI (D3-9) |
| Un integrante no está disponible | Cada tarea es autocontenida en su archivo de track; cualquiera puede tomarla |
