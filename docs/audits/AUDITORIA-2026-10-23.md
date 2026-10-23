# Auditoría de FARØX — trabajo de Daniel (19–21 oct 2026)

## Alcance

- **Proyecto:** FARØX (React + Supabase). Se auditó lo fusionado entre `b8de517` y `93c6405` (18 commits de `nosee8`): frontend `src/` (176 archivos, ~20.800 líneas con pruebas), migraciones 0013–0014, workflows de CI, scripts, configuración y documentos. Para revisar los contratos también se leyeron las migraciones 0001–0012 relacionadas.
- **Commit auditado:** `93c6405` (2026-10-21). La revisión se hizo el 2026-10-23.
- **Nivel de calidad acordado:** MVP académico listo para una demo en producción el 6 de noviembre.
- **Alcance de la lectura:** se leyó todo lo que está en el alcance, a mano y con 4 revisores independientes de solo lectura; cada hallazgo crítico se verificó contra el código o contra GitHub. **No se revisó:** la configuración real del proyecto Supabase en producción (Auth, max-rows, región), porque eso no está en el repo; tampoco se hizo una auditoría UX completa (solo accesibilidad básica).
- **Nota:** en una verificación previa se ejecutó `npm ci` dentro del repo, lo que creó `node_modules/` (está ignorado por git). Todas las mediciones se hicieron en una copia fuera del repo.

## Riesgos principales

1. **La migración 0011 no se puede aplicar en ningún sitio**: `session_user()` lleva paréntesis y en PostgreSQL es un error de sintaxis — `supabase/migrations/20261016000011_seguridad.sql:59`.
2. **El admin queda atrapado en el onboarding y puede degradarse a sí mismo a distribuidor** con un clic — `src/features/onboarding/detection.ts:42` + `20261019000013_registration_hardening.sql` (`register_distributor` no valida el rol).
3. **El backup semanal subiría un volcado sin cifrar de producción como artefacto de un repo PÚBLICO** — `.github/workflows/backup-weekly.yml:55-75` (todavía no se ha ejecutado).

## Primeras tres acciones

1. Corregir `session_user()` → `session_user` en 0011 y confirmar qué hay realmente en producción — resuelve F1 y desbloquea F15/F16. Esfuerzo: pequeño.
2. Excluir al admin del onboarding y blindar `register_distributor` (guard de rol, `SELECT … FOR UPDATE`) con una migración nueva — resuelve F2 y F5. Esfuerzo: pequeño.
3. Proteger `main` (exigir `quality` + `schema-check`), desactivar `backup-weekly` hasta que el volcado vaya cifrado a un almacenamiento privado, e ignorar `.atl/` — resuelve F3, F4, F17 y F23. Esfuerzo: pequeño.

## Qué se midió

| Verificación | Comando | Resultado |
|---|---|---|
| Pruebas | `npx vitest run` | 48 archivos, **432 pasan**, 0 fallan, ~7 s |
| Cobertura | `vitest run --coverage` (v8, `src/**`) | líneas **81,7 %**, ramas **68,8 %**, funciones 83,7 %. Con 0 %: `products/api.ts`, `stores/api.ts`, `catalogs/api.ts`, `profile/api.ts`, `nominatim.ts` (6 %); `distributors/api.ts` 25 % |
| Lint | `eslint .` | 0 errores, 0 advertencias |
| Tipos | `tsc --noEmit` | 0 errores |
| Build | `vite build` | correcto (aviso de un chunk > 500 kB) |
| Formato | `prettier --check .` | **98 archivos sin formatear** (82 en `src/`); no se verifica en CI |
| Dependencias | `npm audit` / `npm outdated` | 0 vulnerabilidades; 10 paquetes con una versión mayor nueva |
| Mutaciones | 8 sondas en una copia | **6 de 8 detectadas**; sobrevivieron la guarda de "0 filas" en `products/api.ts` y el `p_store_type_id` de `create_store` |
| CI en GitHub | `gh run list` | Schema Check: **17 de 17 en rojo** desde el 20 oct; CI: 12 en verde y 5 en rojo |
| Repositorio | `gh repo view`, `gh api …/protection` | **Público**; `main` **sin protección** |
| PostgreSQL | `select session_user();` en postgres:17 | `ERROR: syntax error at or near "("` |

**No se midió:** el estado real de la BD de producción (qué migraciones tiene aplicadas) ni la configuración de Auth del proyecto Supabase.

## Hallazgos

