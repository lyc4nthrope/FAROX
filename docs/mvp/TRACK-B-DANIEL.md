# Track B — Daniel

> **Alcance:** DevOps y base de datos (estado remoto, `schema-check`, harness pgTAP, despliegue del front, baseline), inventario (INV-03/04/06, DIST-04), alertas, precios y fiado.
> **Antes de empezar:** leer `docs/mvp/PLAN.md` §0–§6.
> **Rol especial:** Daniel es el **único que aplica migraciones al remoto** (gate H1) y tiene la última palabra sobre la BD. Revisa todo PR que toque `supabase/`.

> **Orden:** primero la Fase 0 (B0.1–B0.5; **B0.1 es lo más urgente del proyecto**), después las funcionalidades (B3–B10).

| ID | Tarea | Día | Depende de | Estado |
|---|---|---|---|---|
| **B0.1** | Corregir 0011 (`session_user`) + estado real del remoto + aplicar 0011–0014 | 1 | — | ⬜ |
| **B0.2** | Doc-first de 0013/0014 en el doc de BD + nota de 0012 | 1 | B0.1 | ⬜ |
| **B0.3** | `schema-check` dinámico y parser con salida real | 2 | B0.1 | ⬜ |
| **B0.4** | Proteger `main` + endurecer el backup + permisos de CI | 2 | B0.3 | ⬜ |
| **B0.5** | Higiene: `.atl`, Node, Prettier, `check-scope`, README | 3 | B0.4 | ⬜ |
| B3 | Harness pgTAP + plantilla | 3 | B0.3 | ⬜ |
| B4 | Inventario: asignar producto ↔ tienda + umbral | 4 | Fase 0 | ⬜ |
| B5 | Movimientos: entrada, salida, reverso | 5 | B4 | ⬜ |
| B6 | Alertas + realtime | 6 | B5 | ⬜ |
| B7 | Precios | 6 | B4 | ⬜ |
| B8 | Fiado (créditos y pagos) | 7 | C4 | ⬜ |
| B9 | Despliegue del front (Azure SWA) | 7–8 | B0.4 | ⬜ |
| B10 | Baseline + aplicar todo al remoto + verificación final | 9–10 | A0.1, A1, A5, todas | ⬜ |

(Las antiguas B1 y B2 quedaron dentro de B0.1, B0.2 y B0.3.)

---

## Fase 0 — Correcciones de la auditoría (hacer primero)

