# Edge Function `whatsapp-webhook` — verificación y asistente

Recibe los mensajes de WhatsApp Cloud API. Confirma el teléfono del usuario con
`FAROX <código>`, rutea las consultas al asistente y confirma o cancela
borradores con `CONFIRMAR <código>` / `CANCELAR <código>`.

## Flujo

```
/perfil ──RPC phone_verification_start('300 222 3333')──► código A1B2C3
   │                                                        │
   │  el usuario lo ve en pantalla                           │
   ▼                                                        ▼
WhatsApp: "FAROX A1B2C3" ──► Meta ──► POST /functions/v1/whatsapp-webhook
                                              │
                                     verifica x-hub-signature-256
                                              │
                                     RPC phone_verification_confirm_whatsapp(
                                       p_wa_id = from, p_code = A1B2C3)
                                              │
                                     users.phone_number = '+573002223333'
                                     users.phone_verified_at = now()
```

El `from` del mensaje es el `wa_id` que Meta ya verificó. El código está atado
al número que el usuario declaró en la app; si no coinciden, la RPC responde
`invalid`.

## Contrato

| Método | Uso                                                                               |
| ------ | --------------------------------------------------------------------------------- |
| `GET`  | Verificación de Meta: `hub.mode=subscribe` + `hub.verify_token` + `hub.challenge` |
| `POST` | Mensajes entrantes; exige `x-hub-signature-256` válida sobre el body **crudo**    |

Siempre responde `200` rápido (salvo firma inválida) y procesa en background:
un `500` o un timeout hace que Meta reintente y duplique mensajes. `expired` no
genera respuesta para no contestar en los reintentos.

## Asistente y confirmaciones

Cada mensaje de texto se deduplica por `message.id` en `whatsapp_inbound` y se
procesa en background (`EdgeRuntime.waitUntil`) para responder rápido a Meta.

| Texto              | Ruta                                             |
| ------------------ | ------------------------------------------------ |
| `FAROX A1B2C3`     | `phone_verification_confirm_whatsapp`            |
| `CONFIRMAR A1B2C3` | `agent_execute_action_for_user`                  |
| `CANCELAR A1B2C3`  | `agent_cancel_action_for_user`                   |
| otro texto         | asistente (`runAgent` con `channel: "whatsapp"`) |

Identidad: `wa_id` → `internal_user_for_wa_id` (teléfono verificado + usuario
activo). Sin teléfono verificado no hay asistente ni acciones. El asistente usa
`service_role` y las variantes `_for_user` (solo `service_role`), que fijan las
claims del usuario y reutilizan las RPCs con su rol/Premium/RLS.

Una operación preparada responde con el resumen y un código de 6 caracteres:

```text
Salida de tienda
Tienda Centro
Arroz × 2 — $ 9.000
Total: $ 9.000
Respondé CONFIRMAR A1B2C3 para aplicarlo, o CANCELAR A1B2C3.
```

El código vence a los 10 minutos y está atado al `wa_id`; otro teléfono no puede
confirmarlo. Los precios **no** se cambian por WhatsApp: `price_update` se rechaza
en `agent_prepare_action_for_user` y solo se aplica desde la web.

Rate limit: 60 mensajes entrantes por `wa_id` por hora (índice
`idx_whatsapp_inbound_wa_received`).

## Secrets

```bash
supabase secrets set \
  WHATSAPP_VERIFY_TOKEN="<token que elegís vos>" \
  WHATSAPP_APP_SECRET="<App Secret de Meta>" \
  WHATSAPP_PHONE_NUMBER_ID="<phone_number_id>" \
  WHATSAPP_TOKEN="<access token de Cloud API>" \
  WHATSAPP_GRAPH_VERSION="v21.0" \
  AGENT_ENABLED="true" \
  AGENT_API_KEY="..." \
  AGENT_WRITES_ENABLED="true"
```

- `WHATSAPP_VERIFY_TOKEN`: obligatorio para el `GET` de alta del webhook.
- `WHATSAPP_APP_SECRET`: obligatorio para validar la firma. Sin él, el webhook
  responde `500` y no procesa nada.
- `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_TOKEN`: opcionales. Solo se usan para
  responder «✅ Teléfono verificado». Si faltan, la verificación igual se guarda.
- `WHATSAPP_GRAPH_VERSION`: opcional, default `v21.0`.

## Alta en Meta

1. Crear una app en <https://developers.facebook.com> y agregar el producto
   **WhatsApp**.
2. Usar el número de prueba (hasta 5 destinatarios verificados, sin tarjeta).
3. En **WhatsApp → Configuration → Webhook**:
   - Callback URL: `https://<proyecto>.supabase.co/functions/v1/whatsapp-webhook`
   - Verify token: el mismo `WHATSAPP_VERIFY_TOKEN`.
   - Suscribir el campo **messages**.
4. Copiar el **App Secret** (Settings → Basic) a `WHATSAPP_APP_SECRET`.
5. Para responder, copiar el **Phone number ID** y generar un **access token**
   permanente (System User) o temporal.

## Deploy

```bash
supabase functions deploy whatsapp-webhook --no-verify-jwt
```

`--no-verify-jwt` es obligatorio: Meta no manda un JWT de Supabase. La
autenticidad la da la firma HMAC del body.

## Formato del mensaje

```
FAROX A1B2C3
```

- Se acepta `farox: a1b2c3`, mayúsculas o minúsculas.
- El código tiene 6 caracteres alfanuméricos y expira a los 10 minutos.
- Máximo 5 intentos por código; 3 códigos por hora por usuario.
- Un número verificado pertenece a una sola cuenta.

## Seguridad

- La firma se calcula sobre el texto crudo, antes de `JSON.parse`. Re-serializar
  el JSON cambia los bytes y rompe la validación.
- Comparación de firmas en tiempo constante.
- Sin `service_role` en el cliente: la RPC de confirmación está grantada solo a
  `service_role` y el webhook la invoca desde el servidor.
- `phone_verified_at` no está en el `GRANT UPDATE` de perfil; solo lo escribe la
  RPC `SECURITY DEFINER`.
- Cambiar `phone_number` por `UPDATE` directo borra la verificación (trigger
  `clear_phone_verification_on_change`).

## Fuera de alcance

- Imágenes, audio, botones e interactivos (solo texto).
- Plantillas para mensajes iniciados por el negocio fuera de la ventana de 24 h.
- Cambios de precio por WhatsApp (solo web, por diseño).
- Reversas, borrados y altas de productos.

## Pruebas

La lógica pura vive en `../_shared/whatsapp.ts` y se testea con Vitest:

```bash
npx vitest run supabase/functions/_shared/whatsapp.test.ts
npx vitest run supabase/functions/_shared/agent.whatsapp.test.ts
```

El handler Deno no se testea localmente (no hay Deno en el entorno); se valida
con el `GET` de alta, un mensaje real y los logs de la función.
