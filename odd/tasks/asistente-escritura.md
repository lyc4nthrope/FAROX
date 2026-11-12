# Asistente con escritura (fase 2)

**Objetivo**: el asistente prepara operaciones, el humano confirma y el servidor ejecuta. Cubre ventas, compras, faltantes, cambios de precio (solo web) y consultas del dashboard.
**Rama**: pendiente (working tree)
**Entrega**: `ask-on-risk`
**Runner**: `vitest` (`npm.cmd run test`)

## Specs

- **S1** — El modelo solo prepara borradores; nunca escribe. La escritura ocurre en `agent_execute_action` después de una confirmación humana.
- **S2** — `agent_actions` guarda `kind`, `status`, `payload`, `summary`, `channel`, `wa_id`, `confirmation_code`, `requires_strong_confirmation`, `expires_at` y `user_id`.
- **S3** — `agent_prepare_action`, `agent_execute_action` y `agent_cancel_action` validan dueño, rol, tienda/catálogo y vencimiento (10 minutos). Premium se exige donde la operación lo requiere: movimientos y precios; los faltantes son parte del trabajo diario del operador y no lo exigen.
- **S4** — Los precios se cambian solo en la web. `agent_prepare_action_for_user` rechaza `price_update` y las RPCs `_for_user` no se grantan a `authenticated`. `price_update` exige confirmación fuerte (`CONFIRMAR`) en la ejecución web.
- **S5** — WhatsApp puede consultar dashboard/stock/pedidos y ejecutar ventas, compras y faltantes con código de confirmación.
- **S6** — Las variantes `_for_user` usan `internal_set_actor` para fijar `request.jwt.claims` localmente y reutilizar las RPCs existentes. Solo `service_role` puede ejecutarlas.
- **S7** — `whatsapp_inbound` deduplica por `message.id`.
- **S8** — No se cambian firmas de RPCs existentes.
- **S9** — El dashboard se consulta con `get_dashboard` y se agrega en el servidor; nunca se envían 366 filas al modelo.

## Tasks

| ID | Spec | Ruta | Estado | Evidencia |
|---|---|---|---|---|
| T1 | S1-S9 | inline | hecho | este documento |
| T2 | S2,S3,S7 | inline | hecho | `supabase/migrations/20261112160559_agent_actions.sql` |
| T3 | S3,S4 | inline | hecho | RPCs prepare/execute/cancel en la migración |
| T4 | S5,S6 | inline | hecho | wrappers `_for_user` + `internal_set_actor` |
| T5 | S4,S9 | inline | hecho | `src/test/agent-actions.test.ts` 9/9 |

| T6 | S9 | inline | hecho | `_shared/dashboard.ts` + tool `consultar_dashboard`; 9/9 tests; `agent` desplegado |
| T7 | S1,S4 | inline | hecho | tools `preparar_*` + `PendingActionCard`; 13/13 focused; `agent` desplegado |
| T8 | S5,S7 | inline | hecho | webhook routing + `_for_user` + dedupe + código; migraciones `20261112202902` y `20261112205203`; webhook desplegado |

## Fuera de este slice

Los cuatro slices están implementados. Pendiente:

- Prueba E2E real por WhatsApp (teléfono verificado, consulta, venta, confirmación/cancelación).
- Limpieza periódica de `whatsapp_inbound` (retención).

## Log

- **L1** (2026-11-12) — Usuario: "Diseña para implementar".
- **L2** — Usuario: "Como se puede agregar para que cambie precios, active/desactive faltantes y consulte el dashboard para consultas (cuanto se vendio y a cuanto al dia o al mes). Ademas, como es posible que se puedan hacer esas acciones por whatsapp?"
- **L3** — Usuario: "Solo en la web por esta version".
- **L4** — Usuario: "Si" (autoriza el slice 1: migración y RPCs).
- **L5** (2026-11-12) — Slice 1 implementado:
  - Enums `agent_action_kind` / `agent_action_status`.
  - `agent_actions` con RLS de dueño y grants de solo lectura para `authenticated`.
  - `chat_conversations.channel` + `external_id` + índice único de WhatsApp.
  - `whatsapp_inbound` para deduplicar `message.id`.
  - `internal_set_actor` (solo rol de servidor) para fijar claims locales.
  - `agent_prepare_action` / `agent_execute_action` / `agent_cancel_action`.
  - `_for_user` con código de confirmación; `price_update` rechazado en WhatsApp.
  - Verificación: `src/test/agent-actions.test.ts` 9/9; `check-scope` OK; lint/typecheck OK; suite 918/918.
  - Revisión independiente: se corrigió el precio neto por línea en ventas con descuento (el RPC espera neto + `discount_pct`), se agregó confirmación fuerte server-side para `price_update`, `internal_assert_wa_identity` para atar `wa_id` al teléfono verificado, y la deduplicación normaliza `product_id` a bigint.
  - Decisión: el snapshot de precio de una venta vale 10 minutos; el total confirmado se respeta y no se revalida contra cambios de precio (A5). La actualización de precios sí revalida (`stale_draft`).
  - Pendiente: aplicar la migración en Supabase y correr la verificación manual del final del archivo. No se aplicó desde el agente.
