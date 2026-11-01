# Aplicar las migraciones en producción (proyecto FAROX `tzyqstnxbzyfmdxeuyvz`)

Verificado el **2026-10-24**: los 17 archivos entonces vigentes (0001–0015, 0017, 0018; la 0016 está reservada para el chatbot y aún no existe) se aplican **de cero, en orden y sin errores** en un Supabase local, y `scripts/smoke-local.mjs` pasa **45/45** flujos. La 0019 y la 0020 se agregaron después: la 0020 solo reemplaza un helper y **no se pudo ejecutar en local** (el gate no tiene Supabase CLI/Postgres), así que su comportamiento se valida al aplicarla en el SQL editor. La **0021** agrega una RPC y reemplaza `create_order`; tampoco se ejecutó contra una base real en local. La **0022** agrega `stock.is_shortage` y 4 RPCs del catálogo del operador: **no se ejecutó contra una base real** y su comportamiento queda sin verificar hasta aplicarla. La **0023** acota el tablero de faltantes a la tienda (el distribuidor deja de verlo) y permite al operador crear el fiado de un pedido entregado: tampoco se ejecutó contra una base real. La **0024** hace nullable `order_items.unit_price` para que el operador solicite sin precio y agrega `set_order_prices` / `set_stock_threshold`: **no se ejecutó contra una base real**. La **0025** traslada «marcar en ruta» y «confirmar entrega» al distribuidor y agrega `set_order_expected_at`: tampoco se ejecutó contra una base real. La **0026** agrega `update_store_product` / `add_store_product` para editar y dar de alta un producto de la tienda en una sola llamada: tampoco se ejecutó contra una base real. La **0027** permite a Premium publicar precios, agrega el precio opcional al alta y a los movimientos: tampoco se ejecutó contra una base real. La **0028** hace reversible in_route → pending y deja que el operador de la tienda lea la cotización sin Premium: tampoco se ejecutó contra una base real. La **0029** extiende la cotización a in_route, agrega la venta directa del distribuidor y el contacto entre partes vinculadas: tampoco se ejecutó contra una base real. La **0030** corrige el alcance de edición (la ficha de `products` es solo del admin; cada parte edita su relación) y agrega precios de compra/venta por relación con prellenado de movimientos y cotizaciones: tampoco se ejecutó contra una base real. La **0031** agrega alertas notificables del distribuidor (stock bajo opt-in y caducidad) con su job diario: tampoco se ejecutó contra una base real. La **0032** agrega el estado Premium con vencimiento, planes versionados, desglose de precio y el modelo de suscripciones/pagos para Mercado Pago: tampoco se ejecutó contra una base real. El `supabase/demo-catalog.sql` es opcional (datos de demostración), idempotente y va **después** de las migraciones.

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
UNION ALL SELECT '0020 vínculo para operador con alcance',
  COALESCE((SELECT position('p_store = ANY (public.my_store_ids())' in prosrc) > 0
            FROM pg_proc
            WHERE proname = 'internal_can_manage_store'
              AND pronamespace = 'public'::regnamespace
            LIMIT 1), false)::text
UNION ALL SELECT '0021 solicitudes tienda ↔ distribuidor',
  COALESCE((SELECT position('no está vinculado a la tienda' in prosrc) > 0
            FROM pg_proc
            WHERE proname = 'create_order'
              AND pronamespace = 'public'::regnamespace
            LIMIT 1), false)::text
UNION ALL SELECT '0022 catálogo del operador',
  COALESCE((SELECT count(*) = 4 FROM pg_proc
            WHERE proname IN ('set_store_product_quantity','remove_store_product',
                              'set_store_shortage','list_shortage_products')
              AND pronamespace = 'public'::regnamespace), false)::text
UNION ALL SELECT '0023 faltantes solo de la tienda',
  COALESCE((SELECT position('store_distributors' in prosrc) = 0
            FROM pg_proc
            WHERE proname = 'list_shortage_products'
              AND pronamespace = 'public'::regnamespace
            LIMIT 1), false)::text
UNION ALL SELECT '0023 fiado del operador',
  COALESCE((SELECT position('tienda fuera del alcance del operador' in prosrc) > 0
            FROM pg_proc
            WHERE proname = 'create_credit'
              AND pronamespace = 'public'::regnamespace
            LIMIT 1), false)::text
UNION ALL SELECT '0024 solicitud sin precio',
  COALESCE((SELECT is_nullable = 'YES'
                   AND EXISTS (SELECT 1 FROM information_schema.columns c
                               WHERE c.table_schema = 'public' AND c.table_name = 'order_items'
                                 AND c.column_name = 'distributor_price')
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'order_items'
              AND column_name = 'unit_price'), false)::text
