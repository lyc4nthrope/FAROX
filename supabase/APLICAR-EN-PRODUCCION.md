# Aplicar las migraciones en producción (proyecto FAROX `tzyqstnxbzyfmdxeuyvz`)

Verificado el **2026-10-24**: los 17 archivos (0001–0015, 0017, 0018; la 0016 está reservada para el chatbot y aún no existe) se aplican **de cero, en orden y sin errores** en un Supabase local, y `scripts/smoke-local.mjs` pasa **45/45** flujos.

> ⚠️ Es la base de producción. Hacerlo **una sola persona** (Daniel, gate H1), en **una sola ventana**, y avisar en el canal antes y después.

## 0. Antes de tocar nada (no es opcional)

1. **Respaldo.** El `backup-weekly` de hoy no sirve como red (sin cifrar, ver B0.4). Sacar un `pg_dump` manual del esquema y guardarlo fuera del repo. 0017 altera `stores` con backfill y 0018 **reemplaza policies**: sin respaldo no hay vuelta atrás.
2. **Guardar las policies actuales** (rollback de 0018 sin depender del dump):
   ```sql
   SELECT c.relname, p.polname, pg_get_expr(p.polqual, p.polrelid) AS using_expr
   FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('routes','route_stops','stock')
   ORDER BY 1, 2;
   ```
3. **Aplicar las migraciones ANTES de desplegar el front nuevo.** El front nuevo llama `get_store_link_code`, `my_route_ids`, etc. Al revés, el front rompe. Con el front viejo, 0017 es compatible (sus consultas piden columnas explícitas y ninguna pide `link_code`).

## 1. Diagnóstico (solo lectura) — qué tiene hoy producción

Pegar en el SQL editor y guardar el resultado:

```sql
SELECT 'tablas public' AS chequeo, count(*)::text AS valor
  FROM pg_tables WHERE schemaname = 'public'
UNION ALL SELECT 'helpers 0009',
  (to_regprocedure('public.has_scope()') IS NOT NULL
   AND to_regprocedure('public.my_store_ids()') IS NOT NULL)::text
UNION ALL SELECT '0011 assert_admin',
  (to_regprocedure('public.assert_admin()') IS NOT NULL)::text
UNION ALL SELECT '0011 corregido (session_user sin paréntesis)',
  COALESCE((SELECT position('session_user = ''postgres''' in prosrc) > 0
            FROM pg_proc WHERE proname = 'assert_admin' LIMIT 1), false)::text
UNION ALL SELECT 'pgcrypto en extensions (0017 lo usa)',
  (to_regprocedure('extensions.gen_random_bytes(integer)') IS NOT NULL)::text
UNION ALL SELECT '0013 register_distributor',
  (to_regprocedure('public.register_distributor(text,text,text,text,text,public.contact_preference)') IS NOT NULL)::text
UNION ALL SELECT '0014 user_stores legible',
  has_table_privilege('authenticated', 'public.user_stores', 'SELECT')::text
UNION ALL SELECT '0015 guard de rol',
  COALESCE((SELECT position('solo una cuenta nueva' in prosrc) > 0
            FROM pg_proc WHERE proname = 'register_distributor' LIMIT 1), false)::text
UNION ALL SELECT '0015 guard último admin',
  COALESCE((SELECT position('último administrador activo' in prosrc) > 0
            FROM pg_proc WHERE proname = 'update_user_role' LIMIT 1), false)::text
UNION ALL SELECT '0017 store_distributors',
  (to_regclass('public.store_distributors') IS NOT NULL)::text
UNION ALL SELECT '0017 stores.link_code',
  (SELECT count(*) = 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'link_code')::text
UNION ALL SELECT '0017 link_code NO legible por la app',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'link_code')
       THEN (NOT has_column_privilege('authenticated', 'public.stores', 'link_code', 'SELECT'))::text
       ELSE 'n/a (0017 sin aplicar)' END
UNION ALL SELECT '0018 my_route_ids',
  (to_regprocedure('public.my_route_ids()') IS NOT NULL)::text
UNION ALL SELECT '0019 distributor_products',
  (to_regclass('public.distributor_products') IS NOT NULL)::text
UNION ALL SELECT '0019 RPCs de catálogo',
  (to_regprocedure('public.add_distributor_product(bigint)') IS NOT NULL
   AND to_regprocedure('public.remove_distributor_product(bigint)') IS NOT NULL
   AND to_regprocedure('public.unassign_product_from_store(bigint,bigint)') IS NOT NULL)::text
UNION ALL SELECT 'admins activos',
  (SELECT count(*) FROM public.users u JOIN public.roles r ON r.id = u.role_id
   WHERE r.name = 'admin' AND u.is_active)::text;
```

