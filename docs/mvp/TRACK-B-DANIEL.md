# Track B — Daniel

> **Alcance:** DevOps y base de datos (estado remoto, `schema-check`, harness pgTAP, despliegue del front, baseline), inventario (INV-03/04/06, DIST-04), alertas, precios y fiado.
> **Antes de empezar:** leer `docs/mvp/PLAN.md` §0–§6.
> **Rol especial:** Daniel es el **único que aplica migraciones al remoto** (gate H1) y tiene la última palabra sobre la BD. Revisa todo PR que toque `supabase/`.

| ID | Tarea | Día | Depende de | Estado |
|---|---|---|---|---|
| B1 | Estado remoto de 0013/0014 + deuda doc-first | 1 | — | ⬜ |
| B2 | `schema-check` dinámico (todas las migraciones) | 2 | — | ⬜ |
| B3 | Harness pgTAP + plantilla | 2 | B2 | ⬜ |
| B4 | Inventario: asignar producto ↔ tienda + umbral | 3 | B1 | ⬜ |
| B5 | Movimientos: entrada, salida, reverso | 4–5 | B4 | ⬜ |
| B6 | Alertas + realtime | 5 | B5 | ⬜ |
| B7 | Precios | 6 | B4 | ⬜ |
| B8 | Fiado (créditos y pagos) | 7 | C4 | ⬜ |
| B9 | Despliegue del front (Azure SWA) | 8 | — | ⬜ |
| B10 | Baseline + aplicar todo al remoto + verificación final | 9–10 | A1, A5, todas | ⬜ |

---

## B1 — Estado remoto de 0013/0014 + deuda doc-first (G4)

- **Pasos:**
  1. En el proyecto FAROX (`tzyqstnxbzyfmdxeuyvz`, **no** NØSEE): confirmar si 0013 (`register_distributor`, guards de `create_store`) y 0014 (`GRANT SELECT user_stores`) ya están aplicadas (`\df public.register_distributor`, `has_table_privilege('authenticated','public.user_stores','SELECT')`).
  2. Si faltan: aplicarlas por SQL editor (gate H1) y correr `0012_verify_hardening.sql` + la query S-D5.5 del encabezado de 0013.
  3. **Doc-first pendiente:** anotar en `Base de datos FAROX.md` §4 (`create_store` +2 guards, fila `register_distributor`), §9 (whitelist 31 → 32, nota del `audit_log` append-only que usa el orphan-cap) y la activación de `user_stores_select` (0014). Actualizar la tabla de migraciones de `supabase/README.md` hasta 0014.
  4. Publicar en el canal: estado del remoto y números reservados 0015/0016 (Track A).
- **Aceptación:** el estado remoto queda escrito en el PR; el doc de BD y el README describen 0013/0014.
- **Commit:** `docs(db): document migrations 0013-0014 and remote state`

## B2 — `schema-check` dinámico (G5)

- **Archivo:** `.github/workflows/schema-check.yml`
- **Pasos:** reemplazar la lista fija de 12 versiones por la lista derivada de `supabase/migrations/*.sql` (prefijo de 14 dígitos), de modo que toda migración nueva quede verificada sin editar el workflow. Mantener el self-test del parser y `db lint --fail-on=warning`.
- **Aceptación:** el job verifica 14 versiones hoy y 16 cuando entren 0015/0016; un PR con una migración rota sale rojo.
- **Commit:** `ci(db): derive schema-check versions from migrations folder`

## B3 — Harness pgTAP + plantilla (D3-12)

