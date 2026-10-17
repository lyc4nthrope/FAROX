# FAROX — Migraciones Supabase (Sprint 1)

Materialización del esquema según `Base de datos FAROX.md` (documento **autoridad**).
12 migraciones numeradas que se ejecutan **en orden estricto** — el orden numérico
del filename ES el orden de materialización del §7. Las 4 últimas (0009→0012)
son el hardening de `sprint1-hardening` y comparten UNA ventana de mantenimiento
(ver "Hardening 0009→0012" abajo).

| # | Archivo | Qué hace |
|---|---------|----------|
| 1 | `20261015000001_extensions_enums.sql` | Extensiones (postgis, pg_cron) + los 11 enums (§1) |
| 2 | `20261015000002_tables_reused.sql` | 11 tablas reutilizadas de NØSEE en su estado final (§2) |
| 3 | `20261015000003_tables_farox.sql` | 14 tablas nuevas FAROX + 3 FKs diferidas (§3) |
| 4 | `20261015000004_functions_triggers.sql` | Helpers, triggers y TODAS las RPC (§4) |
| 5 | `20261015000005_seeds.sql` | Semilla mínima de catálogos (§7.6, D19) |
| — | ⚠️ **PASO MANUAL — ver abajo** ⚠️ | Signup del primer admin + promoción |
| 6 | `20261015000006_rls_grants.sql` | ENABLE RLS en las 25 tablas + policies + REVOKE/GRANT (§8/§4) |
| 7 | `20261015000007_realtime_jobs.sql` | Publicación realtime podada + 3 jobs pg_cron diarios (§5/§7.10) |
| 8 | `20261015000008_verify.sql` | Diagnóstico completo — no modifica nada (§7.11) |
| 9 | `20261016000009_negocio.sql` | Hardening de negocio: helpers con `is_active`, guards de `confirm_delivery`/`register_entry`/`exit`, `create_order` con `is_active`, `create_credit` sólo sobre pedidos `delivered`, policies scoped de créditos/rutas (§4/§8) |
| 10 | `20261016000010_perf.sql` | Performance: `confirm_delivery` con dedup y UN solo upsert de dashboard (1 evento realtime por entrega), índices parciales (`stock.expiry_date`, `orders.expected_at`, `alerts.store_id`), `audit_diff` precalculado, `get_dashboard` ≤366 días, `create_order` set-based |
| 11 | `20261016000011_seguridad.sql` | Seguridad: `assert_admin()` (guard admin NULL-safe) + lockdown de grants deny-by-default (REVOKE de PUBLIC — bug PG #8685 —, whitelist de 31 firmas, PostGIS re-grant, `anon` sin DML) |
| 12 | `20261016000012_verify_hardening.sql` | Verificación del hardening — no modifica nada (checks H1-H4) |

---

# ⚠️⚠️ PASO MANUAL OBLIGATORIO ENTRE 0005 Y 0006 ⚠️⚠️

**No es opcional y no puede quedar pendiente.** Ejecútalo DESPUÉS de correr
`0005_seeds.sql` y ANTES de `0006_rls_grants.sql`.

## ¿Por qué?

- `handle_new_user()` (trigger de signup, 0004) crea toda fila `users` con el
  rol **`operador`** — no existe ningún camino que cree un `admin` directamente.
- Ningún seed puede crear usuarios: `users.id` FK-ea `auth.users(id)` y los
  `auth.users` de NØSEE no son migrables entre proyectos.
- Sin un admin promovido, **nada administrable funciona**: `update_user_role`,
  `assign_user_stores`, `create_store`… todas exigen caller admin (§4).

(El orden 0005 → manual → 0006 existe porque los seeds con `created_by NOT NULL`
— tiendas, órdenes, precios — solo corren con un usuario real ya creado, D19.
Las RPC y el trigger de signup se crearon en 0004 precisamente para que este
paso sea posible antes de RLS.)

## Los 3 sub-pasos

### 1. Sign up el primer usuario por la app/supabase auth

Cualquier medio de signup de Supabase Auth (la app, el dashboard en
Authentication → Users → "Add user", o el SDK). El trigger
`on_auth_user_created` inserta la fila en `public.users` con rol `operador`.

> Si el trigger fallara con *"roles sin sembrar"* es que 0005 no corrió —
> corré 0005 y repetí el signup (borrá el usuario huérfano de Authentication
> primero si quedó).

### 2. Copiá el UUID del usuario creado

Dashboard → Authentication → Users → copiá el `user id`. O desde el SQL editor:

```sql
SELECT id, email FROM public.users ORDER BY created_at;
```

### 3. Promoverlo a admin desde el SQL editor

```sql
-- Cambiá <UUID> por el id del paso 2:
UPDATE public.users u
SET role_id = r.id
FROM public.roles r
WHERE u.id = '<UUID>'::uuid AND r.name = 'admin';
```

> **¿Por qué un `UPDATE` directo y no `update_user_role()`?** El RPC exige
> caller admin: el guard quedó NULL-safe en el review de seguridad B3 —
> `my_role() IS DISTINCT FROM 'admin'` ⇒ RAISE, con el bypass por sesión
> sin `auth.uid()` cerrado a propósito — y el primer usuario llega como
> `operador`, que no puede autopromoverse. El SQL editor corre como
> `postgres`, dueño de las tablas: salta RLS y los grants por columna
> (D45). Es el único camino legítimo de bootstrap (C2) y funciona con o
> sin 0011 aplicado. **Una vez promovido, el admin opera desde la app como
> cualquier authenticated** — `update_user_role()` desde la app sirve para
> los siguientes usuarios.
>
> **Desde 0011 el guard de las RPC solo-admin es `assert_admin()`**
> (NULL-safe): deja pasar **solo** a un admin activo o a la sesión del SQL
> editor — `session_user() = 'postgres' AND auth.uid() IS NULL`
> (bootstrap C2). En PostgREST `session_user` es `authenticator`, así que
> ninguna app, CLI o caller con anon key toma ese bypass: un cliente con
> `auth.uid()` NULL recibe `'solo admin'`. *(El bypass implícito del
> guard original `my_role() <> 'admin'` — sin JWT, `my_role()` es NULL y
> la comparación no aplicaba — ya no existe en la secuencia actual: 0004
> lo cerró con `IS DISTINCT FROM` (B3) y 0011 lo re-abre **sólo**,
> explícito, para la sesión del SQL editor.)*
>
> Cambio de roles vía API (sólo **después** del bootstrap, no lo reemplaza):
> con un admin activo ya promovido, logueate como ese admin en la app, copiá
> su `access_token` del storage del navegador y:
>
> ```bash
> curl -X POST 'https://<PROJECT-REF>.supabase.co/rest/v1/rpc/update_user_role' \
>   -H 'apikey: <ANON-KEY>' \
>   -H 'Authorization: Bearer <ACCESS_TOKEN_DEL_ADMIN>' \
>   -H 'Content-Type: application/json' \
>   -d '{"p_user": "<UUID>", "p_role": "admin", "p_distributor": null}'
> ```
>
> **No sirve para dar de alta al primer admin**: el JWT del primer usuario
> (recién llegado como `operador`) recibe `'solo admin'` — pre-0011 el
> guard `my_role() IS DISTINCT FROM 'admin'` (B3) y post-0011
> `assert_admin()`. El bootstrap del primer admin es y sigue siendo
> **sólo** el paso 3, desde el SQL editor.
>
> (El Bearer debe ser el **JWT del admin**, no el anon key. "No funciona
> con el anon key solo" era **falso en el guard original** — el
> NULL-bypass de `<> 'admin'` dejaba pasar a cualquier caller sin rol —
> pero es verdad en la secuencia actual, por capas: 0004 cierra el bypass
> (B3) y 0006 suma `REVOKE EXECUTE ... FROM PUBLIC/anon`, así que con el
> anon key la llamada ya revienta con `permission denied` ANTES de correr
> el body; 0011 refuerza esa capa para el futuro — `ALTER DEFAULT
> PRIVILEGES` (sin `IN SCHEMA` para PUBLIC, que con la bug PG #8685 sería
> no-op) + sweep + whitelist explícita de 31 firmas (26 RPC + 5 helpers)
> que sólo devuelve `EXECUTE` a `authenticated`/`service_role`, de modo que
> toda función que agregue una migración futura nace sin EXECUTE para
> clientes; y si un cliente autenticado la invocara, `assert_admin()`
> responde `'solo admin'`. `service_role` sí conserva EXECUTE — es la vía
> de integración n8n/servidor (D-5), no la de bootstrap.)

## ¿Cómo verifico que funcionó?

```sql
SELECT u.id, u.email, r.name AS rol
FROM public.users u JOIN public.roles r ON r.id = u.role_id;
-- La columna "rol" debe decir 'admin' para tu usuario.
```

`0008_verify.sql` (V10) también avisa si no existe ningún admin activo.

---

## Cómo correr las migraciones

**Opción A — Supabase SQL editor (la del §7):** abrir cada archivo en orden
numérico y ejecutarlo. Los archivos son idempotentes donde importa (enums con
`IF NOT EXISTS`, seeds con `ON CONFLICT`, policies/REVOKE deterministas, y
0009-0012 enteros por `CREATE OR REPLACE`/`DROP IF EXISTS`/`CREATE INDEX IF
NOT EXISTS` — re-pegarlos no duplica nada), pero el orden 1→12 no se salta.

**Opción B — CLI local:** `supabase db push` (o `supabase migration up`) — el
orden numérico de los filenames se respeta automáticamente. El paso manual no
lo automatiza nadie: hacélo entre 0005 y 0006 (o después de 0006/0007 —
ninguna migración posterior impide el signup: los REVOKE de EXECUTE
(anon/PUBLIC) no tocan a los triggers de auth.users y 0011 lo confirma —
además PG no chequea EXECUTE al disparar un trigger, sólo lo exige al
CREATE TRIGGER; la advertencia de "antes de RLS" viene del §7 y aplica al
ideal, no a un bloqueo duro).

**Requisitos previos:** extensiones `postgis` y `pg_cron` disponibles en el
proyecto (Supabase las ofrece; 0001 las crea).

---

## Hardening 0009→0012: UNA sola ventana de mantenimiento

Las 4 migraciones del hardening (0009→0012) se pegan **en orden y en UNA
sola ventana de mantenimiento**, sin huecos entre archivos (nota ALTO del
change `sprint1-hardening`): 0009 hace que `my_role()` devuelva `NULL` para
usuarios inactivos, y desde ahí cualquier guard no NULL-safe queda como
bypass activo para ellos hasta que 0011 reemplace todos los guards
solo-admin por `assert_admin()`. En DB limpia los cuerpos de 0004 (B3:
`IS DISTINCT FROM`) y los re-bodies de 0009 (COALESCE en el DECLARE) ya
son NULL-safe, pero si la DB arrastra 0004 pre-B3 la ventana es real y se
cierra recién con 0011 aplicado — en cualquier caso el batch se aplica
entero. El authoring/copy puede ser archivo por archivo; lo que no debe
partirse es la **ejecución**.

Convención de bloques `-- INVERSE:` (aprendida en la review del batch 2):
van **comentados/inertes** — cada sentencia lleva prefijo `-- `. El SQL
editor ejecuta el archivo de punta a punta, así que un INVERSE con SQL vivo
se dispararía contra la misma DB que acabás de migrar. Para rollback:
descomentar el bloque a mano **en una transacción**, o `git revert` del
batch correspondiente.

`0012_verify_hardening.sql` exige 0009+0010+0011 ya aplicados; si falta
alguno, sus checks se SKIPean con NOTICE en vez de fallar (degradación
elegante). Verificá con H1-H4 (ver "Verificación post-migración").

## Qué NO está en estas migraciones (pendientes conscientes, §9/D22)

- `GIST (stores.location)` — umbral ~1.000 tiendas (D22).
- `GIN (search_vector)` + `pg_trgm (name)` — umbral ~50.000 productos (D22).
- `btree (stores.name)`, `btree (users.role_id)`, `btree (users.lower(full_name))`
  — solo si `pg_stat_statements` los reclama.
- `handle_new_user()` de NØSEE (sync a app_metadata) — no recreado: el doc no
  lo menciona.
- `handle_user_email_confirmed()` de NØSEE (email confirmado ⇒ `users.is_verified = TRUE`)
  — **resuelta (D44): descartada, confirma §2.9/0002** ("la verifica Supabase Auth").
  No se recrea: ni trigger, ni columna `users.is_verified`, ni cambios de conteo.

## Verificación post-migración

Corré `20261015000008_verify.sql` y esperá los NOTICE `V1 … OK` a `V10 OK`.
Cualquier WARNING indica un bloque incompleto — el mensaje dice cuál.

Tras aplicar el hardening, corré `20261016000012_verify_hardening.sql`: extiende
el patrón de 0008 con las secciones **H1-H4** (los checks de 0008 son V1…V10;
los de 0012 se llaman H): **H1** grants estáticos vía
`has_function_privilege`/`has_table_privilege`, que sí resuelven el grant
a PUBLIC (oid 0) — el V5 original de 0008 no lo veía y daba falso OK, ya
corregido allí mismo por B3 (chequea además el grantee 0); **H2** las 31
firmas de la whitelist con
`EXECUTE` (H2.1 `authenticated`, H2.2 `service_role`); **H3** tests negativos
RPC por batch (anon → `permission denied`, operador → `'solo admin'`, doble
`confirm_delivery`, pedido de otra tienda…, y helpers ejecutables desde
policies RLS);
**H4** RLS + PostGIS. No modifica el esquema: termina con conteo de veredictos
y un `SELECT` de todos los checks — cualquier FAIL investigalo antes de dar
por bueno el hardening. Si falta algún batch (0009-0011), los checks
dependientes salen SKIP con NOTICE.

Después, el smoke test manual del §7.11 (signup → rol → tienda → producto →
precio → entry/exit → pedido → entrega → ruta → crédito → pago → alertas →
perfil propio) valida el flujo completo de extremo a extremo.

Perfil propio (D45): como usuario **no-admin**, `UPDATE users SET full_name = ...`
sobre la fila propia **debe funcionar**; `UPDATE users SET role_id = ...` sobre la
misma fila **debe fallar** (permiso denegado a nivel de columna — grants ≠ RLS).

Columnas privilegiadas (D47): como **admin**, `set_user_premium(<UUID>, true)`
sobre otro usuario **debe** flipar `users.premium` y dejar una fila en
`audit_log` (tabla `users`, diff con `premium`); `set_user_active(<UUID>, false)`
idem con `is_active`. Como usuario **no-admin**, ambas llamadas **deben fallar**
("solo admin").
