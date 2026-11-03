import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// Asistente FARØX — adaptador GENÉRICO (API compatible con OpenAI).
//
// Habla `POST {AGENT_BASE_URL}/chat/completions` con function calling, el
// contrato que comparten OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Together,
// Ollama/vLLM y el endpoint compatible de Gemini. Cambiar de proveedor es
// cambiar AGENT_BASE_URL + AGENT_API_KEY + AGENT_MODEL: no se toca código.
//
// El modelo nunca ejecuta SQL: elige entre herramientas fijas y cada una corre
// como RPC SECURITY DEFINER con el JWT del usuario, así que la RLS decide qué
// puede ver. Ninguna herramienta escribe.
// ============================================================================

const MAX_STEPS = 4;
const MAX_HISTORY = 8;

export interface AgentHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface AgentToolLog {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

/**
 * El proveedor retiró el modelo (404, o 400 con "not found / no longer /
 * does not exist / deprecated"). Se distingue del resto de los fallos para
 * usar el respaldo y para que el log diga MODEL_UNAVAILABLE.
 */
export class ModelUnavailableError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ModelUnavailableError";
    this.status = status;
  }
}

function isModelUnavailable(status: number, detail: string): boolean {
  if (status === 404) return true;
  if (status !== 400 && status !== 422) return false;
  const text = detail.toLowerCase();
  return (
    text.includes("not found") ||
    text.includes("not supported") ||
    text.includes("no longer") ||
    text.includes("does not exist") ||
    text.includes("is not available") ||
    text.includes("deprecated") ||
    text.includes("unsupported model") ||
    text.includes("invalid model")
  );
}

export function chatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

const SYSTEM_PROMPT = `Sos el asistente de FARØX, una app de inventario, pedidos y rutas para tiendas y distribuidoras.

Reglas:
- Respondé en español, breve y concreto, con números cuando los tengas.
- Nunca inventes cantidades, precios, fechas ni nombres de productos: si no lo devuelve una herramienta, decí que no lo podés saber.
- Para stock o último pedido, primero usá buscar_producto. Si devuelve varios candidatos parecidos, pedí aclaración mostrando las opciones (máximo una pregunta).
- Si buscar_producto no devuelve nada, pedí otro término (marca, código o nombre más corto).
- "Días sin pedido" es cuánto hace desde el último pedido registrado de ese producto.
- En esta versión solo podés consultar. No podés registrar ventas, compras ni cambios de stock: si te lo piden, explicá que por ahora solo consultás.
- No muestres detalles técnicos (nombres de tablas, RPC, errores internos).`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "buscar_producto",
      description:
        "Busca productos activos por nombre, marca o código de barras. Usala siempre antes de consultar stock o pedidos. Devuelve hasta 8 candidatos con product_id, nombre, marca y código.",
      parameters: {
        type: "object",
        properties: {
          termino: {
            type: "string",
            description:
              "Texto a buscar: nombre, marca o código de barras (ej. 'arroz', 'diana', '770123').",
          },
        },
        required: ["termino"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_stock",
      description:
        "Devuelve cuánto stock hay de un producto, por tienda. Para un distribuidor devuelve el stock de su propio catálogo. Requiere product_id de buscar_producto.",
      parameters: {
        type: "object",
        properties: {
          producto_id: {
            type: "integer",
            description: "product_id devuelto por buscar_producto.",
          },
        },
        required: ["producto_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dias_sin_pedido",
      description:
        "Devuelve el último pedido registrado de un producto (por tienda) y cuántos días pasaron desde entonces. Requiere product_id de buscar_producto.",
      parameters: {
        type: "object",
        properties: {
          producto_id: {
            type: "integer",
            description: "product_id devuelto por buscar_producto.",
          },
        },
        required: ["producto_id"],
      },
    },
  },
] as const;

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ChatResponse {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
}

interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
}

function providerHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