| Id | Severidad | Dimensión | Dónde | Qué está mal | Escenario de falla | Evidencia |
|---|---|---|---|---|---|---|
| F1 | Bloqueante | Corrección | `20261016000011_seguridad.sql:59` | `session_user()` es un error de sintaxis en PostgreSQL (`session_user` se escribe sin paréntesis). Se usa en `assert_admin()` | La 0011 falla completa: en CI (Schema Check 17 de 17 en rojo), en el SQL editor (que la revierte entera) y en cualquier `db push` o baseline. Nunca se crean `assert_admin`, el lockdown de grants ni los guards; la verificación 0012 nunca corre | `ERROR: syntax error at or near "(" (SQLSTATE 42601)` en el log del job y reproducido en postgres:17 |
| F2 | Bloqueante | Seguridad | `onboarding/detection.ts:42`, `router.tsx:65`, 0013 `register_distributor` | El gate de onboarding no considera el rol, y `register_distributor` solo comprueba que el usuario esté activo | Un admin sin tiendas es enviado a `/onboarding` en cada login; si elige "Distribuidor" queda degradado a `distribuidor` (y el tope anti-huérfanos impide revertirlo). Con un solo admin se pierde la consola completa | `return !acknowledged && !signals.hasDistributor && !signals.hasStore;` · `UPDATE users SET role_id = (… 'distribuidor')` |
| F3 | Bloqueante (latente) | Seguridad | `backup-weekly.yml:55-75` | `db dump --data-only` de producción se sube con `upload-artifact` (30 días), sin cifrar | El repo es público: tras la primera ejecución, nombres, emails y teléfonos quedan descargables por cualquier usuario de GitHub | `visibility: PUBLIC`; el workflow aún no se ha ejecutado |
| F4 | Grave | Operabilidad | GitHub, rama `main` | `main` no tiene protección; los checks en rojo no bloquean los merges | Schema Check lleva 3 días en rojo y se siguió fusionando; la compuerta no protege nada | `Branch not protected (HTTP 404)` |
| F5 | Grave | Seguridad / Concurrencia | 0013 `register_distributor` | Cualquier usuario registrado crea un distribuidor **activo** con cualquier NIT, sin aprobación (la matriz dice "Distribuidores: operador ✘"). Además, las comprobaciones se leen sin `FOR UPDATE` | Suplantación: alguien registra el NIT de una empresa real, la empresa real ya no puede registrarse y el atacante ve los pedidos dirigidos a ese distribuidor. Dos llamadas en paralelo dejan un distribuidor huérfano | `INSERT INTO public.distributors …` sin guard de rol; `SELECT u.distributor_id INTO v_prior …` sin bloqueo |
| F6 | Grave | Corrección | `UsersPage.tsx`, `ProductsPage.tsx`, `StoresPage.tsx`, `DistributorsPage.tsx` | Ninguna lista tiene paginador (`setPage` no se usa fuera de `useList`) | Desde el registro número 26 (usuarios, productos, tiendas, distribuidores) ya no hay forma de verlos ni de editarlos | `grep setPage` en archivos .tsx que no son prueba = 0 |
| F7 | Grave | Corrección | `ProductFormPage.tsx:186-197` (igual en tiendas y distribuidores) | "Eliminar" desactiva y luego hace un DELETE físico en dos peticiones; contradice la regla "eliminar = desactivar (soft-delete)" | Un producto con stock queda desactivado y luego el DELETE falla por las FK RESTRICT: el usuario ve un error, pero el registro ya quedó oculto y no hay forma de reactivarlo | Paso 1 `deactivateProduct`, paso 2 `deleteProduct` |
| F8 | Grave | Corrección | `shared/lib/errors/mapError.ts` | No se traducen los errores de 0013 (NIT duplicado, "ya tenés un distribuidor", usuario inactivo, ubicación requerida) | En el error más probable del onboarding (NIT repetido) el usuario solo ve "error inesperado" y no sabe qué corregir | La prueba simula un `23505` pero la RPC lanza P0001 con texto |
| F9 | Grave | Corrección | `roles/schemas.ts:16` | El nombre del rol es `z.enum` con los 3 roles que ya existen en el seed (y el nombre es UNIQUE) | "Nuevo rol" y la edición de roles siempre fallan con 23505; la única escritura que funciona es borrar | `name: z.enum(ROLE_NAMES…)` + seed de admin/operador/distribuidor |
| F10 | Grave | Corrección | `useGeolocation.ts:145-149` + `LocationPicker.tsx:232-245` | La ubicación guardada en caché (incluso la aproximada por IP) se fija como pin antes de que responda el GPS, y la lectura real se ignora | Al crear una segunda tienda en otro lugar, el pin y la dirección quedan en el sitio anterior y se guarda mal | estado inicial tomado de `readStoredLocation()` |
| F11 | Grave | Accesibilidad | `LocationPicker.tsx`, `MapLocationField.tsx` | La ubicación solo se fija con clic o arrastre en el mapa; los campos numéricos aparecen solo si el mapa falla | Un usuario de teclado o lector de pantalla sin geolocalización no puede crear una tienda (WCAG 2.1.1) | |
| F12 | Grave | Usabilidad / Seguridad | `UserDetail.tsx:104-113` | Desactivar a otro usuario, cambiarle el Premium o el rol se hace con un solo clic, sin confirmación; tampoco hay protección para el último admin | Un clic accidental bloquea a un usuario al instante | `onChange={(e) => onToggleActive(e.target.checked)}` |
| F13 | Grave | Cumplimiento (Ley 1581) | `legal/privacyContent.ts:203-210` | La política promete suprimir o anonimizar los datos al eliminar la cuenta, pero no existe borrado de cuenta y `audit_log` (append-only) guarda la fila completa del usuario | Una solicitud de supresión no se puede cumplir tal como está escrita | `audit_diff`: `v_diff := to_jsonb(NEW)` en INSERT |
| F14 | Grave | Calidad de pruebas | `products/api.ts`, `stores/api.ts`, `catalogs/api.ts`, `profile/api.ts` | La capa de datos tiene 0 % de cobertura: las páginas simulan el módulo `api` | Romper la guarda de "0 filas" o un parámetro de la RPC no hace fallar ninguna prueba | Mutaciones M7 y M8 sobrevivieron |
| F15 | Grave | Gobierno de BD | `Base de datos FAROX.md` vs encabezados de 0013/0014 | El paso "doc-first" que exige 0013 no se hizo; además, 0012 espera exactamente 34 funciones y `register_distributor` la hace fallar | El documento autoridad no describe la BD real; la verificación 0012 dará FAIL | 0 menciones de `register_distributor` en el doc |
| F16 | Grave | Operabilidad | `schema-check.yml:57-68`, `parse-verify-output.mjs:25-30` | Las 12 versiones verificadas están escritas a mano (0013/0014 nunca se comprueban), y la ruta de avisos del parser nunca coincide con la salida real del CLI | Una migración nueva puede no aplicarse y el check dice "12/12 OK" | `WARNING (01000):` real vs `WARNING:` de los fixtures |
| F17 | Grave | Seguridad CI | `backup-weekly.yml:23-32` | El token de cuenta de Supabase y la contraseña de producción están en el `env` de todo el job, con acciones fijadas por tag y el CLI en "latest"; el entorno `backup` no existe ni tiene restricción de ramas | Un tag comprometido o cualquier colaborador que lance el workflow desde su rama puede exfiltrar las credenciales | |
| F18 | Grave | Corrección (Auth) | `supabase/client.ts:9`, `CallbackPage.tsx:53-59` | El cliente usa el flujo implícito y el callback solo acepta `?code=` | Si la redirección del email apunta a `/auth/callback`, el usuario ya tiene sesión pero ve "link inválido" (depende de la configuración del panel; no verificado) | |
| F19 | Menor | Corrección | `OnboardingGate.tsx:47` | El "Entendido" del perfil "Trabajo en tienda" vive en un `useState` que se pierde al remontar el componente | Al cambiar de pestaña, el trabajador vuelve a ver el onboarding | |
| F20 | Menor | Servicios externos | `nominatim.ts`, `useReverseGeocode.ts:12` | Nominatim se llama con un debounce de 800 ms, sin caché ni límite global, e incumple la política de 1 req/s; las teselas usan subdominios `abc` | Bloqueo por parte de OSM con varios usuarios | |
| F21 | Menor | Mantenibilidad | `users/*`, `roles/*` | Hay features que importan otras (`../auth`, `../profile`) y la capa de app, en contra de la regla del propio proyecto | Acoplamiento; cambiar `auth` rompe a `users` y `roles` | |
| F22 | Menor | Operabilidad | `package.json`, `ci.yml` | Prettier está configurado pero no se aplica (98 archivos); `engines: node >=20` cuando vitest 5 exige 22.12 o superior; no hay `timeout-minutes` ni `permissions` en `ci.yml` | Ruido de diffs; un desarrollador con Node 20 no puede correr las pruebas | |
| F23 | Menor | Seguridad / Higiene | `.atl/skill-registry.md` | Está commiteado con rutas locales (`C:\Users\danie\…`) en un repo público y se regenera en cada máquina | Filtra el usuario del sistema operativo y genera cambios constantes | |
| F24 | Menor | Varios | ver informes | Lectura de privilegios: un error transitorio deja el rol en `null` y expulsa al admin a "Acceso denegado"; conteos sin límite (`user_stores`, `users`), que se truncan pasados 1000; ciclos posibles en las categorías; `base_quantity` sin validar la precisión; "Cargar más" en Auditoría oculta lo ya cargado si falla; el perfil no maneja errores de carga; `check-scope` se evade con `.rpc<T>(` o nombres en variables; el README está desactualizado | | |

