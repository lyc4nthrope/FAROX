import { errorJson, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { runAgent, type AgentAction, type AgentToolLog } from "../_shared/agent.ts";
import {
  extractTextMessages,
  parseActionCommand,
  parseVerificationCode,
  replyFor,
  verifyChallenge,
  verifyMetaSignature,
} from "../_shared/whatsapp.ts";

// ============================================================================
// Edge Function «whatsapp-webhook».
//
// GET  → alta del webhook de Meta (hub.challenge).
// POST → mensajes entrantes. Se responde 200 rápido y se procesa en background
//        (EdgeRuntime.waitUntil) para que Meta no reintente por timeout.
//
// Rutas por texto:
//   FAROX <código>       → verificación de teléfono (flujo existente).
//   CONFIRMAR <código>   → ejecuta el borrador del asistente.
//   CANCELAR <código>    → cancela el borrador.
//   otro texto           → asistente (service_role + _for_user).
//
// Identidad: wa_id verificado en public.users. Sin teléfono verificado no hay
// asistente ni acciones. Deduplicación por message.id en whatsapp_inbound.
// ============================================================================

const GRAPH_VERSION_DEFAULT = "v21.0";
const MAX_TEXT_LENGTH = 800;
const MAX_INBOUND_PER_HOUR = 60;

interface WhatsappIdentity {
  userId: string;
  roleName: string;
  premiumActive: boolean;
}

interface AgentEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
  fallbackModel: string;
  writesEnabled: boolean;
}

interface WhatsappAction extends AgentAction {
  confirmation_code?: string;
}

Deno.serve(async (request) => {
  const url = new URL(request.url);

  // ---- GET: verificación del webhook (hub.challenge) ----------------------
  if (request.method === "GET") {
    const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
    const challenge = verifyChallenge(url.searchParams, verifyToken);
    if (challenge === null) return new Response("forbidden", { status: 403 });
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (request.method !== "POST") {
    return errorJson("Método no permitido.", 405);
  }

  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
  if (appSecret === "") {
    console.error("whatsapp-webhook MISSING_APP_SECRET");
    return errorJson("Webhook no configurado.", 500);
  }

  // El body se lee como texto: re-serializar el JSON rompe la firma.
  const rawBody = await request.text();
  const valid = await verifyMetaSignature({
    rawBody,
    signatureHeader: request.headers.get("x-hub-signature-256"),
    appSecret,
  });
  if (!valid) {
    console.error("whatsapp-webhook INVALID_SIGNATURE");
    return errorJson("Firma inválida.", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return errorJson("Datos inválidos.", 400);
  }

  const messages = extractTextMessages(payload);
  if (messages.length === 0) {
    return json({ ok: true, handled: 0 });
  }

  const service = serviceClient();
  const runtime = globalThis as {
    EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
  };
  let handled = 0;

  for (const message of messages) {
    const { error: dedupeError } = await service
      .from("whatsapp_inbound")
      .insert({ message_id: message.messageId, wa_id: message.from });
    if (dedupeError !== null) {
      if ((dedupeError as { code?: string }).code !== "23505") {
        console.error("whatsapp-webhook DEDUPE", dedupeError.message);
      }
      continue;
    }

    const { count } = await service
      .from("whatsapp_inbound")
      .select("message_id", { count: "exact", head: true })
      .eq("wa_id", message.from)
      .gte("received_at", new Date(Date.now() - 3_600_000).toISOString());
    if ((count ?? 0) > MAX_INBOUND_PER_HOUR) {
      const task = sendText(message.from, "Llegaste al límite de mensajes por hora. Probá más tarde.");
      if (runtime.EdgeRuntime) runtime.EdgeRuntime.waitUntil(task);
      handled += 1;
      continue;
    }

    const task = handleMessage(service, message.from, message.text).catch((thrown) => {
      console.error(
        "whatsapp-webhook HANDLER",
        message.messageId,
        thrown instanceof Error ? thrown.message : thrown,
      );
      return sendText(message.from, "No pude procesar tu mensaje. Probá de nuevo en un rato.");
    });

    if (runtime.EdgeRuntime) {
      runtime.EdgeRuntime.waitUntil(task);
    } else {
      await task;
    }
    handled += 1;
  }

  return json({ ok: true, handled });
});

async function handleMessage(
  service: ReturnType<typeof serviceClient>,
  from: string,
  rawText: string,
): Promise<void> {
  const text = rawText.slice(0, MAX_TEXT_LENGTH).trim();
  if (text === "") return;

  // 1. Verificación de teléfono.
  const verificationCode = parseVerificationCode(text);
  if (verificationCode !== null) {
    const { data, error } = await service.rpc("phone_verification_confirm_whatsapp", {
      p_wa_id: from,
      p_code: verificationCode,
    });
    if (error !== null) {
      console.error("whatsapp-webhook VERIFY", error.message);
      return;
    }
    const reply = replyFor(typeof data === "string" ? data : "");
    if (reply !== null) await sendText(from, reply);
    return;
  }

  // 2. Confirmación/cancelación de un borrador.
  const command = parseActionCommand(text);
  if (command !== null) {
    await handleActionCommand(service, from, command.action, command.code);
    return;
  }

  // 3. Asistente.
  const identity = await resolveIdentity(service, from);
  if (identity === null) {
    await sendText(
      from,
      "Para usar el asistente, primero verificá tu teléfono desde Perfil en la app.",
    );
    return;
  }

  const agentEnv = readAgentEnv();
  if (agentEnv === null) {
    await sendText(from, "El asistente no está disponible ahora.");
    return;
  }

  const conversationId = await getOrCreateConversation(service, identity.userId, from);
  const history = await loadHistory(service, conversationId);

  const { error: sendError } = await service.from("chat_messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: text,
  });
  if (sendError !== null) {
    console.error("whatsapp-webhook USER_MESSAGE", sendError.message);
    return;
  }

  const { reply, toolLog } = await runAgent({
    client: service,
    role: identity.roleName,
    premium: identity.premiumActive,
    conversationId,
    writesEnabled: agentEnv.writesEnabled,
    store: null,
    channel: "whatsapp",
    actorUserId: identity.userId,
    actorWaId: from,
    apiKey: agentEnv.apiKey,
    baseUrl: agentEnv.baseUrl,
    model: agentEnv.model,
    fallbackModel: agentEnv.fallbackModel,
    message: text,
    history,
  });

  const action = findAction(toolLog);

  for (const entry of toolLog) {
    await service.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "tool",
      content: entry.name,
      payload: { args: entry.args, result: entry.result },
    });
  }
  await service.from("chat_messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: reply,
    payload: action === null ? null : { action_id: action.action_id },
  });

  if (action !== null) {
    await sendText(from, formatActionReply(action));
  } else {
    await sendText(from, reply);
  }
}

