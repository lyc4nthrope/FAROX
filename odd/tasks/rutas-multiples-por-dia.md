# Rutas múltiples por día

> **Objetivo:** permitir varias rutas del mismo distribuidor en una misma fecha.
> **Rama:** `feat/rutas-multiples-por-dia` (desde `main` 694281d).
> **Entrega:** commit en la rama; **no desplegar el front antes de aplicar la migración 0057**.
> **Runner:** Vitest (`npx vitest run`); SQL: `scripts/db-test.sh` (schema-check/CI).

## Specs

- **S1.** `routes` puede tener varias filas no canceladas por `(distributor_id, route_date)`. Se elimina `uq_routes_distributor_day`.
- **S2.** `create_route(p_distributor, p_route_date, p_stops)` crea **una ruta nueva** en estado `planned`; valida admin o distribuidor dueño, fecha, `p_stops` array, `stop_order > 0` y tiendas vinculadas al distribuidor; devuelve el id. Grants como las RPC de rutas.
- **S3.** `update_route_stops(p_route, p_stops)` reemplaza las paradas de una ruta **planned**; admin o distribuidor dueño; rechaza `active`, `completed` y `cancelled`; valida tiendas vinculadas; conserva el historial porque solo toca rutas planificadas. Grants.
- **S4.** `save_route` se conserva para el front ya desplegado; el front nuevo no lo usa. Queda como compatibilidad/deprecado.
- **S5.** `fetchTodayRoutes(date)` devuelve **todas** las rutas no canceladas del usuario para la fecha, ordenadas, con paradas y coordenadas. `fetchRouteDetail(id)` sigue para el detalle admin; el modo `null` devuelve la más reciente para no romper llamadas viejas.
- **S6.** `Mi ruta` lista todas las rutas de hoy. El resumen agrega rutas/paradas/pendientes. Cada ruta conserva su estado y acciones; una ruta completada queda de solo lectura para paradas, pero sus pedidos se siguen gestionando en «Pedidos de esta parada» o Mis pedidos.
- **S7.** Planner del distribuidor: **«Crear ruta»** crea una nueva con las tiendas marcadas; **«Editar paradas»** en una ruta planificada carga sus tiendas y guarda con `update_route_stops`; activa/completada no se editan; «Cancelar edición» vuelve al modo creación.
- **S8.** Planner del admin: «Crear ruta» crea una nueva; se elimina el bloqueo por ruta del día completada/activa y el uso de `fetchRouteStatusFor`; el listado muestra todas. El detalle de ruta no cambia.
- **S9.** Migración **0057** y documentación (manual, índice de BD, PLAN, README, guía de aplicación). El front nuevo requiere la 0057 aplicada antes del deploy.
- **S10.** Tests SQL de múltiples rutas/crear/editar/rechazos y tests Vitest de API/UI; se preservan las acciones de pedidos por parada.

## Tasks

| ID  | Specs | Ruta   | Estado | Evidencia                                                                                                         |
| --- | ----- | ------ | ------ | ----------------------------------------------------------------------------------------------------------------- |
| T1  | S1-S4 | inline | hecho  | `20261117120000_rutas_multiples_por_dia.sql` + `supabase/tests/0057_rutas_multiples.sql` (SQL local/CI pendiente) |
| T2  | S5    | inline | hecho  | `logistics/api.ts`: `fetchTodayRoutes`, `createRoute`, `updateRouteStops`; tests en `api.test.ts`                 |
| T3  | S6-S7 | inline | hecho  | `RoutePages.tsx`: lista de rutas, resumen, crear/editar, tests en `MyRoutePage.test.tsx`                          |
| T4  | S8    | inline | hecho  | `RoutesPage`: crear varias, sin chequeo por día; tests en `RoutesPage.test.tsx`                                   |
| T5  | S9    | inline | hecho  | Manual + Base de datos + PLAN + README + APLICAR                                                                  |
| T6  | S10   | inline | hecho  | Suite 992/992, focused 32/32, tsc/eslint/prettier limpios; SQL 0057 pendiente local/CI                            |

## Log

- **L1 (2026-11-17):** «La idea es que pueden existir varias rutas por dia, por ende no deberia solo dejar una por dia.»
- **L2 (2026-11-17):** Se confirmó la UX propuesta: `Mi ruta` lista las rutas de hoy; «Nueva ruta»/«Crear ruta» crea una con las tiendas marcadas; cada ruta planificada tiene «Editar paradas»; las completadas quedan de solo lectura para paradas (sus pedidos se gestionan en la parada o en Mis pedidos).
- **L3 (diseño):** se separan crear y actualizar para que `save_route` no tenga que adivinar cuál ruta editar. La edición se limita a `planned`; reemplazar paradas de una ruta activa reiniciaría el avance y una completada borraría historial. `orders.route_id` sigue sin usarse; los pedidos abiertos se muestran por tienda, así que si la misma tienda está en dos rutas el pedido aparece en ambas (la entrega desde cualquiera lo cierra).
- **L4 (entrega):** la migración 0057 debe aplicarse en producción **antes** del front nuevo. No se hace push a `main` sin esa condición.
- **L5 (2026-11-17, implementación):** migración 0057 con `create_route`/`update_route_stops` y drop del índice único; `fetchTodayRoutes`; `Mi ruta` lista todas las rutas, resumen agregado, «Crear ruta» y «Editar paradas»; planner admin crea varias. Verificación front: suite 992/992, focused 32/32, `tsc`, ESLint y Prettier limpios. El test SQL `0057` está escrito pero no se ejecutó localmente (no hay Supabase/Postgres en este entorno); lo corre `schema-check`.
- **L6 (2026-11-17, producción):** `supabase db push --remote --yes` aplicó 0057 en el proyecto `tzyqstnxbzyfmdxeuyvz`; `migration list --remote` quedó al día y la verificación read-only confirmó `index_dropped=true`, `create_route=true` y `update_route_stops=true`. Se sube la rama para review; **no se mergea a `main`** en este paso.
