# Edge Function `agent` — asistente de consultas (fase 1)

Un solo endpoint para todos los usuarios: la identidad sale del JWT y cada
herramienta corre como RPC con el cliente del usuario, así que la RLS decide
qué datos ve. En fase 2 puede **preparar borradores** de ventas, compras,
faltantes y precios; la escritura real requiere confirmación humana.

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

## Herramientas de lectura

| Tool | RPC | Qué devuelve |
|---|---|---|
| `buscar_producto` | `agent_search_products` | hasta 8 productos por nombre, marca o código |
| `consultar_stock` | `agent_stock` | stock por tienda, o «Mi catálogo» si es distribuidor |
| `dias_sin_pedido` | `agent_last_order` | último pedido por tienda y días transcurridos |
| `listar_tiendas` | `stores` / `store_distributors` | tiendas accesibles con `id` y nombre; evita inventar `store_id` |
| `consultar_dashboard` | `get_dashboard` | ventas/compras agregadas por día/mes, top días y top distribuidores; rol-aware y solo Premium |

Las tres de productos viven en la migración `0039_asistente_consultas.sql`.

`consultar_dashboard` agrega en el servidor (`_shared/dashboard.ts`) y devuelve un resumen compacto; nunca manda las 366 filas al modelo. Para admin/operador, ventas = salidas y compras = entradas; para distribuidor, ventas = entradas (ventas a tiendas).

## Alcance

Solo responde sobre la operación de FARØX. Si la pregunta es de otro tema,
declina en una frase y ofrece una consulta relacionada. Es una restricción de
prompt (capa 1): reduce el uso fuera de alcance, no es una garantía dura.

## Herramientas de escritura (fase 2)

Solo se ofrecen si `AGENT_WRITES_ENABLED=true`. Preparan un borrador en
`agent_actions`; no escriben hasta que el usuario confirma en la tarjeta.

| Tool | Kind | Ejecuta al confirmar |
|---|---|---|
| `preparar_salida_tienda` | `store_exit` | `register_movements_bulk` |
| `preparar_venta_distribuidor` | `distributor_sale` | `register_distributor_sales_bulk` |
| `preparar_compra_distribuidor` | `distributor_purchase` | `register_distributor_purchases` |
| `preparar_cambio_precios` | `price_update` | `set_store_prices_bulk` / `set_distributor_prices_bulk` (solo web) |
| `preparar_faltante` | `shortage_toggle` | `set_store_shortage` |

El frontend muestra las tarjetas con `VITE_AGENT_WRITES_ENABLED=true`. Los precios solo se cambian en la web; el wrapper de WhatsApp rechaza `price_update`. La tienda activa de la conversación se pasa al modelo; si no hay, `listar_tiendas` entrega los IDs reales.

## Secrets

```bash
supabase secrets set \
  AGENT_API_KEY="..." \
  AGENT_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai" \
  AGENT_MODEL="gemini-2.5-flash" \
  AGENT_FALLBACK_MODEL="gemini-2.5-flash-lite" \
  AGENT_ENABLED="true" \
  AGENT_WRITES_ENABLED="true"
```

`AGENT_ENABLED` es el interruptor de lanzamiento: si falta o es `false`, la
función responde `503`. `AGENT_FALLBACK_MODEL` se usa si el primario deja de
existir; nunca se llama si el primario responde. `GEMINI_API_KEY` todavía se
acepta como nombre alternativo de `AGENT_API_KEY`.

## Proveedores

La función habla la API **compatible con OpenAI** (`POST /chat/completions` con
function calling), así que cambiar de proveedor es cambiar tres secretos:

| Proveedor | `AGENT_BASE_URL` | Ejemplo de `AGENT_MODEL` |
|---|---|---|
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| OpenRouter | `https://openrouter.ai/api/v1` | `google/gemini-2.5-flash` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Mistral | `https://api.mistral.ai/v1` | `mistral-small-latest` |
| Together | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| LiteLLM / AI Gateway | la URL del gateway | el id que exponga el gateway |

Requisito: el proveedor tiene que soportar **function calling**. Un modelo que
no lo soporte puede responder texto, pero nunca va a consultar stock ni pedidos;
el `agent-health` no detecta eso, así que se prueba en el set de evaluación.

Si algún proveedor exige otro header de auth (por ejemplo `api-key` en Azure),
el único archivo a tocar es `_shared/agent.ts` (`providerHeaders`).


## Deploy

```bash
supabase functions deploy agent
supabase functions deploy agent-health --no-verify-jwt
```

`agent` conserva la verificación de JWT. `agent-health` se despliega sin JWT
para que el cron use `x-cron-secret`; cuando lo llama un humano, valida el JWT
y el rol admin dentro de la función.

## Obsolescencia del modelo

**Cómo te enterás**

1. **Antes de que falle**: la página de deprecaciones de Gemini publica la fecha
   de retiro; conviene revisarla cada release. Google también avisa por email a
   la cuenta del proyecto.