Referencia: `docs/audits/AUDITORIA-2026-10-23.md`. Cada tarea cita los hallazgos (F#) que cierra.

### B0.1 — Corregir 0011 + estado real del remoto (cierra F1)

- **Por qué es lo primero:** `session_user()` con paréntesis es un error de sintaxis en PostgreSQL (verificado en postgres:17: `ERROR: syntax error at or near "("`). La 0011 entera falla en CI, en el SQL editor y en `db push`; sin ella no existen `assert_admin()` ni el lockdown de grants, y todo lo posterior queda en duda.
- **Pasos:**
  1. `supabase/migrations/20261016000011_seguridad.sql:59`: `IF session_user() = 'postgres'` → `IF session_user = 'postgres'`. En `20261016000012_verify_hardening.sql:605` (comentario) el mismo cambio, para no confundir. Buscar cualquier otro `session_user()`/`current_user()` en `supabase/` (debe dar 0). Esta es la **única** edición permitida de una migración existente (PLAN §3.3), porque nunca se pudo aplicar.
  2. Abrir el PR y comprobar que **Schema Check pasa en verde** (aplica 0001–0012 en un stack nuevo). Si aparece otro error, corregirlo en el mismo PR y anotarlo.
  3. En producción (proyecto `tzyqstnxbzyfmdxeuyvz`, solo lectura primero): comprobar qué existe — `\df public.assert_admin`, `\df public.register_distributor`, `has_table_privilege('authenticated','public.user_stores','SELECT')`, `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')` (debe ser 0 tras 0011). Pegar el resultado en el PR.
  4. Aplicar por SQL editor (gate H1), **en una sola ventana y en orden**, lo que falte de 0011 (corregida) → 0012 → 0013 → 0014. Correr `0012_verify_hardening.sql` y la query S-D5.5 de 0013; pegar los veredictos.
  5. Avisar en el canal: "0011 corregida y aplicada; números reservados 0015 (A0.1), 0016 (A1), 0017 (A5)".
- **Aceptación:** Schema Check en verde en `main`; producción con `assert_admin` y `register_distributor`; `anon` sin EXECUTE en ninguna función de `public`.
- **Commit:** `fix(db): use session_user without parentheses in assert_admin`

### B0.2 — Doc-first de 0013/0014 (cierra F15)

- **Pasos:** en `Base de datos FAROX.md`: §4 `create_store` (+2 guards: ubicación obligatoria, usuario activo) y la fila nueva de `register_distributor`; §9 la whitelist 31 → 32 y la nota "no purgar `audit_log`: el tope anti-huérfanos de `register_distributor` lo cuenta"; activación de `user_stores_select` (0014). Agregar a §9: "volver a correr 0012 después de 0013 da 1 FAIL esperado en H1.3 (34 → 35 por `register_distributor`); desde B3, la lista de la whitelist la verifica pgTAP". Actualizar la tabla de migraciones de `supabase/README.md` hasta 0014.
- **Commit:** `docs(db): document migrations 0013-0014`

### B0.3 — `schema-check` dinámico y parser con salida real (cierra F16; incluye la antigua B2)

- **Archivos:** `.github/workflows/schema-check.yml`, `scripts/parse-verify-output.mjs`, `scripts/fixtures/*`.
- **Pasos:**
  1. Reemplazar la lista fija de 12 versiones por la lista derivada de `ls supabase/migrations/*.sql` (prefijo de 14 dígitos); el mensaje final dice "N/N versiones evidenciadas".
  2. El parser y sus fixtures usan el formato real del CLI (`WARNING (01000): …`, `NOTICE (00000): …`), tomado de un log real del job; la regla de avisos acepta ambos formatos. Agregar un fixture con salida real.
  3. Borrar las notas "UNVERIFIED" ya resueltas: `supabase db start` **sí** aplica migraciones (visto en el log).
  4. Agregar `timeout-minutes: 20` al job.
- **Aceptación:** con 14 migraciones el job dice 14/14; un fixture con un `WARNING (01000)` no clasificado sale en rojo.
- **Commit:** `ci(db): verify every migration in schema-check`

### B0.4 — Proteger `main`, endurecer el backup y permisos de CI (cierra F3, F4, F17)

- **Pasos:**
  1. **Backup (antes que nada):** en `backup-weekly.yml`, quitar el `schedule` hasta que los puntos 2–5 estén hechos (dejar solo `workflow_dispatch`).
  2. Secretos solo en los pasos `link` y `dump` (no en el `env` del job); acciones fijadas por **SHA** con el tag en un comentario (Dependabot las actualiza); versión del CLI fijada.
  3. El volcado se **cifra** antes de subirlo (`age` con la clave pública en el secreto `BACKUP_AGE_RECIPIENT`; la privada solo la guardan Daniel y Cristhian fuera de GitHub). El artefacto solo contiene el archivo `.age`; `retention-days: 7`.
  4. Crear el entorno `backup` en GitHub con "Deployment branches: main" y Daniel como revisor obligatorio.
  5. Reactivar el `schedule` y lanzar una ejecución manual; adjuntar evidencia de que el artefacto está cifrado.
  6. `ci.yml`: `permissions: contents: read` y `timeout-minutes: 15`; los demás workflows también con `timeout-minutes`.
  7. **Proteger `main`** (Settings → Branches): PR obligatorio, 1 aprobación, checks obligatorios `quality` y `schema-check`, sin force-push ni borrado. Hacerlo **después** de que B0.1 deje Schema Check en verde.
- **Aceptación:** un PR con una prueba rota no se puede fusionar; el backup no expone datos en claro.
- **Commit:** `ci: harden backup workflow and ci permissions`

### B0.5 — Higiene (cierra F22, F23, F24-check-scope)

- **Pasos:**
  1. `.gitignore`: `.atl/`, `backups/`, `*.log`, `supabase/.temp/`; `git rm --cached -r .atl` (contiene rutas locales en un repo público).
  2. `package.json`: `"engines": { "node": ">=22.12" }`; README actualizado (usar `npm ci`, Node 22.12+, `.env` desde `.env.example`, enlace a `supabase/README.md` y a este plan, para qué sirve cada workflow).
  3. Prettier: `.prettierignore` con `*.md` de la raíz y `docs/**` (no reformatear los documentos de especificación); correr `npm run format` sobre el código en **un commit mecánico aparte**; agregar `format:check` al script `ci` y a `ci.yml`.
  4. `check-scope.mjs`: detectar también `.rpc<…>(` y `.from<…>(`, marcar como violación cualquier `.rpc(`/`.from(` cuyo primer argumento no sea un literal, escanear `.js`/`.jsx`, y corregir el comentario "15 tablas" (son 14). Pruebas del script con casos de evasión.
- **Commit:** `chore: repository hygiene and stricter scope gate` · `style: apply prettier`

---

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
  2. Aplicar 0015, 0016, 0017 y las correcciones 0018+ (si hubo) — por SQL editor o `supabase db push` si el baseline quedó listo.
  3. `0008_verify.sql` y `0012_verify_hardening.sql` sin `FAIL`; `supabase migration list` sin diferencias.
  4. Usuarios de demo creados **desde la app** (registro + onboarding), no por script; datos de H1–H4 cargados con la UI.
  5. Etiqueta `v1.0.0`.
- **Si el baseline no alcanza a cerrarse:** queda documentado como riesgo aceptado; las migraciones siguen por gate H1.
- **Commit:** `chore(db): baseline remote migration history`