Si la consulta falla porque falta `public.users`, la base está vacía: ir directo al paso 2 desde la 0001.
Si `pgcrypto en extensions` sale `false`, **detenerse**: 0017 falla al crear el default de `link_code`.

## 2. Aplicar lo que falte, en orden

Aplicar **cada archivo completo**, en este orden, saltando solo los que el diagnóstico marque como `true`:

| # | Archivo | Se nota en el diagnóstico | ¿Re-ejecutable? |
|---|---|---|---|
| 0001–0010 | `20261015000001_…` a `20261016000010_perf.sql` | `tablas public` > 0 y `helpers 0009 = true` | ⚠️ solo si falta; no re-aplicar a ciegas |
| 0011 | `20261016000011_seguridad.sql` (**versión corregida**: `session_user` sin paréntesis) | `0011 assert_admin` + `0011 corregido` | ⛔ **no re-ejecutar** (ver §6) |
| 0012 | `20261016000012_verify_hardening.sql` (solo verifica) | — | ✅ siempre |
| 0013 | `20261019000013_registration_hardening.sql` | `0013 … = true` | ✅ `CREATE OR REPLACE` + `GRANT` |
| 0014 | `20261020000014_user_stores_read.sql` | `0014 … = true` | ✅ |
| 0015 | `20261023000015_registration_guards.sql` | `0015 … = true` (los dos) | ✅ |
| 0016 | *(no existe — reservada para el chatbot)* | — | — |
| 0017 | `20261024000017_store_links.sql` | `0017 … = true` (los tres) | ✅ |
| 0018 | `20261024000018_fix_routes_rls_recursion.sql` | `0018 … = true` — **sin esta, inventario y rutas fallan para no-admin** | ✅ |
| 0019 | `20261025000019_catalogo_por_rol.sql` | `0019 … = true` (los dos) — **sin esta, el catálogo de tienda/distribuidor falla** | ✅ (`CREATE TABLE IF NOT EXISTS` + `CREATE OR REPLACE`) |

- **Opción A, SQL editor:** pegar un archivo a la vez (cada pegado es una transacción: si falla, no queda a medias).
- **Opción B, CLI:** `supabase link --project-ref tzyqstnxbzyfmdxeuyvz` → si el historial no tiene las versiones ya aplicadas a mano, marcarlas con `supabase migration repair --status applied <versión>` → `supabase db push`.
- **Opción C, agente con MCP de Supabase:** ver §5.

## 3. Primer admin (si `admins activos = 0`)

Registrarse desde la app y luego, en el SQL editor (ver `supabase/README.md`):

```sql
UPDATE public.users u SET role_id = r.id FROM public.roles r
WHERE u.email = '<email-del-admin>' AND r.name = 'admin';
```

## 4. Verificar — resultados esperados EXACTOS

Correr `20261015000008_verify.sql` y `20261016000012_verify_hardening.sql`.

> **`0012` NO va a salir limpio, y no es un error de aplicación.** Estos FAIL son el estado correcto:

| Check | Resultado esperado | Motivo |
|---|---|---|
| **H1.1** | **FAIL** | `anon` conserva EXECUTE sobre las funciones de la **extensión PostGIS**, instalada en `public` por `0001:9` (`CREATE EXTENSION postgis` sin schema). 0011 no puede revocarlas: el rol del SQL editor no es su owner ni su grantor. No son superficie de la app |
| **H1.3** | **FAIL**, con **43** funciones y **9** extras | `v_n = 34` está hardcodeado y `v_expected` no incluye: `register_distributor` (0015) + 5 de 0017 (`internal_can_manage_store`, `get_store_link_code`, `regenerate_store_link_code`, `link_distributor_to_store`, `unlink_distributor`) + 3 de 0018 (`my_route_ids`, `routes_with_my_stores`, `stores_on_my_routes`) |
| **H1.4** | **FAIL** | mitad `anon`/PostGIS del mismo origen que H1.1 |
| **H1.2** | **OK** | las 17 funciones de la deny-list siguen sin grant |
| **H2.1 / H2.2** | **OK (31/31)** | la whitelist de 0011 tiene EXECUTE |
| **H3.1–H3.5** | **OK** | guards de `assert_admin` intactos |
| H4.x | **WARNING** | informativo |

