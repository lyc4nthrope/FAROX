# Aplicar las migraciones en producción (proyecto FAROX `tzyqstnxbzyfmdxeuyvz`)

Verificado el 2026-10-25: las 17 migraciones (0001–0015, 0017, 0018; la 0016 está reservada para el chatbot y aún no existe) se aplican **de cero, en orden y sin errores** en un Supabase local, y `scripts/smoke-local.mjs` pasa **45/45** flujos.

> ⚠️ Es la base de producción. Hacerlo **una sola persona** (Daniel, gate H1), en **una sola ventana**, y avisar en el canal antes y después.

## 1. Diagnóstico (solo lectura) — qué tiene hoy producción

Pegar en el SQL editor y guardar el resultado:

```sql
SELECT 'tablas public' AS chequeo, count(*)::text AS valor FROM pg_tables WHERE schemaname = 'public'
UNION ALL SELECT '0011 assert_admin', (to_regprocedure('public.assert_admin()') IS NOT NULL)::text
UNION ALL SELECT '0013 register_distributor', (to_regprocedure('public.register_distributor(text,text,text,text,text,public.contact_preference)') IS NOT NULL)::text
UNION ALL SELECT '0014 user_stores legible', has_table_privilege('authenticated', 'public.user_stores', 'SELECT')::text
UNION ALL SELECT '0015 guard de rol', (SELECT position('solo una cuenta nueva' in prosrc) > 0 FROM pg_proc WHERE proname = 'register_distributor' LIMIT 1)::text
UNION ALL SELECT '0017 store_distributors', (to_regclass('public.store_distributors') IS NOT NULL)::text
UNION ALL SELECT '0018 my_route_ids', (to_regprocedure('public.my_route_ids()') IS NOT NULL)::text
UNION ALL SELECT 'historial CLI', (to_regclass('supabase_migrations.schema_migrations') IS NOT NULL)::text
UNION ALL SELECT 'admins activos', (SELECT count(*) FROM public.users u JOIN public.roles r ON r.id = u.role_id WHERE r.name = 'admin' AND u.is_active)::text;
```

Si la consulta falla porque falta `public.users`, la base está vacía: ir directo al paso 2 desde la 0001.

## 2. Aplicar lo que falte, en orden

Aplicar **cada archivo completo**, en este orden, saltando solo los que el diagnóstico marque como `true`:

| # | Archivo | Se nota en el diagnóstico |
|---|---|---|
| 0001–0010 | `20261015000001_…` a `20261016000010_perf.sql` | `tablas public` > 0 |
| 0011 | `20261016000011_seguridad.sql` (**versión corregida**: `session_user` sin paréntesis) | `0011 assert_admin = true` |
| 0012 | `20261016000012_verify_hardening.sql` (solo verifica) | — |
| 0013 | `20261019000013_registration_hardening.sql` | `0013 … = true` |
| 0014 | `20261020000014_user_stores_read.sql` | `0014 … = true` |
| 0015 | `20261023000015_registration_guards.sql` | `0015 … = true` |
| 0017 | `20261024000017_store_links.sql` | `0017 … = true` |
| 0018 | `20261024000018_fix_routes_rls_recursion.sql` | `0018 … = true` — **sin esta, inventario y rutas fallan para no-admin** |

- **Opción A, SQL editor:** pegar un archivo a la vez (cada pegado es una transacción: si falla, no queda a medias).
- **Opción B, CLI:** `supabase link --project-ref tzyqstnxbzyfmdxeuyvz` → si el historial no tiene las versiones ya aplicadas a mano, marcarlas con `supabase migration repair --status applied <versión>` → `supabase db push`.
- **Opción C, Claude Code con el MCP de Supabase:** ver el final de este archivo.

## 3. Primer admin (si `admins activos = 0`)

Registrarse desde la app y luego, en el SQL editor (ver `supabase/README.md`):

```sql
UPDATE public.users u SET role_id = r.id FROM public.roles r
WHERE u.email = '<email-del-admin>' AND r.name = 'admin';
```

## 4. Verificar

1. Correr `20261015000008_verify.sql` y `20261016000012_verify_hardening.sql` y revisar que no haya `FAIL`. Con 0013–0018 aplicadas, el conteo exacto de la lista de funciones permitidas de 0012 marca diferencia: es esperado (son las funciones nuevas).
2. Repetir el diagnóstico del paso 1: todo `true` y al menos 1 admin activo.
3. Supabase → Authentication → URL Configuration: Site URL y Redirect URLs con `https://<dominio>/auth/callback`.
4. **Nunca** correr `scripts/smoke-local.mjs` contra producción: crea usuarios y datos (además se niega si la URL no es local).

## Opción C — que lo haga Claude Code

1. En la terminal de Claude Code (con `!` adelante):
   ```
   ! claude mcp add --scope local --transport http supabase "https://mcp.supabase.com/mcp?project_ref=tzyqstnxbzyfmdxeuyvz&features=database,docs,debugging,development"
   ```
   (sin `read_only=true`, que impide aplicar migraciones).
2. Reiniciar Claude Code → `/mcp` → `supabase` → iniciar sesión en el navegador con una cuenta con acceso al proyecto.
3. Pedirle: "aplica las migraciones en producción siguiendo `supabase/APLICAR-EN-PRODUCCION.md`".
