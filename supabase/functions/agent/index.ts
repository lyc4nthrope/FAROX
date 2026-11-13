import { corsHeaders, errorJson, isPost, json } from "../_shared/http.ts";
import { authHeader, serviceClient, userClient } from "../_shared/supabase.ts";
import { ModelUnavailableError, runAgent, type AgentHistoryItem } from "../_shared/agent.ts";

// ============================================================================
// Edge Function «agent»: un solo endpoint para todos los usuarios.
// La identidad sale del JWT (auth.uid()), nunca del body. Las herramientas
// corren con el cliente del usuario, así que la RLS aplica igual que en la app.
// ============================================================================

const MAX_MESSAGE_LENGTH = 800;
const MAX_TURNS_PER_HOUR = 60;
const MAX_HISTORY = 8;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }
  if (!isPost(request)) return errorJson("Método no permitido.", 405, true);

  if (Deno.env.get("AGENT_ENABLED") !== "true") {
    return errorJson("El asistente todavía no está habilitado.", 503, true);
  }

  const header = authHeader(request);
  if (header === null) return errorJson("Iniciá sesión para continuar.", 401, true);

  const apiKey = Deno.env.get("AGENT_API_KEY") ?? Deno.env.get("GEMINI_API_KEY");
  if (apiKey === undefined || apiKey === "") {
    return errorJson("Falta configurar el asistente.", 500, true);
  }
  const baseUrl =
    Deno.env.get("AGENT_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta/openai";
  const model = Deno.env.get("AGENT_MODEL") ?? "gemini-2.5-flash";
  // Respaldo ante obsolescencia: si el primario deja de existir, el turno
  // sigue con este modelo sin tocar código.
  const fallbackModel = Deno.env.get("AGENT_FALLBACK_MODEL") ?? "gemini-2.5-flash-lite";
  const writesEnabled = Deno.env.get("AGENT_WRITES_ENABLED") === "true";

  const client = userClient(header);
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError !== null || userData.user === null) {
    return errorJson("Sesión inválida.", 401, true);
  }

  // Rol y Premium salen del servidor, nunca del body. El dashboard los necesita
  // para saber si "ventas" son salidas (admin/operador) o entradas (distribuidor).
  const privilegesClient = serviceClient();
  const { data: privileges } = await privilegesClient
    .from("users")
    .select("premium, premium_until, role:roles(name)")
    .eq("id", userData.user.id)
    .maybeSingle();
  const roleRaw = (privileges as { role?: unknown } | null)?.role;
  const roleRow = Array.isArray(roleRaw) ? roleRaw[0] : roleRaw;
  const roleName =
    typeof roleRow === "object" && roleRow !== null
      ? String((roleRow as { name?: unknown }).name ?? "")
      : "";
  const premiumFlag = (privileges as { premium?: unknown } | null)?.premium === true;
  const premiumUntilRaw = (privileges as { premium_until?: unknown } | null)?.premium_until;
  const premiumActive =
    premiumFlag &&
    (premiumUntilRaw === null ||
      (typeof premiumUntilRaw === "string" && Date.parse(premiumUntilRaw) > Date.now()));
  // is_premium(): admin siempre; el resto, premium vigente.
  const premium = roleName === "admin" || premiumActive;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorJson("Datos inválidos.", 400, true);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message === "" || message.length > MAX_MESSAGE_LENGTH) {
    return errorJson("Escribí una consulta de hasta 800 caracteres.", 400, true);
  }

  const rawConversation = body.conversation_id;
  const conversationId =
    rawConversation === undefined || rawConversation === null ? null : Number(rawConversation);
  if (conversationId !== null && (!Number.isFinite(conversationId) || conversationId <= 0)) {
    return errorJson("Conversación inválida.", 400, true);
  }

  const rawStore = body.store_id;
  const storeId = rawStore === undefined || rawStore === null ? null : Number(rawStore);

  // Límite simple por usuario: la RLS de chat_messages solo cuenta lo propio.
  const { count } = await client
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("role", "assistant")
    .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
  if ((count ?? 0) >= MAX_TURNS_PER_HOUR) {
    return errorJson("Llegaste al límite de consultas por hora. Probá más tarde.", 429, true);
  }

  let activeId = conversationId;
  if (activeId === null) {
    const title = message.length > 60 ? `${message.slice(0, 57)}…` : message;
    const { data: created, error: createError } = await client.rpc("create_chat", {
      p_title: title,
      p_store: storeId,
    });
    if (createError !== null || created === null) {
      return errorJson("No pude iniciar la conversación.", 500, true);
    }
    activeId = Number(created);
  } else {
    const { data: conversation } = await client
      .from("chat_conversations")
      .select("id")
      .eq("id", activeId)
      .maybeSingle();
    if (conversation === null) {
      return errorJson("Conversación inexistente o sin permiso.", 403, true);
    }
  }

  // La tienda activa de la conversación es la única fuente confiable de
  // store_id para las operaciones. El modelo nunca debe inventar un ID.
  const { data: conversationRow } = await client
    .from("chat_conversations")
    .select("store_id")
    .eq("id", activeId)
    .maybeSingle();
  let storeContext: { id: number; name: string } | null = null;
  const conversationStoreId = Number((conversationRow as { store_id?: unknown } | null)?.store_id);
  if (Number.isFinite(conversationStoreId) && conversationStoreId > 0) {
    const { data: storeRow } = await client
      .from("stores")
      .select("id,name")
      .eq("id", conversationStoreId)
      .maybeSingle();
    if (storeRow !== null) {
      storeContext = {
        id: Number((storeRow as { id: unknown }).id),
        name: String((storeRow as { name: unknown }).name),
      };
    }
  }

  // Historial ANTES de guardar el mensaje nuevo: runAgent agrega el actual.
  const { data: historyRows } = await client
    .from("chat_messages")
    .select("role,content")
    .eq("conversation_id", activeId)
    .in("role", ["user", "assistant"])
    .order("id", { ascending: false })
    .limit(MAX_HISTORY);
  const history: AgentHistoryItem[] = (historyRows ?? []).reverse().flatMap((row) => {
    if (row.role !== "user" && row.role !== "assistant") return [];
    return [{ role: row.role, content: String(row.content) }];
  });

  const { error: sendError } = await client.rpc("send_message", {
    p_conversation: activeId,
    p_content: message,
  });
  if (sendError !== null) {
    if (sendError.message.includes("límite de")) {
      return errorJson("Llegaste al límite de consultas por hora. Probá más tarde.", 429, true);
    }
    return errorJson("No pude guardar tu mensaje.", 500, true);
  }

  try {
    const { reply, toolLog } = await runAgent({
      client,
      role: roleName,
      premium,
      conversationId: activeId,
      writesEnabled,
      store: storeContext,
      channel: "web",
      actorUserId: userData.user.id,
      actorWaId: null,
      apiKey,
      baseUrl,
      model,
      fallbackModel,
      message,
      history,
    });

    const actionEntry = [...toolLog]
      .reverse()
      .find(
        (entry) =>
          entry.name.startsWith("preparar_") &&
          typeof (entry.result as { action_id?: unknown } | null)?.action_id === "number",
      );
    const action = actionEntry?.result ?? null;

    // assistant/tool no son escribibles desde el navegador (REVOKE): se
    // guardan con service_role DESPUÉS de validar la conversación con el JWT.
    const admin = serviceClient();
    for (const entry of toolLog) {
      const { error: toolInsertError } = await admin.from("chat_messages").insert({
        conversation_id: activeId,
        role: "tool",
        content: entry.name,
        payload: { args: entry.args, result: entry.result },
      });
      if (toolInsertError !== null) {
        console.error("agent TOOL_MESSAGE", toolInsertError.message);
      }
    }
    const { error: assistantInsertError } = await admin.from("chat_messages").insert({
      conversation_id: activeId,
      role: "assistant",
      content: reply,
      payload:
        action !== null && typeof action === "object"
          ? { action_id: (action as { action_id: number }).action_id }
          : null,
    });
    if (assistantInsertError !== null) {
      console.error("agent ASSISTANT_MESSAGE", assistantInsertError.message);
    }

    return json({ conversation_id: activeId, reply, action }, 200, true);
  } catch (error) {
    if (error instanceof ModelUnavailableError) {
      // Línea estable para alertas de log: el modelo configurado ya no existe.
      console.error("agent MODEL_UNAVAILABLE", error.message);
      return errorJson("El asistente está en mantenimiento. Probá más tarde.", 503, true);
    }
    console.error("agent", error instanceof Error ? error.message : error);
    return errorJson("No pude responder ahora. Probá de nuevo en un rato.", 502, true);
  }
});
