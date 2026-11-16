// Shared WhatsApp Cloud API helpers for the inbound webhook.
// Pure TypeScript: no Deno APIs here, so Vitest can exercise the logic.

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * Valida `x-hub-signature-256` de Meta: HMAC-SHA256 del **body crudo** con el
 * app secret, en formato `sha256=<hex>`. Hay que leer el body como texto antes
 * de parsearlo; re-serializar el JSON cambia los bytes y rompe la firma.
 */
export async function verifyMetaSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  appSecret: string;
}): Promise<boolean> {
  if (input.signatureHeader === null || input.appSecret === "") return false;

  const prefix = "sha256=";
  if (!input.signatureHeader.startsWith(prefix)) return false;
  const provided = input.signatureHeader.slice(prefix.length).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(input.rawBody));
  return timingSafeEqualHex(toHex(new Uint8Array(signature)), provided);
}

/**
 * GET de verificación de Meta (`hub.mode=subscribe`). Devuelve el challenge a
 * responder o null si el token no coincide.
 */
export function verifyChallenge(
  searchParams: URLSearchParams,
  expectedToken: string,
): string | null {
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  if (mode !== "subscribe" || expectedToken === "" || token !== expectedToken) {
    return null;
  }
  return challenge;
}

export interface WhatsappCommand {
  from: string;
  code: string;
  messageId: string;
}

// `FAROX <6 alfanuméricos>`: se acepta cualquier alfanumérico para que un typo
// llegue a la RPC y reciba "código inválido" en vez de silencio.
const COMMAND = /\bFAROX\b[\s:]+([0-9A-Za-z]{6})\b/i;

/**
 * Extrae los comandos `FAROX <código>` de un payload de Meta. Ignora mensajes
 * que no sean de texto y mensajes sin `from`/`id`.
 */
export function extractVerificationCommands(payload: unknown): WhatsappCommand[] {
  const out: WhatsappCommand[] = [];
  const entries = asRecord(payload).entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const changes = asRecord(entry).changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = asRecord(asRecord(change).value);
      const messages = value.messages;
      if (!Array.isArray(messages)) continue;

      for (const message of messages) {
        const msg = asRecord(message);
        if (msg.type !== "text") continue;

        const from = asString(msg.from);
        const messageId = asString(msg.id);
        const body = asString(asRecord(msg.text).body);
        if (from === null || messageId === null || body === null) continue;

        const match = COMMAND.exec(body);
        if (match === null) continue;

        out.push({ from, code: match[1].toUpperCase(), messageId });
      }
    }
  }

  return out;
}

export interface WhatsappTextMessage {
  from: string;
  text: string;
  messageId: string;
}

/** Extrae todos los mensajes de texto con `from`, `id` y body. */
export function extractTextMessages(payload: unknown): WhatsappTextMessage[] {
  const out: WhatsappTextMessage[] = [];
  const entries = asRecord(payload).entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const changes = asRecord(entry).changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = asRecord(asRecord(change).value);
      const messages = value.messages;
      if (!Array.isArray(messages)) continue;

      for (const message of messages) {
        const msg = asRecord(message);
        if (msg.type !== "text") continue;
        const from = asString(msg.from);
        const messageId = asString(msg.id);
        const body = asString(asRecord(msg.text).body);
        if (from === null || messageId === null || body === null) continue;
        out.push({ from, text: body, messageId });
      }
    }
  }

  return out;
}

export function parseVerificationCode(text: string): string | null {
  const match = COMMAND.exec(text);
  return match === null ? null : match[1].toUpperCase();
}

export interface WhatsappActionCommand {
  action: "confirm" | "cancel";
  code: string;
}

const ACTION_COMMAND = /^\s*(CONFIRMAR|CANCELAR)[\s:]+([0-9A-Za-z]{6})\s*$/i;

/** `CONFIRMAR A1B2C3` / `CANCELAR A1B2C3`. */
export function parseActionCommand(text: string): WhatsappActionCommand | null {
  const match = ACTION_COMMAND.exec(text);
  if (match === null) return null;
  return {
    action: match[1].toUpperCase() === "CONFIRMAR" ? "confirm" : "cancel",
    code: match[2].toUpperCase(),
  };
}

/**
 * Respuesta al usuario según el resultado de la RPC. `expired` no responde:
 * es el resultado normal de un reintento de Meta o de un código ya consumido,
 * y contestar generaría ruido.
 */
export function replyFor(result: string): string | null {
  switch (result) {
    case "verified":
      return "✅ Teléfono verificado. Ya podés usar el asistente por WhatsApp.";
    case "phone_taken":
      return "Ese número ya está verificado en otra cuenta.";
    case "invalid":
      return "No pude verificar ese código. Generá uno nuevo desde la app.";
    case "too_many_attempts":
      return "Demasiados intentos. Generá un código nuevo desde la app.";
    default:
      return null;
  }
}
