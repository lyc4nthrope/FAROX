import { corsHeaders, errorJson, isPost, json } from "../_shared/http.ts";
import { authHeader, serviceClient, userClient } from "../_shared/supabase.ts";
import { runAgent, type AgentHistoryItem } from "../_shared/agent.ts";

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

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (apiKey === undefined || apiKey === "") {
    return errorJson("Falta configurar el asistente.", 500, true);
  }
  const model = Deno.env.get("AGENT_MODEL") ?? "gemini-2.5-flash";

  const client = userClient(header);
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError !== null || userData.user === null) {
    return errorJson("Sesión inválida.", 401, true);
  }

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

  // Historial ANTES de guardar el mensaje nuevo: runAgent agrega el actual.
  const { data: historyRows } = await client
    .from("chat_messages")
    .select("role,content")
    .eq("conversation_id", activeId)
    .in("role", ["user", "assistant"])
    .order("id", { ascending: false })
    .limit(MAX_HISTORY);
  const history: AgentHistoryItem[] = (historyRows ?? [])
    .reverse()
    .flatMap((row) => {
      if (row.role !== "user" && row.role !== "assistant") return [];
      return [{ role: row.role, content: String(row.content) }];
    });

  const { error: sendError } = await client.rpc("send_message", {
    p_conversation: activeId,
    p_content: message,
  });
  if (sendError !== null) {
    return errorJson("No pude guardar tu mensaje.", 500, true);
  }

  try {
    const { reply, toolLog } = await runAgent({
      client,
      apiKey,
      model,
      message,
      history,
    });

    // assistant/tool no son escribibles desde el navegador (REVOKE): se
    // guardan con service_role DESPUÉS de validar la conversación con el JWT.
    const admin = serviceClient();
    for (const entry of toolLog) {
      await admin.from("chat_messages").insert({
        conversation_id: activeId,
        role: "tool",
        content: entry.name,
        payload: { args: entry.args, result: entry.result },
      });
    }
    await admin.from("chat_messages").insert({
      conversation_id: activeId,
      role: "assistant",
      content: reply,
    });

    return json({ conversation_id: activeId, reply }, 200, true);
  } catch (error) {
    console.error("agent", error instanceof Error ? error.message : error);
    return errorJson("No pude responder ahora. Probá de nuevo en un rato.", 502, true);
  }
});