2. **Chequeo diario** (lo importante): un cron llama `agent-health` con
   `x-cron-secret`. Responde `200 {ok:true}` si el primario vive; `200
   {ok:true, fallback_used:true}` si ya cayó pero el respaldo funciona (y deja
   `PRIMARY_MODEL_UNAVAILABLE` en el log); `503` si cayeron los dos. Alertá con
   Resend/WhatsApp sobre el `503` y sobre `fallback_used:true`.
3. **En caliente**: la función registra `agent MODEL_UNAVAILABLE` y responde
   `503` con «El asistente está en mantenimiento». Si ves esa línea o ese
   mensaje, el modelo configurado ya no existe.

Un cron mínimo (Supabase `pg_cron` + `pg_net`, o n8n):

```sql
select cron.schedule(
  'agent-health',
  '17 6 * * *',
  $$select net.http_post(
      url := 'https://<proyecto>.supabase.co/functions/v1/agent-health',
      headers := '{"x-cron-secret":"<CRON_SECRET>"}'::jsonb
    )$$
);
```

**Cómo cambiás de modelo (sin deploy de código)**

```bash
# 1. Ver qué modelos existen hoy (catálogo del proveedor; en Gemini:)
curl "https://generativelanguage.googleapis.com/v1beta/models?key=$AGENT_API_KEY"

# 2. Cambiar el primario y, si hace falta, el respaldo
supabase secrets set AGENT_MODEL="gemini-3.5-flash" AGENT_FALLBACK_MODEL="gemini-2.5-flash"

# 3. Forzar que las instancias tomen el secreto nuevo
supabase functions deploy agent

# 4. Verificar
curl -X POST "https://<proyecto>.supabase.co/functions/v1/agent-health" \
  -H "x-cron-secret: <CRON_SECRET>"
```

El respaldo ya cubre la ventana entre el retiro y el cambio de secreto: el
turno reintenta una vez con `AGENT_FALLBACK_MODEL` y sigue. Si el cambio es de
proveedor, el único archivo a tocar es `_shared/agent.ts`; usar un gateway
compatible con OpenAI (OpenRouter, LiteLLM o Vercel AI Gateway) convierte el
proveedor en otra variable de entorno.

Después de cambiar de modelo, corré el set de evaluación (40 frases por rol) y
compará la tasa de tool-calling antes de dar el cambio por bueno.

## WhatsApp (acceso desde la UI)

El chat muestra «WhatsApp ↗» cuando el build del frontend define
`VITE_WHATSAPP_AGENT_NUMBER` (solo dígitos, con código de país). Abre
`https://wa.me/<número>` con un mensaje prellenado para que el usuario agregue
el número.

**Eso es solo el acceso: el número todavía no responde solo.** Para que conteste
hacen falta cuatro piezas que no están en este repo:

1. WhatsApp Business Platform (Meta): número verificado y `phone_number_id`.
2. `whatsapp-webhook` con la verificación `GET` (`hub.verify_token`) y el `POST`
   validando `x-hub-signature-256` con el app secret.
3. Resolver el usuario por `users.phone_number` **activo**. El teléfono pasa a
   ser identidad: requiere opt-in explícito y número verificado, o cualquiera
   que escriba al número opera como otro usuario.
4. Ejecutar las tools con el alcance de ese usuario. El webhook no tiene JWT de
   Supabase, así que `auth.uid()` no existe: hacen falta variantes
   `agent_*_for_user(uuid)` con guard de `service_role`, o un gateway que emita
   un JWT de corta vida. No alcanza con cambiar el cliente.

## Alternativas a WhatsApp Business

De más a menos recomendable para arrancar:

1. **Widget web** (ya existe): costo cero, sin alta ni verificación.
2. **Telegram Bot API**: gratis, sin tarjeta, webhook en minutos con un token de BotFather. Es el mejor canal para un piloto real fuera de la app.
3. **WhatsApp Business Cloud API con número de prueba**: Meta da un número de prueba y hasta 5 destinatarios verificados **sin método de pago**. Alcanza para validar el flujo completo. Para producción: número propio, verificación del negocio y método de pago.
4. **Instagram / Messenger**: mismo backend de Meta y la misma complejidad operativa.
5. **SMS (Twilio)**: cobra por mensaje y no tiene la familiaridad de WhatsApp.
6. **NO usar** librerías no oficiales (Baileys, whatsapp-web.js): violan los términos de WhatsApp, el número se banea y el riesgo cae sobre el producto.

Sobre el crédito de USD 200: es del **proveedor de IA** (Google Cloud/Vertex o similar), no de WhatsApp. WhatsApp no cobra por el entorno de prueba; el modelo sí consume ese crédito si usás Vertex. Con la Gemini API o un free tier de otro proveedor alcanza para el piloto, con límites de tasa y datos usados para mejorar el producto.

## Reportes (fase 3)

`_shared/agent.ts` no sabe de HTTP: recibe `{ client, message, history }` y
devuelve `{ reply, toolLog, model }`. Los reportes diarios pueden llamar las
mismas RPC de lectura (`agent_stock`, `agent_last_order`) desde un cron con
`service_role` + alcance explícito, o desde n8n con un usuario de servicio.