UNION ALL SELECT '0024 cotización y umbral',
  (to_regprocedure('public.set_order_prices(bigint,jsonb)') IS NOT NULL
   AND to_regprocedure('public.get_order_quotes(bigint)') IS NOT NULL
   AND to_regprocedure('public.set_stock_threshold(bigint,bigint,numeric)') IS NOT NULL)::text
UNION ALL SELECT '0025 ciclo del distribuidor',
  (to_regprocedure('public.set_order_expected_at(bigint,timestamptz)') IS NOT NULL
   AND COALESCE((SELECT position('distribuidor' in prosrc) > 0
                 AND position('operador' in prosrc) = 0
                 FROM pg_proc
                 WHERE proname = 'update_order_status'
                   AND pronamespace = 'public'::regnamespace
                 LIMIT 1), false)
   AND COALESCE((SELECT position('distribuidor' in prosrc) > 0
                 AND position('operador' in prosrc) = 0
                 FROM pg_proc
                 WHERE proname = 'confirm_delivery'
                   AND pronamespace = 'public'::regnamespace
                 LIMIT 1), false))::text
UNION ALL SELECT '0026 edición y alta de stock',
  (to_regprocedure('public.update_store_product(bigint,bigint,numeric,numeric,boolean)') IS NOT NULL
   AND (to_regprocedure('public.add_store_product(bigint,bigint,numeric,numeric)') IS NOT NULL
        OR to_regprocedure('public.add_store_product(bigint,bigint,numeric,numeric,numeric)') IS NOT NULL))::text
UNION ALL SELECT '0027 precios premium y movimientos',
  (COALESCE((SELECT position('publicar precios requiere Premium' in prosrc) > 0
             FROM pg_proc
             WHERE proname = 'set_price'
               AND pronamespace = 'public'::regnamespace
             LIMIT 1), false)
   AND to_regprocedure('public.register_entry(bigint,bigint,numeric,bigint,bigint,date,numeric)') IS NOT NULL
   AND to_regprocedure('public.register_exit(bigint,bigint,numeric,bigint,bigint,numeric)') IS NOT NULL
   AND to_regprocedure('public.add_store_product(bigint,bigint,numeric,numeric,numeric)') IS NOT NULL)::text
UNION ALL SELECT '0028 pedidos reversibles',
  (COALESCE((SELECT position('o.status = ''in_route'' AND p_status = ''pending''' in prosrc) > 0
             FROM pg_proc
             WHERE proname = 'update_order_status'
               AND pronamespace = 'public'::regnamespace
             LIMIT 1), false)
   AND COALESCE((SELECT position('o.store_id = ANY (public.my_store_ids())' in prosrc) > 0
                 FROM pg_proc
                 WHERE proname = 'get_order_quotes'
                   AND pronamespace = 'public'::regnamespace
                 LIMIT 1), false))::text
UNION ALL SELECT '0029 ventas y contacto',
  (to_regprocedure('public.register_distributor_sale(bigint,bigint,numeric,numeric,date)') IS NOT NULL
   AND to_regprocedure('public.get_counterpart_contact(text,bigint)') IS NOT NULL
   AND COALESCE((SELECT position('in_route' in prosrc) > 0
                 FROM pg_proc
                 WHERE proname = 'set_order_prices'
                   AND pronamespace = 'public'::regnamespace
                 LIMIT 1), false))::text
UNION ALL SELECT '0030 relaciones y precios',
  (EXISTS (SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'store_product_prices')
   AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'distributor_products'
                 AND column_name = 'sale_price')
   AND to_regprocedure('public.update_store_product_full(bigint,bigint,numeric,numeric,boolean,date,numeric,numeric)') IS NOT NULL
   AND to_regprocedure('public.update_distributor_product_relation(bigint,numeric,numeric,date,numeric,numeric)') IS NOT NULL)::text
UNION ALL SELECT '0031 alertas distribuidor',
  (to_regprocedure('public.internal_eval_distributor_alert(bigint,bigint)') IS NOT NULL
   AND to_regprocedure('public.job_scan_distributor_expiry()') IS NOT NULL
   AND EXISTS (SELECT 1 FROM pg_indexes
               WHERE schemaname = 'public' AND indexname = 'uq_alert_open'
                 AND indexdef LIKE '%distributor_id%')
   AND COALESCE((SELECT position('is_active' in prosrc) > 0
                 FROM pg_proc
                 WHERE proname = 'internal_eval_distributor_alert'
                   AND pronamespace = 'public'::regnamespace
                 LIMIT 1), false))::text