## Fortalezas

- **El rol y el Premium salen solo de la BD** (`rpc('my_role')`, `rpc('is_premium')`); nunca se lee del JWT ni de la metadata.
- **Nunca se reporta un éxito falso:** todo UPDATE/DELETE pide `.select("id")` y convierte "0 filas" en un error 42501 (detectado por las mutaciones M1).
- **Pruebas sólidas en lógica crítica:** 432 pruebas, 6 de 8 mutaciones detectadas (guards de rol, navegación, `mapError`, orden lng/lat del EWKT, onboarding).
- **El listado protege contra respuestas viejas** (`useList` con bandera `cancelled`; geocodificación con contador de secuencia), y Leaflet se carga bajo demanda con una alternativa si falla.
- **Higiene base:** 0 errores de lint y de tipos, 0 vulnerabilidades, lockfile commiteado, `check-scope` bloqueando `service_role` en el front.

## Preguntas para el equipo

- ¿Qué hay realmente aplicado en producción? Si la 0011 falla, ¿se aplicó a mano una versión corregida, o el remoto no tiene el lockdown de 0011 y, por eso, tampoco 0012–0014?
- ¿El autorregistro de distribuidores sin aprobación del admin es una decisión consciente? Contradice la matriz de roles.
- ¿Qué URL de redirección tiene configurada Supabase Auth para la confirmación de email?
- ¿La política de privacidad sigue siendo un borrador? Si se publica, debe ajustarse a lo que el sistema puede cumplir (F13).

