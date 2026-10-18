# FAROX — Vista entities (SQL reorganizado por entidad)

**Estos archivos son una REORGANIZACIÓN de la MISMA SQL de `supabase/migrations/`** — misma semántica, mismos cuerpos (VERBATIM, con cita `archivo:línea` en cada bloque). **La secuencia oficial de migración sigue siendo `supabase/migrations/`** (0001→0012, orden numérico estricto — ver `supabase/README.md`): esta vista existe para legibilidad, revisión y para poder pegar entidad por entidad en el SQL editor, NO como reemplazo del mecanismo de migraciones.

No modifica nada: es re-escritura verbatim. Si alguna vez divergen, **mandan las migraciones**.

## Orden de ejecución (Supabase SQL editor)

Abrí cada archivo y pegá su contenido completo, en este orden numérico exacto:

| # | Archivo | Origen (migración) |
|---|---------|--------------------|
| 00 | `00_foundation.sql` | 0001 (ext+enums) + **helpers de alcance finales** (0009) + `assert_admin` (0011) + `touch_updated_at` (0004) + `audit_diff` final (0010) |
| 01-06 | `01_store_types` … `06_motives` | 0002/0003 (tablas catálogo) + 0006 (RLS) |
| 07-11 | `07_users` … `11_user_stores` | 0002/0003 + 0006 + 0004 (triggers/RPCs) |
| 12-16 | `12_price_publications` … `16_movements` | ídem |
| 17-20 | `17_routes` … `20_credit_payments` | ídem |
| 21-25 | `21_alerts` … `25_audit_log` | ídem |
| **30** | **`30_negocio.sql`** | RPCs multi-entidad: 0004 (`internal_stock_entry`, `create_store`) + 0009 (`register_entry/exit`) + 0010 (`confirm_delivery`, `create_order`) + 0011 (`update_user_role`, `set_user_premium`, `set_user_active`, `register_reverse`) — **versiones FINALES** |
| **40** | **`40_seeds.sql`** | 0005 (seeds de catálogos; grep confirma: 0003 NO tiene seeds) |
| **50** | **`50_realtime.sql`** | 0007 (poda de la publicación `supabase_realtime`: solo `alerts` + `dashboard_daily`) |
| **60** | **`60_jobs.sql`** | 0004 (`job_scan_expiry_soon/order_late/credit_overdue` — únicas definiciones del proyecto) + 0007 (`cron.schedule` diario 11:00 UTC = 06:00 America/Bogota) |
| **90** | **`90_security.sql`** | 0011 §D-5 (lockdown global: default privileges, sweep, whitelist de 31 firmas, PostGIS re-grant, anon sin DML, audit_log append-only) |
| **95** | **`95_verify.sql`** | 0012 completo (checks H0-H4; NO modifica nada; correrla es opcional pero recomendada) |

`00_foundation.sql` **DEBE correr primero**: los enums y los 6 helpers (`my_role`, `is_premium`, `my_store_ids`, `my_distributor_id`, `has_scope`, `assert_admin`) los usan las policies RLS de 01-25 y las RPC de 30. (PostgreSQL analiza el qual de un `CREATE POLICY` al CREARLO — `CreatePolicy` → `transformWhereClause`, src `backend/commands/policy.c` — así que `my_role()` tiene que existir ANTES del primer `CREATE POLICY`, que está en `01_store_types.sql`.)

### `check_function_bodies` (nota importante)

Los helpers SQL-language de `00_foundation` referencian tablas (`users`, `roles`, `user_stores`) que todavía NO existen cuando corre ese archivo. Por eso `00_foundation.sql` envuelve su sección 3 en `SET check_function_bodies = off;` … `SET check_function_bodies = on;` (líneas 18 y 293): sin ese SET, `CREATE FUNCTION` fallaría validando el body contra el catálogo. Los cuerpos se resuelven en RUNTIME. El resto de la secuencia (01-95) corre con la validación default **activa** — todos sus objetos se crean DESPUÉS de sus tablas.

### Correr en el SQL editor de Supabase

Abrí el archivo, copiá TODO el contenido y pegalo en el SQL editor (New query → pegar → Run). Un archivo = un paste. El editor envuelve el paste en una transacción implícita multi-statement: si algo falla, revierte el archivo completo. Todos los CREATE son idempotentes (`CREATE OR REPLACE`, `DROP ... IF EXISTS`, `ON CONFLICT DO NOTHING`, `cron.unschedule` previo) — re-pegar un archivo no duplica nada.

