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

/** Invoca la Edge Function «agent». Devuelve el texto o un error ya mapeado. */
export async function askAgent(input: {
  conversationId: number;
  message: string;
}): Promise<{ reply: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke("agent", {
      body: { conversation_id: input.conversationId, message: input.message },
    });
    if (error !== null) return { reply: null, error: mapError(error) };
    const reply =
      typeof (data as { reply?: unknown } | null)?.reply === "string"
        ? (data as { reply: string }).reply
        : null;
    if (reply === null || reply.trim() === "") {
      return { reply: null, error: "El asistente devolvió una respuesta vacía." };
    }
    return { reply, error: null };
  } catch (thrown) {
    return { reply: null, error: mapError(thrown) };
  }
}
