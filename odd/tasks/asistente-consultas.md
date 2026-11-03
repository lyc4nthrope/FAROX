# Asistente de consultas (fase 1)

Rama `daniel` · entrega por work-units · runner `npm run ci`.

Objetivo: un asistente que responda preguntas de stock y de último pedido por
producto, con el alcance de cada usuario. Fase 1 **solo lectura**.

## Specs

- **S1.** Existe `/asistente` para admin, operador y distribuidor, con entrada en el nav.
- **S2.** Un único endpoint (`agent`) atiende a todos; la identidad sale del JWT y la RLS decide qué datos ve cada uno.
- **S3.** La conversación puede llevar `store_id` como contexto, validado contra el alcance del usuario.
- **S4.** Herramientas fijas de lectura: buscar producto (nombre, marca, código), consultar stock y días sin pedido. El modelo nunca ejecuta SQL libre.
- **S5.** El asistente no inventa datos: si una herramienta no devuelve nada, lo dice y pide otro término.
- **S6.** Fase 1 no registra ventas ni compras: si se lo piden, lo explica.
- **S7.** Límite de 60 consultas por hora por usuario y mensajes de hasta 800 caracteres.
- **S8.** La UI muestra sugerencias, la conversación y los errores sin perder lo ya escrito.
- **S9.** WhatsApp y reportes quedan preparados por diseño: el núcleo `runAgent` no depende de HTTP.

## Tasks

- **T1.** Migración `0039`: `chat_conversations.store_id`, `create_chat(text, bigint)`, `agent_search_products`, `agent_stock`, `agent_last_order` + grants. — hecho (pendiente de aplicar en Supabase)
- **T2.** Edge Function `agent` + `_shared/agent.ts` (prompt, tools, bucle de tool-calling). — hecho (sin Deno local: falta `deno check` y deploy)
- **T3.** Frontend: `features/assistant` (api + página), ruta `/asistente`, nav, descripciones. — hecho
- **T4.** Gate de alcance `§S8`: chat_* y create_chat/send_message salen de las listas diferidas. — hecho
- **T5.** Tests y CI. — hecho

## Log

### L1 — pedido (verbatim)

> Me parece. Una cosa, el proyecto se quiere implementar un chatbot o agente que ayude a las tiendas o los distribuidores con los procesos de consultar o realizar acciones, como seria solo decir "vendi 2 de tal cosa a tanto" y el agente lo registra solo, o que pueda consultar como que diga "hace cuanto no se pide x producto" o "cuanto hay de x prodcuto" y le informe.
> [...] la idea era con n8n y se vincula por usuario [...]

### L2 — decisión de arquitectura

- Un endpoint, no un webhook por usuario: la privacidad es RLS, no la URL.
- Edge Function como orquestador (misma región, secrets, patrón `userClient`/`serviceClient` ya existente). n8n queda para lo asíncrono (reportes, WhatsApp).
- Fase 1 solo lectura: cero riesgo de escrituras mal registradas.

### L3 — hallazgo

El esquema ya tenía `chat_conversations`, `chat_messages` (`chat_role` + `payload`) y las RPC `create_chat`/`send_message` sin usar: la mitad del backend estaba hecha y el gate `§S8` las tenía como diferidas.

### L4 — implementación

- Migración `0039` (pendiente de aplicar): columna `store_id`, overload de `create_chat`, tres RPC de lectura con `translate` para acentos (sin `pg_trgm`, D22).
- Edge Function `agent` con Gemini (`AGENT_MODEL`, por defecto `gemini-2.5-flash`), `AGENT_ENABLED` como interruptor, tope de 60/hora y guardado de mensajes `assistant`/`tool` con `service_role` **después** de validar la conversación con el JWT.
- UI: `/asistente` con selector de tienda opcional, sugerencias, burbujas y errores.
- `§S8` actualizado: `create_chat`, `send_message`, `chat_conversations`, `chat_messages` dejan de ser diferidas.

### L5 — pendiente de despliegue

1. Aplicar `0037`, `0038` y `0039` en Supabase.
2. `supabase secrets set GEMINI_API_KEY=... AGENT_ENABLED=true`.
3. `supabase functions deploy agent`.
4. `deno check supabase/functions/agent/index.ts supabase/functions/_shared/agent.ts` (no hay Deno en el entorno local).

### L6 — límite conocido

La búsqueda es `LIKE` normalizado, no fuzzy: un error de tipeo ("arrox") no encuentra el producto. `pg_trgm` (D22) queda para cuando se priorice la búsqueda global.

### L7 — obsolescencia del modelo (2026-11-03)

- `runAgent` distingue `ModelUnavailableError` (404, o 400 con "not found / no longer / deprecated") y reintenta **una vez** con `AGENT_FALLBACK_MODEL`, que queda activo para el resto del turno.
- `agent` registra `agent MODEL_UNAVAILABLE` y responde 503 con «El asistente está en mantenimiento».
- `agent-health` (nuevo, cron con `x-cron-secret` o admin) hace un ping de 1 token: 200 si el primario vive, 200 con `fallback_used` si ya cayó, 503 si cayeron los dos.
- Cambiar de modelo es `supabase secrets set AGENT_MODEL=...` + `functions deploy agent`; no hay que tocar código.
- Runbook completo en `supabase/functions/agent/README.md`.

### L8 — widget flotante y WhatsApp (2026-11-03)

- **S10.** El chat vive en `AssistantChat` y lo comparten `/asistente` y el widget flotante (burbuja abajo a la derecha) montado en `AppShell`; se oculta en `/asistente` y cierra con Esc.
- **S11.** El chat muestra «WhatsApp ↗» cuando `VITE_WHATSAPP_AGENT_NUMBER` está definido; abre `wa.me` con mensaje prellenado.
- El número **no responde solo**: falta el webhook de Meta, la verificación de firma y el alcance por usuario (el webhook no tiene JWT). Documentado en el README de la función; no se implementó un webhook a medias por el riesgo de suplantación.
- `npm run ci` en verde.