⚠️ **Paso manual de bootstrap** (igual que en `supabase/README.md`): los usuarios NO se seedean. Después de correr `40_seeds.sql`, hacé signup del primer usuario (queda como `operador` vía `handle_new_user`) y promovelo a `admin` desde el SQL editor con un `UPDATE public.users ... SET role_id = (SELECT id FROM public.roles WHERE name = 'admin')`. Sin eso, ninguna RPC admin funciona. El bypass `session_user() = 'postgres' AND auth.uid() IS NULL` de `assert_admin()` preserva ese bootstrap.

## RPCs colocadas en `30_negocio.sql` (multi-entidad) — con las tablas que tocan

| RPC | Tablas tocadas | Versión final = |
|-----|----------------|-----------------|
| `internal_stock_entry` | stock, movements, alerts (vía `internal_eval_stock_alert`) | 0004:185 (única definición) |
| `create_store` | stores, user_stores (+ valida store_types; tope D34 vía triggers de 09) | 0004:635 (única definición) |
| `update_user_role` | users, roles (+ distributor_id) | **0011:85** (guard `assert_admin`) |
| `set_user_premium` | users (columna privilegiada D47) | **0011:111** |
| `set_user_active` | users (columna privilegiada D47) | **0011:126** |
| `register_entry` | orders, order_items, price_publications, stock, movements, dashboard_daily | **0009:101** (0011 no la re-definió) |
| `register_exit` | ídem (sin expiry) | **0009:159** |
| `confirm_delivery` | orders, order_items, stock, movements, dashboard_daily, motives, alerts | **0010:58** (batcheado D-2 + dedup) |
| `create_order` | orders, order_items, price_publications, products, stores, distributors | **0010:187** (set-based R12) |
| `register_reverse` | movements, stock, dashboard_daily, alerts, audit_log | **0011:192** (guard `assert_admin`) |

### Dónde vive cada resto (NO duplicado en 30)

- `my_role`/`is_premium`/`my_store_ids`/`my_distributor_id`/`has_scope` → `00_foundation.sql` §3.1-3.5 (final 0009); `assert_admin` → §3.6 (final 0011).
- `enforce_store_cap` + trigger `trg_stores_cap_reactivate` → `09_stores.sql` (final 0009).
- `create_credit`/`cancel_credit`/`register_payment` → `19_credits.sql` (finales 0011/0009/0009); `register_payment_reverse` → `20_credit_payments.sql` (final 0011).
- `set_price` → `12_price_publications.sql` · `assign_user_stores` → `11_user_stores.sql` · `assign_product_to_store`/`get_stock` → `15_stock.sql` · `update_order_status` → `13_orders.sql` · `save_route`/`update_route_status` → `17_routes.sql` · `mark_stop` → `18_route_stops.sql` · `mark_alert_read` + `internal_alert_*` → `21_alerts.sql` · `internal_dashboard_upsert`/`get_dashboard` (final 0010, ≤366d) → `24_dashboard_daily.sql` · `audit_diff` (final 0010) → `00_foundation.sql` §4 y `25_audit_log.sql` · `create_chat`/`send_message` → `22`/`23`.

### Notas de verificación (grep-checked antes de escribir)

- **Vistas**: la ÚNICA vista del proyecto es `public.stores_geo` (grep `CREATE (OR REPLACE )?VIEW` → solo `0004:1539` y `09_stores.sql:98`). `routes_select`, `orders_select`, `credits_select` etc. **NO son vistas — son policies RLS**.
- **Seeds**: solo `0005_seeds.sql` tiene `INSERT INTO` de datos (grep sobre `0001-0003`: 0 seeds).
- **Realtime**: no hay sentencias `ALTER PUBLICATION` sueltas — viven como `EXECUTE` dinámicos dentro del bloque DO de `0007` (copiado completo en `50_realtime.sql`).
- **`verify_schema_integrity` / `verify_rls_policies`**: NO EXISTEN en el proyecto (grep sin matches). La capa de verificación es el **script** `0012` (bloques DO + `pg_temp.v0012_rec`), copiado íntegro en `95_verify.sql`.
- **`job_scan_*`**: sin overrides — las definiciones de `0004` SON las finales (grep: 1 ocurrencia por función).