UNION ALL SELECT '0032 premium y planes',
  (EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'users'
             AND column_name = 'premium_until')
   AND to_regprocedure('public.quote_plan(text)') IS NOT NULL
   AND to_regprocedure('public.update_plan_pricing(text,integer,integer,boolean,integer,integer,integer,boolean,boolean)') IS NOT NULL
   AND to_regclass('public.plans') IS NOT NULL)::text
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
| 0020 | `20261025000020_store_link_store_users.sql` | `0020 … = true` — **sin esta, un operador asignado a la tienda no puede generar el QR de vínculo** | ✅ (`CREATE OR REPLACE`) |
| 0021 | `20261025000021_store_distributor_requests.sql` | `0021 … = true` — **sin esta, el operador puede pedir a cualquier distribuidor/producto** | ✅ (`CREATE OR REPLACE`) |
| 0022 | `20261025000022_catalogo_operador.sql` | `0022 … = true` — **sin esta, el operador no puede editar cantidades, marcar faltantes ni ver la vista `/faltantes`** | ✅ (`ADD COLUMN IF NOT EXISTS` + `CREATE OR REPLACE`) |
| 0023 | `20261026000023_faltantes_operador_y_fiado.sql` | `0023 … = true` (los dos) — **sin esta, el distribuidor sigue viendo los faltantes de la tienda y el operador no puede crear el fiado** | ✅ (`CREATE OR REPLACE` + `REVOKE`/`GRANT`) |
| 0024 | `20261026000024_solicitudes_sin_precio_y_cotizacion.sql` | `0024 … = true` (los dos) — **sin esta, el operador sigue sin poder solicitar sin precio y el inventario no puede limpiar umbrales** | ✅ (`CREATE OR REPLACE` + `REVOKE`/`GRANT`; el `ALTER` es idempotente) |
| 0025 | `20261026000025_ciclo_pedido_distribuidor.sql` | `0025 … = true` — **sin esta, el operador que pidió puede marcar en ruta/confirmar la entrega y no hay fecha editable** | ✅ (`CREATE OR REPLACE` + `REVOKE`/`GRANT`) |
| 0026 | `20261027000026_inventario_edicion_y_alta.sql` | `0026 … = true` — **sin esta, el inventario no puede editar cantidad+umbral en un solo guardado ni dar de alta con cantidad inicial** | ✅ (`CREATE OR REPLACE` + `REVOKE`/`GRANT`) |
| 0027 | `20261028000027_precios_premium_y_movimientos.sql` | `0027 … = true` — **sin esta, Premium no puede publicar precios y los movimientos no guardan el precio de compra/venta** | ✅ (`CREATE OR REPLACE` + `DROP`/`CREATE` de las firmas con precio) |
| 0028 | `20261028000028_pedidos_reversibles_y_precio_operador.sql` | `0028 … = true` — **sin esta, el distribuidor no puede devolver un pedido a pendiente y el operador no ve la cotización sin Premium** | ✅ (`CREATE OR REPLACE` + `REVOKE`/`GRANT`) |
| 0029 | `20261029000029_entregas_ventas_y_contacto.sql` | `0029 … = true` — **sin esta, no hay venta directa, la cotización no se ajusta en ruta y no hay botón de contacto** | ✅ (`CREATE OR REPLACE` + `REVOKE`/`GRANT`) |
| 0030 | `20261029000030_relaciones_precios.sql` | `0030 … = true` — **sin esta, el distribuidor no puede ajustar su cantidad/precios, la ficha global quedaría editable por su creador y no hay prellenado de movimientos** | ✅ (`ALTER TABLE` + `CREATE OR REPLACE` + policies) |
| 0031 | `20261029000031_alertas_distribuidor.sql` | `0031 … = true` — **sin esta, el umbral/vencimiento del distribuidor solo se ve como badge y no llega a `/alertas`** | ✅ (`DROP/CREATE INDEX` + `CREATE OR REPLACE` + cron) |
| 0032 | `20261029000032_premium_estado_planes.sql` | `0032 … = true` — **sin esta, no hay vencimiento de Premium, planes versionados ni desglose de precio** | ✅ (`ALTER TABLE` + `CREATE TABLE` + `CREATE OR REPLACE`) |
| seed | `supabase/demo-catalog.sql` (opcional) | — | ✅ (idempotente: `ON CONFLICT DO NOTHING`) |

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
-- 0021: productos solicitables (intersección) y create_order endurecido
SELECT has_function_privilege('authenticated','public.list_store_distributor_products(bigint,bigint)','EXECUTE'); -- true
SELECT has_function_privilege('authenticated','public.create_order(bigint,bigint,jsonb,timestamptz,text)','EXECUTE'); -- true
-- 0022: catálogo del operador (cantidad, baja, faltante y tablero)
SELECT has_column_privilege('authenticated','public.stock','is_shortage','SELECT');                                        -- true
SELECT has_function_privilege('authenticated','public.set_store_product_quantity(bigint,bigint,numeric)','EXECUTE');       -- true
SELECT has_function_privilege('authenticated','public.remove_store_product(bigint,bigint,boolean)','EXECUTE');             -- true
SELECT has_function_privilege('authenticated','public.set_store_shortage(bigint,bigint,boolean)','EXECUTE');               -- true
SELECT has_function_privilege('authenticated','public.list_shortage_products()','EXECUTE');                                -- true
-- 0023: alcance del tablero y fiado del operador
SELECT has_function_privilege('authenticated','public.create_credit(bigint,date)','EXECUTE');                                              -- true
-- 0024: solicitud sin precio, cotización del distribuidor y umbral editable
SELECT is_nullable FROM information_schema.columns
  WHERE table_schema='public' AND table_name='order_items' AND column_name='unit_price';                                                   -- YES
