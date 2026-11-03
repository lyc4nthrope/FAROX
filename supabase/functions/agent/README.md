# Edge Function `agent` — asistente de consultas (fase 1)

Un solo endpoint para todos los usuarios: la identidad sale del JWT y cada
herramienta corre como RPC con el cliente del usuario, así que la RLS decide
qué datos ve. **No escribe movimientos**: fase 1 solo consulta.

## Contrato

`POST /functions/v1/agent` con `Authorization: Bearer <access_token>`.

```json
{ "conversation_id": 12, "message": "¿cuánto hay de arroz?" }
```

- Sin `conversation_id` crea la conversación con `create_chat(p_title, p_store)`
  y usa `store_id` del body como contexto.
- Devuelve `{ "conversation_id": 12, "reply": "..." }`.
- `503` si `AGENT_ENABLED` no es `true`; `401` sin sesión; `429` al pasar 60
  consultas por hora; `502` si el proveedor falla.

## Herramientas (solo lectura)

| Tool | RPC | Qué devuelve |
|---|---|---|
| `buscar_producto` | `agent_search_products` | hasta 8 productos por nombre, marca o código |
| `consultar_stock` | `agent_stock` | stock por tienda, o «Mi catálogo» si es distribuidor |
| `dias_sin_pedido` | `agent_last_order` | último pedido por tienda y días transcurridos |

Las tres viven en la migración `0039_asistente_consultas.sql`.

## Secrets

```bash
supabase secrets set \
  GEMINI_API_KEY="..." \
  AGENT_MODEL="gemini-2.5-flash" \
  AGENT_ENABLED="true"
```

`AGENT_ENABLED` es el interruptor de lanzamiento: si falta o es `false`, la
función responde `503`.

## Deploy

```bash
supabase functions deploy agent
```

Conserva la verificación de JWT (no uses `--no-verify-jwt`).

## WhatsApp y reportes (fase 3)

`_shared/agent.ts` no sabe de HTTP: recibe `{ client, message, history }` y
devuelve `{ reply, toolLog }`. Un webhook de WhatsApp puede reutilizarlo
resolviendo el usuario por `users.phone_number` y creando un cliente con
`service_role` **después** de validar el número. Los reportes diarios pueden
llamar las mismas RPC de lectura desde un cron (n8n).
