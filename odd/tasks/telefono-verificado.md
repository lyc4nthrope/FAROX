# Teléfono verificado (identidad para el asistente)

Rama `daniel` · entrega por work-units · runner `npm run ci`.

Objetivo: que `users.phone_number` deje de ser un dato auto-declarado y pase a ser
una identidad verificada, base del asistente por WhatsApp. Hoy cualquier usuario
autenticado puede escribir cualquier número (GRANT UPDATE de `0006:368-369`), así
que usarlo como identificador sin verificación permite suplantar a otra cuenta.

## Specs

- **S1.** `users.phone_verified_at timestamptz NULL`. No entra en el GRANT UPDATE
  de perfil: solo lo escribe la RPC de confirmación con `SECURITY DEFINER`.
- **S2.** `users.phone_number` se guarda normalizado E.164 (`+573001234567`).
  El formato libre actual (`"300 222 3333"`, `"+57 300..."`) impide comparar con
  el `wa_id` que entrega Meta (E.164 sin `+`).
- **S3.** Un teléfono verificado pertenece a UNA sola cuenta:
  índice único parcial `(phone_number) WHERE phone_verified_at IS NOT NULL`.
- **S4.** Tabla `phone_verifications`: código de 6 dígitos **hasheado**, expira a
  los 10 minutos, máximo 5 intentos, un código activo por usuario.
- **S5.** `phone_verification_start(p_phone)`: valida y normaliza, aplica rate
  limit (3 códigos por hora por usuario), guarda solo el hash y **devuelve el
  código a la app** para que el usuario lo vea y lo envíe por WhatsApp. Nunca
  se persiste en claro.
- **S6.** `phone_verification_confirm_whatsapp(wa_id, code)` (service_role):
  busca por teléfono + hash, consume el código y setea `phone_verified_at` +
  `phone_number` normalizado en una sola transacción. 5 intentos fallidos o
  10 minutos invalidan el código.
- **S7.** Perfil: muestra el estado (verificado / sin verificar) y guía el flujo;
  el usuario puede cambiar de número, lo que borra la verificación anterior
  (trigger `clear_phone_verification_on_change`).
- **S8.** Entrega (decidida en L4): el usuario manda `FAROX <código>` al bot y
  el webhook entrante confirma. No se usa la API saliente de WhatsApp ni SMS.

## Tasks

- **T1.** Migración `0042`: columna, tabla, índice único, RPCs y grants. — hecho
  (pendiente de aplicar en Supabase)
- **T2.** Frontend de perfil: `phone_verified_at` en el select, botón «Verificar»,
  código visible e instrucciones. — hecho
- **T3.** Edge Function `whatsapp-webhook`: `GET hub.challenge`, `POST` con
  `x-hub-signature-256`, parseo del mensaje `FAROX <código>` y llamada a
  `phone_verification_confirm_whatsapp`. — hecho (sin Deno local: falta
  `deno check`, deploy `--no-verify-jwt` y alta en Meta)
- **T4.** Ruteo de mensajes normales al asistente (el bot completo). — fuera de
  alcance de esta feature

## Log

### L1 — pedido (verbatim)

> Entonces, el problema es reconocer el usuario, no seria que el usuario colocara un numero de contacto de whatsapp en su perfil y que ese numero registrado sea el identificador que funciona para comunicarse y que como esta vinculado al usuario el numero ya se sabe que numero esta usando el whatsapp y al mismo tiempo darle las credenciales para consultar solo lo suyo, no?

### L2 — hallazgo (2026-11-04)

`users.phone_number` es `text` nullable, sin `UNIQUE`, sin columna de verificación
y editable por el dueño vía PostgREST. `grep phone_verified|verify_phone|otp` no
devuelve nada. Sin una prueba de control del número, el `user_id` que resolvería
el webhook sería el que eligió el atacante.

### L3 — decisión abierta (2026-11-04)

Canal de entrega del código. Opciones con tradeoff:

1. **WhatsApp Cloud API (plantilla) + confirmación en la app**: el código viaja al
   WhatsApp del usuario y se tipea en `/perfil`. No necesita webhook entrante.
   Requiere número de Meta y plantilla aprobada; tiene costo por conversación.
2. **El usuario manda `FAROX <código>` al bot**: gratis y prueba exactamente el
   canal, pero depende del webhook entrante (T4), que todavía no existe.
3. **SMS (Twilio)**: el más simple de implementar, pero cobra por mensaje y no es
   el canal del producto.
4. **Sin verificación en fase 1**: el teléfono queda solo como dato de contacto
   (estado actual). No habilita identidad ni bot.

Elegir 1 o 2 cambia el copy del perfil y el orden de T3/T4; el esquema de T1 no
cambia.

### L4 — decisión (2026-11-04)

Se elige la **opción 2**: el usuario ve el código en `/perfil` y lo manda como
`FAROX <código>` al número del bot. El webhook entrante confirma con
`service_role`. Consecuencias:

- `phone_verification_start` devuelve el código al cliente (S5 corregido).
- T3 pasa a ser el webhook entrante, no una función de envío saliente.
- Sin costo por mensaje ni plantilla de Meta; el webhook es requisito.
- Se asume Colombia (`+57`) para números de 10 dígitos que empiezan en `3`;
  el resto debe venir con prefijo internacional o `00` (ver `normalize_phone_e164`).