SELECT has_function_privilege('authenticated','public.set_order_prices(bigint,jsonb)','EXECUTE');                                          -- true
SELECT has_function_privilege('authenticated','public.set_stock_threshold(bigint,bigint,numeric)','EXECUTE');                             -- true
-- 0025: ciclo del pedido y fecha en manos del distribuidor
SELECT has_function_privilege('authenticated','public.set_order_expected_at(bigint,timestamptz)','EXECUTE');                                   -- true
SELECT has_function_privilege('authenticated','public.update_order_status(bigint,public.order_status,text)','EXECUTE');                        -- true
-- 0026: edición y alta de stock en una sola llamada
SELECT has_function_privilege('authenticated','public.update_store_product(bigint,bigint,numeric,numeric,boolean)','EXECUTE');                -- true
SELECT has_function_privilege('authenticated','public.add_store_product(bigint,bigint,numeric,numeric,numeric)','EXECUTE');                   -- true
-- 0027: precios Premium y precio en movimientos
SELECT has_function_privilege('authenticated','public.set_price(bigint,bigint,numeric(12,2),char(3))','EXECUTE');                              -- true
SELECT has_function_privilege('authenticated','public.register_entry(bigint,bigint,numeric,bigint,bigint,date,numeric)','EXECUTE');           -- true
SELECT has_function_privilege('authenticated','public.register_exit(bigint,bigint,numeric,bigint,bigint,numeric)','EXECUTE');                  -- true
SELECT has_function_privilege('authenticated','public.add_store_product(bigint,bigint,numeric,numeric,numeric)','EXECUTE');                    -- true
-- 0028: pedido reversible y cotización visible al operador
SELECT has_function_privilege('authenticated','public.update_order_status(bigint,public.order_status,text)','EXECUTE');                        -- true
SELECT has_function_privilege('authenticated','public.get_order_quotes(bigint)','EXECUTE');                                                    -- true
-- 0029: venta directa y contacto entre partes
SELECT has_function_privilege('authenticated','public.register_distributor_sale(bigint,bigint,numeric,numeric,date)','EXECUTE');               -- true
SELECT has_function_privilege('authenticated','public.get_counterpart_contact(text,bigint)','EXECUTE');                                          -- true
-- 0030: relaciones y precios
SELECT has_function_privilege('authenticated','public.update_store_product_full(bigint,bigint,numeric,numeric,boolean,date,numeric,numeric)','EXECUTE'); -- true
SELECT has_function_privilege('authenticated','public.update_distributor_product_relation(bigint,numeric,numeric,date,numeric,numeric)','EXECUTE');          -- true
-- 0032: Premium, planes y desglose
SELECT has_function_privilege('anon','public.quote_plan(text)','EXECUTE');                                                                     -- true
SELECT has_function_privilege('authenticated','public.quote_plan(text)','EXECUTE');                                                            -- true
SELECT has_function_privilege('authenticated','public.my_premium_status()','EXECUTE');                                                         -- true
SELECT has_function_privilege('service_role','public.activate_premium(uuid,integer,bigint)','EXECUTE');                                        -- true
-- 0032: los dos planes deben existir y estar activos
SELECT code, active, amount_cents FROM public.plans
WHERE code IN ('premium_monthly', 'premium_annual') ORDER BY code;                                                                             -- 2 filas
```

Y después:

1. Repetir el diagnóstico del paso 1: todo `true` y al menos 1 admin activo.
2. Supabase → Authentication → URL Configuration: Site URL y Redirect URLs con `https://<dominio>/auth/callback` y `https://<dominio>/restablecer`. Sin la segunda, el link de recuperación vuelve al Site URL y no abre la pantalla de nueva contraseña. En local, agregar también `http://localhost:5173/restablecer`.
3. Supabase → Authentication → Email Templates → **Reset Password**: mantener el link de confirmación (`{{ .ConfirmationURL }}`, el template por defecto). Ese link es el que verifica el token y redirige a `/restablecer`; si se reemplaza por un link propio, el flujo de recuperación deja de funcionar.
4. Probar el flujo de recuperación con un usuario real: `/login` → “¿Olvidaste tu contraseña?” → email → abrir el link → elegir una nueva contraseña.
5. Probar en la app con un **operador** (no admin): inventario, rutas y stock deben cargar (esto valida 0018).
6. **Nunca** correr `scripts/smoke-local.mjs` contra producción: crea usuarios y datos (además se niega si la URL no es local).

