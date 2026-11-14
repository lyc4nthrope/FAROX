import type { LoadResult } from "../../shared/hooks/useLoad";
import { mapError } from "../../shared/lib/errors/mapError";
import { supabase } from "../../shared/lib/supabase/client";

// Asistente (0039): la conversación y los mensajes viven en chat_* con RLS por
// user_id. El navegador solo escribe mensajes «user» (send_message); el resto
// lo escribe la Edge Function después de validar el JWT.

type Err = { message: string } | null;

export interface AssistantMessage {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  created_at: string;
}

export interface AssistantAction {
  action_id: number;
  summary: unknown;
  expires_at: string;
  requires_strong_confirmation?: boolean;
}

export async function createConversation(input: {
  title: string;
  storeId: number | null;
}): Promise<{ data: number | null; error: Err }> {
  const { data, error } = await supabase.rpc("create_chat", {
    p_title: input.title,
    p_store: input.storeId,
  });
  return { data: data === null ? null : Number(data), error };
}

export async function fetchMessages(
  conversationId: number,
): Promise<LoadResult<AssistantMessage[]>> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id,role,content,created_at")
    .eq("conversation_id", conversationId)
    .order("id", { ascending: true })
    .limit(100);
  return { data: (data ?? []) as AssistantMessage[], error };
}

export async function sendMessage(
  conversationId: number,
  content: string,
): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("send_message", {
    p_conversation: conversationId,
    p_content: content,
  });
  return { error };
}

/**
 * supabase-js entrega FunctionsHttpError con la Response original en
 * `.context`; el mensaje útil («límite por hora», «en mantenimiento») vive en
 * el body `{ error }`, no en `message`. Sin esto, todo 429/503 se mostraba
 * como «error inesperado».
 */
async function edgeErrorDetail(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown } | null)?.context;
  const json = (context as { json?: () => Promise<unknown> } | null)?.json;
  if (typeof json !== "function") return null;
  try {
    const body = (await json.call(context)) as { error?: unknown } | null;
    return typeof body?.error === "string" && body.error !== "" ? body.error : null;
  } catch {
    return null;
  }
}

/** Invoca la Edge Function «agent». Devuelve el texto, el borrador o un error. */
export async function askAgent(input: { conversationId: number; message: string }): Promise<{
  reply: string | null;
  action: AssistantAction | null;
  error: string | null;
}> {
  try {
    const { data, error } = await supabase.functions.invoke("agent", {
      body: { conversation_id: input.conversationId, message: input.message },
    });
    if (error !== null) {
      const detail = await edgeErrorDetail(error);
      return {
        reply: null,
        action: null,
        error: detail === null ? mapError(error) : mapError({ message: detail }),
      };
    }
    const reply =
      typeof (data as { reply?: unknown } | null)?.reply === "string"
        ? (data as { reply: string }).reply
        : null;
    if (reply === null || reply.trim() === "") {
      return { reply: null, action: null, error: "El asistente devolvió una respuesta vacía." };
    }
    const actionRaw = (data as { action?: unknown } | null)?.action;
    const action =
      typeof actionRaw === "object" &&
      actionRaw !== null &&
      typeof (actionRaw as { action_id?: unknown }).action_id === "number"
        ? (actionRaw as AssistantAction)
        : null;
    return { reply, action, error: null };
  } catch (thrown) {
    return { reply: null, action: null, error: mapError(thrown) };
  }
}

/** Confirma y ejecuta un borrador. La RPC revalida dueño, rol y vencimiento. */
export async function executeAction(
  actionId: number,
  confirmation?: string,
): Promise<{ data: unknown; error: Err }> {
  const params: Record<string, unknown> = { p_action: actionId };
  if (confirmation !== undefined) params.p_confirmation = confirmation;
  const { data, error } = await supabase.rpc("agent_execute_action", params);
  return { data, error };
}

/** Cancela un borrador pendiente. */
export async function cancelAction(actionId: number): Promise<{ data: unknown; error: Err }> {
  const { data, error } = await supabase.rpc("agent_cancel_action", { p_action: actionId });
  return { data, error };
}
