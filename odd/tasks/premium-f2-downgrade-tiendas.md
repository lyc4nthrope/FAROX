# FAROX — Premium F2: downgrade de tiendas y modal

> **Objetivo:** cuando vence Premium, el usuario elige una tienda principal o renueva; las demás se pausan sin borrar datos.
> **Rama:** `daniel`. **Entrega:** commits de unidad; sin push.
> **Runner:** `npm run test`, `typecheck`, `lint`, `check-scope`, `build`.
> **Plan de referencia:** `odd/tasks/premium-suscripciones-mercado-pago.md` (F2).

## Specs

- **S1.** Al vencer Premium, el usuario con 2–3 tiendas activas ve un **modal** con la lista de sus tiendas: elige una «principal» o renueva para conservar las 3.
- **S2.** La tienda elegida queda activa y marcada «Principal» mientras el plan sea gratuito; las demás pasan a `is_active=false` con `deactivated_reason='premium_expired'` y `deactivated_at`. No se borra stock, pedidos, rutas, créditos ni historial.
- **S3.** Durante la gracia de 7 días el modal es descartable («Decidir después»); después de la gracia es bloqueante (sin ESC, sin fondo, sin cerrar). El CTA de renovar siempre está disponible.
- **S4.** Si el usuario no elige, un job diario conserva la tienda más antigua y pausa las demás; notificación pendiente para F5.
- **S5.** `my_store_ids()` filtra `stores.is_active`: una tienda pausada no es operable por el usuario, aunque su data sigue para el admin.
- **S6.** Al renovar, el usuario puede reactivar sus tiendas pausadas por plan hasta el tope de 3. El trigger de tope sigue siendo la última defensa.
- **S7.** El perfil enlaza a «Gestionar mis tiendas» (`/premium/tiendas`), donde ve activas/pausadas y reactiva si es Premium.
- **S8.** `/premium` existe como destino de «Renovar» (placeholder hasta F3/F4); el modal no se superpone en esa ruta.
- **S9.** Las operaciones de downgrade/reactivación son RPC autenticadas, con alcance desde el JWT; el cliente no escribe `stores.is_active` directamente para el flujo de plan.

## Tasks

| ID | Specs | Ruta | Estado | Evidencia |
|---|---|---|---|---|
| T1 | S1-S2, S5-S6 | inline | hecho | migración 0033: columnas, `my_store_ids`, RPCs, job/cron |
| T2 | S8-S9 | inline | hecho | API premium: `my_owned_stores`, choose/reactivate, tipos |
| T3 | S1-S3, S7 | inline | hecho | modal bloqueante/descartable, perfil con enlace, página `/premium/tiendas` |
| T4 | S8 | inline | hecho | rutas `/premium` (desglose inicial) y `/premium/tiendas`; pago deshabilitado hasta F4 |
| T5 | S1-S9 | inline | hecho | tests UI/API/estáticas, typecheck, lint, check-scope, 700 tests y build en verde |

## Log

- **L1 (2026-11-01):** «Si, sigue» — continuar con F2 tras cerrar F1. La selección de tienda debe ser un modal con las 3 tiendas, opción de conservar una como principal o renovar para mantener las 3.
- **L2 (2026-11-02):** F2 implementado: migración 0033 (`deactivated_reason/at`, `my_store_ids` activo, `my_owned_stores`, choose/reactivate, job/cron), modal bloqueante/descartable, página `/premium/tiendas`, perfil con «Gestionar mis tiendas» y `/premium` inicial con desglose real de `quote_plan`. 700 tests, typecheck, lint, check-scope y build en verde. 0033 no se ejecutó contra Postgres.
- **L3 (verificador 0033):** B1 corregido: `reactivate_premium_stores` ya no deduplica `p_ids`; los IDs repetidos fallan por el conteo. Se agregó un **focus trap** al modal bloqueante, un selector de tienda principal en `/premium/tiendas` para poder decidir después de cerrar el modal, y advisory locks por usuario en choose/reactivate para serializar dos pestañas. Queda como advisory que el flujo se basa en tiendas `created_by` (no asignadas) y que un free legado sin fechas no tiene gracia. 701 tests y build en verde.