- **Archivos:** `supabase/tests/database/000_helpers.test.sql`, `supabase/tests/database/_template.test.sql`, job en `schema-check.yml` (o workflow propio) que corre `supabase test db`.
- **Pasos:**
  1. Confirmar en la documentación vigente del CLI la carpeta y el formato que ejecuta `supabase test db`. Si no hay `config.toml` todavía, el job hace `supabase init` como ya hace `schema-check`.
  2. Helpers en esquema `tests` (solo en la BD de pruebas): `tests.create_user(email, role, premium, distributor)` (inserta en `auth.users`, dispara `handle_new_user`, ajusta rol/premium como `postgres`), `tests.login_as(uuid)` (`SET LOCAL ROLE authenticated` + `request.jwt.claims` con `sub`), `tests.login_anon()`, `tests.logout()`, `tests.fixture_basic()` (admin, operador, operador premium, distribuidor, 2 tiendas, 3 productos).
  3. Cada archivo: `BEGIN; SELECT plan(n); … SELECT * FROM finish(); ROLLBACK;`.
  4. **Gotcha documentado en la plantilla:** `assert_admin()` deja pasar `session_user = postgres` sin `auth.uid()`. Toda prueba debe hacer `tests.login_as(...)` antes de llamar una RPC; si no, pasa por el bypass y no prueba nada. El propio harness lo verifica.
  5. Plantilla con los 3 casos mínimos (flujo feliz, rol no permitido, regla de negocio) para que A y C copien.
- **Aceptación:** `supabase test db` corre en CI en verde; un archivo de ejemplo prueba `create_store` (tope 1/3) y `register_distributor` (1 por usuario).
- **Commit:** `test(db): add pgtap harness and template`

## B4 — Inventario: asignar producto ↔ tienda + umbral (INV-03)

- **Archivos:** `src/features/inventory/…` + pruebas; `router.tsx`, `navigation.ts`, `mapError.ts`, `check-scope.mjs`.
- **Pasos:**
  1. `check-scope`: quitar `assign_product_to_store` y la tabla `stock`.
  2. Pestaña **Stock** en el detalle de tienda (`/stores/:id/stock`): lista `stock` de la tienda (`quantity,threshold,expiry_date,product:products(id,name,unit_type:unit_types(abbreviation))`, `range`), estado calculado en la UI solo para mostrar (agotado si 0; bajo si `threshold` no nulo y `quantity <= threshold`; OK).
  3. "Asignar producto": buscador de productos activos + umbral opcional → `assign_product_to_store(p_product, p_store, p_threshold)`; editar umbral con la misma RPC.
  4. Visible para admin y operador (con alcance); el distribuidor no.
- **Pruebas:** front (parámetros de la RPC, estados de la tabla, umbral vacío envía `null`); pgTAP: operador con alcance ✔, tienda ajena → error, distribuidor → error.
- **Commit:** `feat(front): assign products to stores`

## B5 — Movimientos: entrada, salida, reverso (INV-04, DIST-04)

- **Pasos:**
  1. `check-scope`: quitar `register_entry`, `register_exit`, `register_reverse` y las tablas `movements`, `motives`.
  2. Pestaña **Movimientos** de la tienda: historial (`movements`: `id,type,quantity,unit_price,created_at,motive:motives(name),product:products(name),reverso_of_id`, orden desc, `range`).
  3. Formulario entrada/salida: producto asignado, cantidad (decimales solo si la unidad lo permite en la UI), motivo filtrado por `suggested_type` (o ambos si es NULL), fecha de vencimiento solo en entradas → `register_entry(p_product, p_store, p_qty, p_motive_id, p_order_id=null, p_expiry_date)` / `register_exit(p_product, p_store, p_qty, p_motive_id)`.
  4. **No Premium:** formulario deshabilitado con explicación ("Registrar movimientos manuales requiere Premium").
  5. Reverso (solo admin): botón en cada movimiento no revertido → `register_reverse(p_movement_id, p_reason)` con motivo obligatorio.
  6. `mapError`: stock insuficiente, premium requerido, fuera de alcance, ya revertido.
- **Pruebas:** front por cada RPC y cada error; pgTAP: no premium → error; salida mayor al stock → error sin cambios; reverso doble → error. Prueba de concurrencia opcional (2 salidas simultáneas) si queda tiempo.
- **Commit:** `feat(front): stock movements and reversals`

## B6 — Alertas + realtime (INV-06, D3-11)

