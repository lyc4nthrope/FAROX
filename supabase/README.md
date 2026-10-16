# FAROX — Migraciones Supabase (Sprint 1)

Materialización del esquema según `Base de datos FAROX.md` (documento **autoridad**).
8 migraciones numeradas que se ejecutan **en orden estricto** — el orden numérico
del filename ES el orden de materialización del §7.

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
> caller admin (`my_role() IS DISTINCT FROM 'admin'` ⇒ RAISE, endurecido en
> el review de seguridad B3: el bypass por sesión sin `auth.uid()` quedó
> cerrado a propósito) y el primer usuario llega como `operador` — un
> operador no puede autopromoverse. El SQL editor corre como `postgres`,
> dueño de las tablas: salta RLS y los grants por columna (D45). Es el único
> camino legítimo de bootstrap (C2). **Una vez promovido, el admin opera
> desde la app como cualquier authenticated** — `update_user_role()` desde
> la app sirve para los siguientes usuarios.
>
> (La vía API con el `access_token` del usuario **no sirve** para la
> promoción inicial: su JWT es de `operador` y el guard lo rechaza.)

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
`IF NOT EXISTS`, seeds con `ON CONFLICT`, policies/REVOKE deterministas), pero
el orden 1→8 no se salta.

**Opción B — CLI local:** `supabase db push` (o `supabase migration up`) — el
orden numérico de los filenames se respeta automáticamente. El paso manual no
lo automatiza nadie: hacélo entre 0005 y 0006 (o después de 0006/0007, que no
impiden el signup — los REVOKE de EXECUTE (anon/PUBLIC) no tocan a los
triggers de auth.users: PG no chequea EXECUTE al disparar un trigger; la
advertencia de "antes de RLS" viene del §7 y aplica al ideal, no a un
bloqueo duro).

**Requisitos previos:** extensiones `postgis` y `pg_cron` disponibles en el
proyecto (Supabase las ofrece; 0001 las crea).

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