## No verificado

- El valor de max-rows de PostgREST en el proyecto (afecta a F24).
- La región de alojamiento de Supabase (transferencia internacional en la política de privacidad).
- El comportamiento de `--from-backup` en el simulacro de restauración del backup.

## Acciones restantes (después de las 3 primeras)

| Orden | Acción | Resuelve | Esfuerzo |
|---|---|---|---|
| 4 | Paginador en `DataTable` / `useList` y orden estable | F6 | pequeño |
| 5 | "Eliminar" = solo desactivar (+ reactivar); el borrado físico solo para registros sin uso | F7 | pequeño |
| 6 | Traducir en `mapError` los errores de 0013 (y la diferencia entre NIT y nombre en 23505) | F8 | pequeño |
| 7 | Doc-first de 0013/0014 en `Base de datos FAROX.md` y 0012 con la whitelist actualizada | F15 | pequeño |
| 8 | `schema-check` con las versiones derivadas de la carpeta; fixtures con salida real del CLI | F16 | pequeño |
| 9 | Confirmación para desactivar / Premium / cambiar rol; proteger al último admin | F12 | pequeño |
| 10 | Roles: permitir solo editar la descripción, o quitar el alta | F9 | pequeño |
| 11 | Pruebas de `api.ts` (products, stores, catalogs, profile) | F14 | mediano |
| 12 | Ubicación: no fijar la caché como pin y ofrecer siempre campos manuales | F10, F11 | mediano |
| 13 | Política de privacidad alineada con lo que el sistema hace; definir la supresión | F13 | mediano |
| 14 | Endurecer el backup (secretos por paso, acciones fijadas por SHA, entorno restringido a `main`, cifrado) | F17 | mediano |
| 15 | Callback de Auth: aceptar una sesión ya establecida o pasar a PKCE con `emailRedirectTo` | F18 | pequeño |
| 16 | Prettier en CI, `engines >=22.12`, `.atl/` en `.gitignore`, README | F22, F23 | pequeño |
| 17 | Resto de menores | F19–F21, F24 | mediano |