async function handleActionCommand(
  service: ReturnType<typeof serviceClient>,
  from: string,
  action: "confirm" | "cancel",
  code: string,
): Promise<void> {
  const identity = await resolveIdentity(service, from);
  if (identity === null) {
    await sendText(from, "Verificá tu teléfono desde Perfil en la app.");
    return;
  }

  const { data: pending, error } = await service
    .from("agent_actions")
    .select("id,status,expires_at")
    .eq("user_id", identity.userId)
    .eq("wa_id", from)
    .eq("confirmation_code", code)
    .eq("channel", "whatsapp")
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error !== null) {
    console.error("whatsapp-webhook ACTION_LOOKUP", error.message);
    await sendText(from, "No pude buscar ese borrador. Probá de nuevo.");
    return;
  }
  if (pending === null) {
    await sendText(from, "Ese código no existe o ya venció. Pedile al asistente que lo prepare de nuevo.");
    return;
  }

  const rpcName =
    action === "confirm" ? "agent_execute_action_for_user" : "agent_cancel_action_for_user";
  const { data, error: rpcError } = await service.rpc(rpcName, {
    p_user: identity.userId,
    p_wa_id: from,
    p_action: Number((pending as { id: unknown }).id),
    p_code: code,
  });
  if (rpcError !== null) {
    console.error("whatsapp-webhook ACTION", rpcError.message);
    await sendText(from, "No pude ejecutar el borrador. Probá de nuevo.");
    return;
  }

  const result = (data ?? {}) as {
    ok?: unknown;
    count?: unknown;
    error?: unknown;
    already?: unknown;
  };
  if (result.ok === false) {
    await sendText(from, actionErrorMessage(String(result.error ?? "")));
    return;
  }
  if (result.already === true) {
    await sendText(from, "Ese borrador ya estaba registrado.");
    return;
  }
  if (action === "cancel") {
    await sendText(from, "Borrador cancelado.");
    return;
  }
  const count = Number(result.count);
  await sendText(
    from,
    Number.isFinite(count) && count > 0 ? `✅ Listo: ${count} línea(s) registrada(s).` : "✅ Listo.",
  );
}