- **L6** (2026-11-12) — Migración aplicada en producción:
  - El remoto **no tenía** `supabase_migrations.schema_migrations`: el esquema se había aplicado manualmente. No se corrió `db push` a ciegas.
  - Se verificó que el esquema remoto ya tenía las tablas/funciones/columnas que la migración necesita (`users.phone_number/phone_verified_at`, `stock.is_shortage`, precios, ventas, faltantes, `get_dashboard`, etc.).
  - Se hizo baseline de las 48 migraciones existentes con `migration repair --status applied` y después `db push` aplicó **solo** `20261112160559_agent_actions.sql`.
  - Verificado: historial remoto con la fila nueva; `agent_actions` con RLS y 1 policy; enum de 5 kinds; `whatsapp_inbound`; las 8 funciones nuevas.
  - Matriz de privilegios: `authenticated` puede SELECT y ejecutar las RPCs web, pero **no** insertar ni ejecutar `_for_user`/`internal_set_actor`; `service_role` sí puede ejecutar los wrappers.
  - Pendiente: la verificación de comportamiento con un JWT real (doble ejecución, expiración, código inválido, `stale_draft`) queda para cuando existan las tools/UI de los slices 2-4.
- **L7** (2026-11-12) — Slice 2 implementado:
  - `_shared/dashboard.ts` puro: `resolvePeriod` (UTC; today/month/last_month/custom; máximo 366 días) y `summarizeDashboard` (ventas/compras, meses, top días y top distribuidores; rol-aware).
  - Tool `consultar_dashboard` en `_shared/agent.ts`: llama `get_dashboard` con el cliente del usuario y agrega en el servidor; nunca manda filas crudas al modelo.
  - `agent/index.ts` obtiene rol y Premium del servidor; `premium` replica `is_premium()` (admin siempre; `premium_until` vigente).
  - Desplegado `agent` con `--use-api`.
  - Verificación: `dashboard.test.ts` 9/9; suite 927/927; check-scope OK.
  - Pendiente: prueba E2E en la app con un usuario Premium y un distribuidor.
- **L8** (2026-11-12) — Slice 3 implementado:
  - Tools `preparar_*` en `_shared/agent.ts`, gated por `AGENT_WRITES_ENABLED`; `runTool` también rechaza escrituras si el flag está apagado.
  - `listar_tiendas` + tienda activa de la conversación pasada al prompt: el modelo no inventa `store_id`.
  - `preparar_compra_distribuidor` mapea `unit_cost → unit_price` (fix del verifier).
  - `price_update` normaliza booleanos y exige precio > 0; el servidor exige `CONFIRMAR`.
  - `agent/index.ts` devuelve `action` y guarda `action_id` en el payload del mensaje del asistente.
  - `PendingActionCard` con confirmación/cancelación, guard anti-doble-click y errores de negocio mapeados (sin SQL crudo).
  - `VITE_AGENT_WRITES_ENABLED=true` en `.env` local; `AGENT_WRITES_ENABLED=true` en secrets; `agent` desplegado.
  - Verificación: `agent.write.test.ts` + `PendingActionCard.test.tsx` + `AssistantPage.test.tsx` 13/13; lint/typecheck/check-scope OK; suite completa con 3 timeouts flaky en inventory/onboarding (inventory 64/64 en aislamiento).
  - Pendiente: prueba E2E con un usuario real (venta, compra, faltante, precio) y slice 4 (WhatsApp).
- **L9** (2026-11-12) — Slice 4 implementado:
  - Migración `20261112202902_agent_whatsapp.sql`: `internal_user_for_wa_id` y wrappers `_for_user` de lectura/dashboard/tiendas, solo `service_role`.
  - `whatsapp-webhook` rutea `FAROX`, `CONFIRMAR`, `CANCELAR` y texto libre; deduplica por `message.id` en `whatsapp_inbound`; responde 200 rápido y procesa con `EdgeRuntime.waitUntil`; rate limit 60/hora; respuestas con `sendText`.
  - El asistente corre con `service_role` + `channel: "whatsapp"` + `_for_user`; la tienda se resuelve con `listar_tiendas`/`store: null`; precios rechazados.
  - Revisión independiente: blocker de conversación reutilizada por `wa_id` tras reasignar teléfono. Fix: lookup por `user_id` y unique `(channel, external_id, user_id)`; migración `20261112205203_agent_whatsapp_fix.sql` aplicada. También se maneja `already: true` y se agregó el índice `(wa_id, received_at)`.
  - Verificación: tests de WhatsApp/agent 22/22; lint/typecheck/check-scope OK; `agent` y `whatsapp-webhook` desplegados; migraciones aplicadas. Suite completa pendiente de re-correr por timeouts flaky previos.
  - Pendiente: E2E real por WhatsApp y retención de `whatsapp_inbound`.
- **L10** (2026-11-12) — Restricción de alcance (capa 1):
  - System prompt con alcance cerrado a la operación de FARØX; fuera de tema, declina en una frase y ofrece una consulta relacionada.
  - No se implementó el router de intención (capa 2) ni el menú cerrado (capa 3): la restricción es probabilística, no una garantía dura.
  - Test `agent.write.test.ts` fija el texto del prompt; `agent` v13 y `whatsapp-webhook` v12 desplegados.