- **Pasos:**
  1. `check-scope`: quitar `mark_alert_read` y `alerts`; **ajustar la regla de realtime** para permitir `.channel(` / `postgres_changes` solo en `src/features/alerts/` y `src/features/dashboard/` (D3-11), con prueba del propio script.
  2. `/alerts` (admin y operador): abiertas (`resolved_at is null`) con `type,message,created_at,read_at,store:stores(name)`; filtro por tipo; "Marcar leída" → `mark_alert_read(p_alert)`.
  3. Contador de alertas abiertas en el shell.
  4. Realtime: suscripción a `alerts` **solo con la pestaña visible** (`visibilitychange`; desuscribir al ocultar y al desmontar); al llegar un evento, refetch de la lista.
- **Pruebas:** suscribe/desuscribe según visibilidad (mock del canal); marcar leída; filtro por tipo.
- **Commit:** `feat(front): alerts with realtime updates`

## B7 — Precios (solo admin)

- **Pasos:** `check-scope`: quitar `set_price` y `price_publications`. En la pestaña Stock (admin): precio vigente por producto y "Cambiar precio" → `set_price(p_product, p_store, p_price, p_currency='COP')`; historial del par (`price_publications` por `created_at desc`). Operador: solo lectura de los de sus tiendas. Distribuidor: nada.
- **Pruebas:** front (solo admin ve el botón; historial ordenado); pgTAP: no admin → `solo admin`; queda una sola fila activa.
- **Commit:** `feat(front): store prices`

## B8 — Fiado: créditos y pagos

- **Depende de:** C4 (pedidos entregados).
- **Pasos:** `check-scope`: quitar `create_credit`, `cancel_credit`, `register_payment`, `register_payment_reverse` y las tablas `credits`, `credit_payments`.
  1. `/credits` (admin y operador): cartera (`credits`: `id,total_amount,balance,status,due_date,store:stores(name),order_id`), filtro por estado.
  2. En el detalle de un pedido `delivered` (pantalla de C3; aquí solo el bloque "Fiado"): "Crear crédito" (admin) → `create_credit(p_order, p_due_date)`.
  3. Registrar pago (admin/operador) → `register_payment(p_credit, p_amount, p_method)`; historial de pagos; revertir pago (admin) → `register_payment_reverse`; anular crédito (admin, sin pagos) → `cancel_credit`.
- **Pruebas:** front (pago mayor al saldo muestra error amigable; solo admin ve crear/anular/revertir); pgTAP: crédito sobre pedido no entregado → error.
- **Commit:** `feat(front): credits and payments`

## B9 — Despliegue del front (Azure SWA)

- **Pasos:** crear la app de Static Web Apps y conectar el repo (G1, humano); `deploy-front.yml` solo en `push` a `main` (sin `pull_request`); variables `VITE_*` de producción como secrets; ejecutar el protocolo del spike U1 (sin previews); configurar en Supabase Auth el `site_url` y las redirect URLs del dominio de Azure; `staticwebapp.config.json` con fallback de SPA a `index.html`.
- **Aceptación:** `main` se publica sola; recargar `/stores/1` no da 404; spike U1 con evidencia.
- **Commit:** `ci: deploy front to azure static web apps`

## B10 — Baseline + aplicar todo al remoto + verificación final

- **Pasos:**
  1. Correr el spike U3 (`spike-repair.yml`) y, según la rama A/B, commitear `supabase/config.toml` byte-idéntico al artefacto y hacer el `migration repair` del baseline (0001–0014) en el remoto.
  2. Aplicar 0015/0016 y las correcciones 0017+ (si hubo) — por SQL editor o `supabase db push` si el baseline quedó listo.
  3. `0008_verify.sql` y `0012_verify_hardening.sql` sin `FAIL`; `supabase migration list` sin diferencias.
  4. Usuarios de demo creados **desde la app** (registro + onboarding), no por script; datos de H1–H4 cargados con la UI.
  5. Etiqueta `v1.0.0`.
- **Si el baseline no alcanza a cerrarse:** queda documentado como riesgo aceptado; las migraciones siguen por gate H1.
- **Commit:** `chore(db): baseline remote migration history`
