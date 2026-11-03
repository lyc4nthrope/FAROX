import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// Asistente FARØX — fase 1: SOLO consultas (lectura).
//
// El modelo nunca ejecuta SQL: elige entre tres herramientas fijas, y cada una
// corre como RPC SECURITY DEFINER con el JWT del usuario, así que la RLS
// decide qué puede ver. Ninguna herramienta escribe.
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

const SYSTEM_PROMPT = `Sos el asistente de FARØX, una app de inventario, pedidos y rutas para tiendas y distribuidoras.

Reglas:
- Respondé en español, breve y concreto, con números cuando los tengas.
- Nunca inventes cantidades, precios, fechas ni nombres de productos: si no lo devuelve una herramienta, decí que no lo podés saber.
- Para stock o último pedido, primero usá buscar_producto. Si devuelve varios candidatos parecidos, pedí aclaración mostrando las opciones (máximo una pregunta).
- Si buscar_producto no devuelve nada, pedí otro término (marca, código o nombre más corto).
- "Días sin pedido" es cuánto hace desde el último pedido registrado de ese producto.
- En esta versión solo podés consultar. No podés registrar ventas, compras ni cambios de stock: si te lo piden, explicá que por ahora solo consultás.
- No muestres detalles técnicos (nombres de tablas, RPC, errores internos).`;

// Gemini usa un subconjunto de OpenAPI: tipos en mayúsculas.
const TOOLS = [
  {
    name: "buscar_producto",
    description:
      "Busca productos activos por nombre, marca o código de barras. Usala siempre antes de consultar stock o pedidos. Devuelve hasta 8 candidatos con product_id, nombre, marca y código.",
    parameters: {
      type: "OBJECT",
      properties: {
        termino: {
          type: "STRING",
          description: "Texto a buscar: nombre, marca o código de barras (ej. 'arroz', 'diana', '770123').",
        },
      },
      required: ["termino"],
    },
  },
  {
    name: "consultar_stock",
    description:
      "Devuelve cuánto stock hay de un producto, por tienda. Para un distribuidor devuelve el stock de su propio catálogo. Requiere product_id de buscar_producto.",
    parameters: {
      type: "OBJECT",
      properties: {
        producto_id: { type: "INTEGER", description: "product_id devuelto por buscar_producto." },
      },
      required: ["producto_id"],
    },
  },
  {
    name: "dias_sin_pedido",
    description:
      "Devuelve el último pedido registrado de un producto (por tienda) y cuántos días pasaron desde entonces. Requiere product_id de buscar_producto.",
    parameters: {
      type: "OBJECT",
      properties: {
        producto_id: { type: "INTEGER", description: "product_id devuelto por buscar_producto." },
      },
      required: ["producto_id"],
    },
  },
] as const;

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
}

export async function runAgent(input: {
  client: SupabaseClient;
  apiKey: string;
  model: string;
  message: string;
  history: readonly AgentHistoryItem[];
}): Promise<{ reply: string; toolLog: AgentToolLog[] }> {
  const contents: GeminiContent[] = [
    ...input.history.slice(-MAX_HISTORY).map((item) => ({
      role: item.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: item.content }],
    })),
    { role: "user", parts: [{ text: input.message }] },
  ];
  const toolLog: AgentToolLog[] = [];
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    `${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        tools: [{ functionDeclarations: TOOLS }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 700 },
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`gemini ${response.status}: ${detail.slice(0, 300)}`);
    }
    const payload = (await response.json()) as GeminiResponse;
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.flatMap((part) =>
      "functionCall" in part && part.functionCall !== undefined ? [part.functionCall] : [],
    );
    const text = parts
      .flatMap((part) => ("text" in part && typeof part.text === "string" ? [part.text] : []))
      .join("")
      .trim();

    if (calls.length === 0) {
      return {
        reply: text === "" ? "No pude generar una respuesta. Probá reformulando la pregunta." : text,
        toolLog,
      };
    }

    contents.push({ role: "model", parts });
    const responses: GeminiPart[] = [];
    for (const call of calls) {
      const args = (call.args ?? {}) as Record<string, unknown>;
      const result = await runTool(input.client, call.name, args);
      toolLog.push({ name: call.name, args, result });
      responses.push({ functionResponse: { name: call.name, response: { result } } });
    }
    contents.push({ role: "user", parts: responses });
  }

  return {
    reply: "No pude terminar la consulta. Probá con una pregunta más específica.",
    toolLog,
  };
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