Para que H1.3 vuelva a verde hace falta una migración de verificación nueva que extienda la lista esperada (B3/pgTAP). **No editar 0012**: ya se aplicó y el PLAN §3.3 solo permite tocar 0011.

Además, comprobar a mano lo que 0012 no cubre:

```sql
-- La app no puede leer el código de vínculo por SELECT directo
SELECT has_column_privilege('authenticated','public.stores','link_code','SELECT');  -- false
-- Las RPC nuevas sí son invocables por un usuario autenticado
SELECT has_function_privilege('authenticated','public.get_store_link_code(bigint)','EXECUTE');      -- true
SELECT has_function_privilege('authenticated','public.internal_can_manage_store(bigint)','EXECUTE'); -- false
-- 0019: catálogo por entidad
SELECT has_function_privilege('authenticated','public.add_distributor_product(bigint)','EXECUTE');           -- true
SELECT has_function_privilege('authenticated','public.remove_distributor_product(bigint)','EXECUTE');        -- true
SELECT has_function_privilege('authenticated','public.unassign_product_from_store(bigint,bigint)','EXECUTE'); -- true
SELECT has_table_privilege('authenticated','public.distributor_products','SELECT');                          -- true
```

Y después:

1. Repetir el diagnóstico del paso 1: todo `true` y al menos 1 admin activo.
2. Supabase → Authentication → URL Configuration: Site URL y Redirect URLs con `https://<dominio>/auth/callback`.
3. Probar en la app con un **operador** (no admin): inventario, rutas y stock deben cargar (esto valida 0018).
4. **Nunca** correr `scripts/smoke-local.mjs` contra producción: crea usuarios y datos (además se niega si la URL no es local).

## 5. Opción C — que lo haga un agente con MCP

1. En la terminal (con `!` adelante):
   ```
   ! claude mcp add --scope local --transport http supabase "https://mcp.supabase.com/mcp?project_ref=tzyqstnxbzyfmdxeuyvz&features=database,docs,debugging,development"
   ```
   (sin `read_only=true`, que impide aplicar migraciones).
2. Reiniciar la sesión → `/mcp` → `supabase` → iniciar sesión con una cuenta con acceso al proyecto.
3. Instrucción **cerrada**, nunca "aplica las migraciones":
   > Aplica exactamente estos archivos, en este orden: 0013, 0014, 0015, 0017, 0018, 0019. Uno por transacción. Detente al primer error y muéstrame el mensaje; no improvises correcciones ni apliques nada más.
4. **Quitar el MCP al terminar**: `claude mcp remove supabase`. Un agente con escritura sobre producción no se deja instalado.

## 6. Trampas conocidas

- **Nunca re-ejecutar 0011 después de 0013/0015/0017/0018/0019.** `0011:467` hace `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated` y sólo re-otorga 31 firmas. Las 12 funciones nuevas (0015: 1, 0017: 4 ejecutables, 0018: 3, 0019: 3) quedarían sin permiso y el front rompería en inventario, rutas, stock, vínculos QR y catálogos. Si hay que re-aplicar 0011, re-otorgar después:
  ```sql
  GRANT EXECUTE ON FUNCTION public.register_distributor(text,text,text,text,text,public.contact_preference),
    public.get_store_link_code(bigint), public.regenerate_store_link_code(bigint),
    public.link_distributor_to_store(text), public.unlink_distributor(bigint,bigint),
    public.my_route_ids(), public.routes_with_my_stores(), public.stores_on_my_routes(),
    public.add_distributor_product(bigint), public.remove_distributor_product(bigint),
    public.unassign_product_from_store(bigint,bigint)
  TO authenticated, service_role;
  ```
- **H1.1/H1.3/H1.4 seguirán en FAIL.** No perseguirlos: ver §4. El job `schema-check` los trata como fallos conocidos y aceptados (`ACCEPTED_FAILS` en `scripts/parse-verify-output.mjs`) y sigue fallando ante cualquier otro `[FAIL]` o ante un `RESUMEN` cuyo conteo no cuadre con las líneas del log.
- **0012 sólo verifica**: no cambia el esquema, se puede correr en cualquier momento.
- **No purgar `audit_log`**: el tope anti-huérfano de `register_distributor` cuenta las filas de auditoría.
- **`stores.link_code` no se lee por SELECT directo** (0017 revoca el SELECT de tabla y lo re-otorga columna por columna). Un `select('*')` sobre `stores` falla con `permission denied for column link_code`: pedir columnas explícitas.