## 5. Opción C — que lo haga un agente con MCP

1. En la terminal (con `!` adelante):
   ```
   ! claude mcp add --scope local --transport http supabase "https://mcp.supabase.com/mcp?project_ref=tzyqstnxbzyfmdxeuyvz&features=database,docs,debugging,development"
   ```
   (sin `read_only=true`, que impide aplicar migraciones).
2. Reiniciar la sesión → `/mcp` → `supabase` → iniciar sesión con una cuenta con acceso al proyecto.
3. Instrucción **cerrada**, nunca "aplica las migraciones":
   > Aplica exactamente estos archivos, en este orden: 0013, 0014, 0015, 0017, 0018, 0019, 0020, 0021, 0022, 0023, 0024, 0025, 0026, 0027, 0028, 0029, 0030, 0031, 0032. Uno por transacción. Detente al primer error y muéstrame el mensaje; no improvises correcciones ni apliques nada más.
4. **Quitar el MCP al terminar**: `claude mcp remove supabase`. Un agente con escritura sobre producción no se deja instalado.

## 6. Trampas conocidas

- **Nunca re-ejecutar 0011 después de 0013/0015/0017/0018/0019.** `0011:467` hace `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated` y sólo re-otorga 31 firmas. Las 12 funciones nuevas (0015: 1, 0017: 4 ejecutables, 0018: 3, 0019: 3) quedarían sin permiso y el front rompería en inventario, rutas, stock, vínculos QR y catálogos. Si hay que re-aplicar 0011, re-otorgar después:
  ```sql
  GRANT EXECUTE ON FUNCTION public.register_distributor(text,text,text,text,text,public.contact_preference),
    public.get_store_link_code(bigint), public.regenerate_store_link_code(bigint),
    public.link_distributor_to_store(text), public.unlink_distributor(bigint,bigint),
    public.my_route_ids(), public.routes_with_my_stores(), public.stores_on_my_routes(),
    public.add_distributor_product(bigint), public.remove_distributor_product(bigint),
    public.unassign_product_from_store(bigint,bigint),
    public.list_store_distributor_products(bigint,bigint),
    public.create_order(bigint,bigint,jsonb,timestamptz,text),
    public.set_store_product_quantity(bigint,bigint,numeric),
    public.remove_store_product(bigint,bigint,boolean),
    public.set_store_shortage(bigint,bigint,boolean),
    public.list_shortage_products(),
    public.create_credit(bigint,date)
  TO authenticated, service_role;
  ```
- **H1.1/H1.3/H1.4 seguirán en FAIL.** No perseguirlos: ver §4. El job `schema-check` los trata como fallos conocidos y aceptados (`ACCEPTED_FAILS` en `scripts/parse-verify-output.mjs`) y sigue fallando ante cualquier otro `[FAIL]` o ante un `RESUMEN` cuyo conteo no cuadre con las líneas del log.
- **`db lint` también arrastra ruido de PostGIS** (sus funciones viven en `public`): el job excluye las funciones que pertenecen a una extensión y solo falla ante issues de código propio (`scripts/check-db-lint.mjs`).
- **0012 sólo verifica**: no cambia el esquema, se puede correr en cualquier momento.
- **No purgar `audit_log`**: el tope anti-huérfano de `register_distributor` cuenta las filas de auditoría.
- **`stores.link_code` no se lee por SELECT directo** (0017 revoca el SELECT de tabla y lo re-otorga columna por columna). Un `select('*')` sobre `stores` falla con `permission denied for column link_code`: pedir columnas explícitas.