async function resolveIdentity(
  service: ReturnType<typeof serviceClient>,
  from: string,
): Promise<WhatsappIdentity | null> {
  const { data, error } = await service.rpc("internal_user_for_wa_id", { p_wa_id: from });
  if (error !== null) {
    console.error("whatsapp-webhook IDENTITY", error.message);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (row === null || row === undefined) return null;
  return {
    userId: String(row.user_id ?? ""),
    roleName: String(row.role_name ?? ""),
    premiumActive: row.premium_active === true,
  };
}

function readAgentEnv(): AgentEnv | null {
  if (Deno.env.get("AGENT_ENABLED") !== "true") return null;
  const apiKey = Deno.env.get("AGENT_API_KEY") ?? Deno.env.get("GEMINI_API_KEY");
  if (apiKey === undefined || apiKey === "") return null;
  return {
    apiKey,
    baseUrl:
      Deno.env.get("AGENT_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta/openai",
    model: Deno.env.get("AGENT_MODEL") ?? "gemini-2.5-flash",
    fallbackModel: Deno.env.get("AGENT_FALLBACK_MODEL") ?? "gemini-2.5-flash-lite",
    writesEnabled: Deno.env.get("AGENT_WRITES_ENABLED") === "true",
  };
}

async function getOrCreateConversation(
  service: ReturnType<typeof serviceClient>,
  userId: string,
  waId: string,
): Promise<number> {
  const { data: existing, error } = await service
    .from("chat_conversations")
    .select("id")
    .eq("channel", "whatsapp")
    .eq("external_id", waId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error !== null) throw new Error(error.message);
  if (existing !== null) return Number((existing as { id: unknown }).id);

  const { data: created, error: createError } = await service
    .from("chat_conversations")
    .insert({ user_id: userId, title: "WhatsApp", channel: "whatsapp", external_id: waId })
    .select("id")
    .single();
  if (createError !== null) {
    if ((createError as { code?: string }).code === "23505") {
      const { data: retry } = await service
        .from("chat_conversations")
        .select("id")
        .eq("channel", "whatsapp")
        .eq("external_id", waId)
        .eq("user_id", userId)
        .single();
      if (retry !== null) return Number((retry as { id: unknown }).id);
    }
    throw new Error(createError.message);
  }
  return Number((created as { id: unknown }).id);
}

async function loadHistory(
  service: ReturnType<typeof serviceClient>,
  conversationId: number,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { data } = await service
    .from("chat_messages")
    .select("role,content")
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("id", { ascending: false })
    .limit(8);
  return ((data ?? []) as { role: "user" | "assistant"; content: string }[]).reverse();
}

function findAction(toolLog: readonly AgentToolLog[]): WhatsappAction | null {
  const entry = [...toolLog]
    .reverse()
    .find(
      (item) =>
        item.name.startsWith("preparar_") &&
        typeof (item.result as { action_id?: unknown } | null)?.action_id === "number",
    );
  return entry === undefined ? null : (entry.result as WhatsappAction);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function money(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 2,
  }).format(parsed);
}

function formatActionReply(action: WhatsappAction): string {
  const summary = asRecord(action.summary);
  const kind = String(summary.kind ?? "");
  const code = String(action.confirmation_code ?? "");
  const lines = Array.isArray(summary.lines) ? summary.lines : [];
  const title =
    kind === "store_exit"
      ? "Salida de tienda"
      : kind === "distributor_sale"
        ? "Venta a tienda"
        : kind === "distributor_purchase"
          ? "Compra de distribuidor"
          : kind === "shortage_toggle"
            ? "Faltante"
            : "Borrador";

  const parts: string[] = [title];
  if (typeof summary.store === "string" && summary.store !== "") parts.push(summary.store);
  for (const raw of lines) {
    const line = asRecord(raw);
    if (kind === "shortage_toggle") continue;
    if (typeof line.product === "string") {
      parts.push(
        `${line.product}: costo ${money(line.old_purchase)} → ${money(line.new_purchase)}; venta ${money(line.old_sale)} → ${money(line.new_sale)}`,
      );
      continue;
    }
    const unit = line.unit_cost ?? line.unit_price;
    parts.push(`${String(line.name ?? "")} × ${String(line.qty ?? "")} — ${money(unit)}`);
  }
  if (kind === "shortage_toggle") {
    parts.push(`${String(summary.product ?? "")}: ${summary.old === true ? "Sí" : "No"} → ${summary.new === true ? "Sí" : "No"}`);
  }
  if (summary.total !== undefined && summary.total !== null) {
    parts.push(`Total: ${money(summary.total)}`);
  }
  parts.push(`Respondé CONFIRMAR ${code} para aplicarlo, o CANCELAR ${code}.`);
  return parts.join("\n");
}

function actionErrorMessage(code: string): string {
  if (code === "expired") return "El borrador venció. Pedile al asistente que lo prepare de nuevo.";
  if (code === "stale_draft") {
    return "Otro cambio modificó el precio. Pedile al asistente que lo prepare de nuevo.";
  }
  if (code.includes("stock insuficiente")) return "No hay stock suficiente para esa salida.";
  if (code.includes("solo admin/operador") || code.includes("solo distribuidor")) {
    return "Tu rol no puede hacer esta operación.";
  }
  if (code.includes("fuera del alcance") || code.includes("no está vinculada")) {
    return "La tienda no está dentro de tu alcance.";
  }
  if (code.includes("no está en tu catálogo") || code.includes("no está en la tienda")) {
    return "El producto no está disponible en esa tienda.";
  }
  return "No se pudo ejecutar la operación. Probá de nuevo.";
}

/**
 * Respuesta best-effort por Cloud API. Si faltan las credenciales de envío, el
 * webhook igual procesa: la verificación no depende de responder.
 */
async function sendText(to: string, body: string): Promise<void> {
  const token = Deno.env.get("WHATSAPP_TOKEN") ?? "";
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
  if (token === "" || phoneNumberId === "") return;

  const version = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? GRAPH_VERSION_DEFAULT;
  const response = await fetch(
    `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    },
  );

  if (!response.ok) {
    console.error("whatsapp-webhook SEND_FAILED", response.status);
  }
}