export async function runAgent(input: {
  client: SupabaseClient;
  apiKey: string;
  baseUrl: string;
  model: string;
  fallbackModel?: string | null;
  message: string;
  history: readonly AgentHistoryItem[];
}): Promise<{ reply: string; toolLog: AgentToolLog[]; model: string }> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...input.history.slice(-MAX_HISTORY).map(
      (item): ChatMessage => ({ role: item.role, content: item.content }),
    ),
    { role: "user", content: input.message },
  ];
  const toolLog: AgentToolLog[] = [];
  const url = chatUrl(input.baseUrl);
  let activeModel = input.model;
  let usedFallback = false;
  const fallback = input.fallbackModel ?? null;

  async function callModel(): Promise<ChatResponse> {
    const response = await fetch(url, {
      method: "POST",
      headers: providerHeaders(input.apiKey),
      body: JSON.stringify({
        model: activeModel,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.2,
      }),
    });
    if (response.ok) return (await response.json()) as ChatResponse;
    const detail = await response.text();
    const short = `provider ${response.status}: ${detail.slice(0, 300)}`;
    if (isModelUnavailable(response.status, detail)) {
      throw new ModelUnavailableError(short, response.status);
    }
    throw new Error(short);
  }

  for (let step = 0; step < MAX_STEPS; step += 1) {
    let payload: ChatResponse;
    try {
      payload = await callModel();
    } catch (error) {
      // Obsolescencia: un solo reintento con el modelo de respaldo. El
      // fallback queda activo para el resto del turno.
      const canFallback =
        error instanceof ModelUnavailableError &&
        !usedFallback &&
        fallback !== null &&
        fallback !== activeModel;
      if (!canFallback || fallback === null) throw error;
      usedFallback = true;
      activeModel = fallback;
      payload = await callModel();
    }

    const message = payload.choices?.[0]?.message;
    const calls = message?.tool_calls ?? [];
    const text = typeof message?.content === "string" ? message.content.trim() : "";

    if (calls.length === 0) {
      return {
        reply: text === "" ? "No pude generar una respuesta. Probá reformulando la pregunta." : text,
        toolLog,
        model: activeModel,
      };
    }

    messages.push({ role: "assistant", content: message?.content ?? null, tool_calls: calls });
    for (const call of calls) {
      const args = parseArgs(call.function.arguments);
      const result = await runTool(input.client, call.function.name, args);
      toolLog.push({ name: call.function.name, args, result });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    reply: "No pude terminar la consulta. Probá con una pregunta más específica.",
    toolLog,
    model: activeModel,
  };
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Ping mínimo para el chequeo de salud (1 token de salida). */
export async function probeModel(
  input: ProviderConfig & { model: string },
): Promise<{ ok: boolean; status: number; detail: string }> {
  try {
    const response = await fetch(chatUrl(input.baseUrl), {
      method: "POST",
      headers: providerHeaders(input.apiKey),
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        temperature: 0,
      }),
    });
    const detail = response.ok ? "" : (await response.text()).slice(0, 200);
    return { ok: response.ok, status: response.status, detail };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      detail: error instanceof Error ? error.message : "network",
    };
  }
}

async function runTool(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (name === "buscar_producto") {
    const termino = typeof args.termino === "string" ? args.termino.trim() : "";
    if (termino === "") return { error: "Falta el término de búsqueda." };
    const { data, error } = await client.rpc("agent_search_products", { p_term: termino });
    if (error !== null) return { error: "No pude buscar productos." };
    return { productos: data ?? [] };
  }

  if (name === "consultar_stock" || name === "dias_sin_pedido") {
    const productId = Number(args.producto_id);
    if (!Number.isFinite(productId) || productId <= 0) {
      return { error: "producto_id inválido." };
    }
    if (name === "consultar_stock") {
      const { data, error } = await client.rpc("agent_stock", { p_product: productId });
      if (error !== null) return { error: "No pude consultar el stock." };
      return { stock: data ?? [] };
    }
    const { data, error } = await client.rpc("agent_last_order", { p_product: productId });
    if (error !== null) return { error: "No pude consultar los pedidos." };
    return { pedidos: data ?? [] };
  }

  return { error: `Herramienta desconocida: ${name}` };
}
