import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import {
  resolvePeriod,
  summarizeDashboard,
  type DashboardPeriod,
  type DashboardRow,
  type DashboardScope,
} from "./dashboard.ts";

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

export interface AgentAction {
  action_id: number;
  summary: unknown;
  expires_at: string;
  requires_strong_confirmation?: boolean;
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
- Alcance: solo respondés sobre la operación de FARØX (inventario, productos, stock, pedidos, rutas, ventas, compras, precios, faltantes, dashboard, tiendas, distribuidores y cuenta). Si la pregunta es de otro tema (matemática, programación, historia, recetas, política, etc.), no la respondas: decí en una frase que solo ayudás con la operación de FARØX y ofrecé una consulta relacionada. No des clases ni explicaciones generales. Para datos de negocio, usá solo resultados de herramientas; si ninguna devuelve el dato, decí que no lo podés saber.
- Respondé en español, breve y concreto, con números cuando los tengas.
- Nunca inventes cantidades, precios, fechas ni nombres de productos: si no lo devuelve una herramienta, decí que no lo podés saber.
- Para stock o último pedido, primero usá buscar_producto. Si devuelve varios candidatos parecidos, pedí aclaración mostrando las opciones (máximo una pregunta).
- Si buscar_producto no devuelve nada, pedí otro término (marca, código o nombre más corto).
- "Días sin pedido" es cuánto hace desde el último pedido registrado de ese producto.
- Para totales de ventas o compras usá consultar_dashboard; no sumes filas a mano. En admin/operador, ventas = salidas y compras = entradas; en distribuidor, ventas = entradas (ventas a tiendas).
- No muestres detalles técnicos (nombres de tablas, RPC, errores internos).`;

const READ_ONLY_RULE =
  "En esta versión solo podés consultar. No podés registrar ventas, compras ni cambios de stock: si te lo piden, explicá que por ahora solo consultás.";

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
  {
    type: "function",
    function: {
      name: "listar_tiendas",
      description:
        "Devuelve las tiendas a las que el usuario tiene acceso (id y nombre). Usala antes de preparar una operación que requiera store_id; no inventes IDs.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_dashboard",
      description:
        "Devuelve ventas, compras y movimientos agregados del dashboard para hoy, este mes, el mes pasado o un rango custom. Usala para totales ('cuánto se vendió', 'cuánto se compró'); no sumes filas a mano. Requiere Premium.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["today", "month", "last_month", "custom"],
            description: "Período a consultar.",
          },
          from: {
            type: "string",
            description: "YYYY-MM-DD, solo cuando period=custom.",
          },
          to: {
            type: "string",
            description: "YYYY-MM-DD, solo cuando period=custom.",
          },
        },
        required: ["period"],
      },
    },
  },
] as const;

const WRITE_RULES = `Podés PREPARAR borradores de operaciones, pero NO ejecutarlas. Reglas:
- Nunca digas que registraste, cambiaste o guardaste algo. Decí "preparé el borrador" y pedí confirmación.
- Antes de preparar, pedí los datos faltantes: tienda, producto, cantidad, costo (compras) o precio nuevo (precios).
- Para precios, mostrá siempre el valor anterior y el nuevo; no inventes precios. Un precio nuevo debe ser mayor a 0.
- Usá los product_id que devolvió buscar_producto; no inventes IDs.
- Solo prepará una operación si el usuario la pidió explícitamente en este turno.
- Después de preparar, no vuelvas a preparar la misma operación; esperá la confirmación.`;

const WRITE_TOOLS = [
  {
    type: "function",
    function: {
      name: "preparar_salida_tienda",
      description:
        "Prepara (NO registra) una salida/venta de una tienda. Requiere store_id y líneas con product_id y quantity. El usuario debe confirmar el borrador.",
      parameters: {
        type: "object",
        properties: {
          store_id: { type: "integer", description: "Tienda de la salida." },
          lines: {
            type: "array",
            description: "Productos y cantidades.",
            items: {
              type: "object",
              properties: {
                product_id: {
                  type: "integer",
                  description: "product_id devuelto por buscar_producto.",
                },
                quantity: { type: "number", description: "Cantidad mayor a 0." },
              },
              required: ["product_id", "quantity"],
            },
          },
          discount: { type: "number", description: "Descuento 0-100, opcional." },
        },
        required: ["store_id", "lines"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "preparar_venta_distribuidor",
      description:
        "Prepara (NO registra) una venta del distribuidor a una tienda vinculada. Requiere store_id y líneas con product_id y quantity. El usuario debe confirmar.",
      parameters: {
        type: "object",
        properties: {
          store_id: { type: "integer", description: "Tienda vinculada." },
          lines: {
            type: "array",
            description: "Productos y cantidades.",
            items: {
              type: "object",
              properties: {
                product_id: {
                  type: "integer",
                  description: "product_id devuelto por buscar_producto.",
                },
                quantity: { type: "number", description: "Cantidad mayor a 0." },
              },
              required: ["product_id", "quantity"],
            },
          },
          discount: { type: "number", description: "Descuento 0-100, opcional." },
        },
        required: ["store_id", "lines"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "preparar_compra_distribuidor",
      description:
        "Prepara (NO registra) una compra del distribuidor que suma stock a su catálogo. Requiere líneas con product_id, quantity y unit_cost. El usuario debe confirmar.",
      parameters: {
        type: "object",
        properties: {
          lines: {
            type: "array",
            description: "Productos, cantidades y costo unitario.",
            items: {
              type: "object",
              properties: {
                product_id: {
                  type: "integer",
                  description: "product_id devuelto por buscar_producto.",
                },
                quantity: { type: "number", description: "Cantidad mayor a 0." },
                unit_cost: { type: "number", description: "Costo unitario mayor a 0." },
              },
              required: ["product_id", "quantity", "unit_cost"],
            },
          },
        },
        required: ["lines"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "preparar_cambio_precios",
      description:
        "Prepara (NO aplica) un cambio de precios. Solo web. scope='store' para admin/operador (con store_id) o 'distributor' para distribuidor. Cada línea indica set_purchase/set_sale y el precio nuevo (> 0). El usuario debe confirmar.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["store", "distributor"] },
          store_id: { type: "integer", description: "Solo cuando scope=store." },
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                product_id: {
                  type: "integer",
                  description: "product_id devuelto por buscar_producto.",
                },
                set_purchase: { type: "boolean", description: "true para cambiar el costo." },
                purchase_price: { type: "number", description: "Nuevo costo (> 0)." },
                set_sale: { type: "boolean", description: "true para cambiar el precio de venta." },
                sale_price: { type: "number", description: "Nuevo precio de venta (> 0)." },
              },
              required: ["product_id"],
            },
          },
        },
        required: ["scope", "lines"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "preparar_faltante",
      description:
        "Prepara (NO aplica) activar o desactivar un faltante de una tienda. Requiere store_id, product_id y shortage (true/false).",
      parameters: {
        type: "object",
        properties: {
          store_id: { type: "integer", description: "Tienda del faltante." },
          product_id: {
            type: "integer",
            description: "product_id devuelto por buscar_producto.",
          },
          shortage: { type: "boolean", description: "true = marcar; false = quitar." },
        },
        required: ["store_id", "product_id", "shortage"],
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
  role: string;
  premium: boolean;
  conversationId: number;
  writesEnabled: boolean;
  store: { id: number; name: string } | null;
  channel: "web" | "whatsapp";
  actorUserId: string;
  actorWaId: string | null;
  apiKey: string;
  baseUrl: string;
  model: string;
  fallbackModel?: string | null;
  message: string;
  history: readonly AgentHistoryItem[];
}): Promise<{ reply: string; toolLog: AgentToolLog[]; model: string }> {
  const storeRule =
    input.store !== null
      ? `La tienda activa de esta conversación es "${input.store.name}" (id ${input.store.id}). Usá ese store_id en las operaciones de tienda; no inventes otro.`
      : "No hay una tienda activa en esta conversación. Si la operación requiere tienda, usá listar_tiendas y preguntá cuál.";
  const systemPrompt = input.writesEnabled
    ? `${SYSTEM_PROMPT}\n\n${WRITE_RULES}\n\n${storeRule}`
    : `${SYSTEM_PROMPT}\n\n${READ_ONLY_RULE}`;
  const writeTools =
    input.channel === "whatsapp"
      ? WRITE_TOOLS.filter((tool) => tool.function.name !== "preparar_cambio_precios")
      : WRITE_TOOLS;
  const tools = input.writesEnabled ? [...TOOLS, ...writeTools] : TOOLS;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...input.history
      .slice(-MAX_HISTORY)
      .map((item): ChatMessage => ({ role: item.role, content: item.content })),
    { role: "user", content: input.message },
  ];
  const toolLog: AgentToolLog[] = [];
  const url = chatUrl(input.baseUrl);
  let activeModel = input.model;
  let usedFallback = false;
  let prepared = false;
  const fallback = input.fallbackModel ?? null;

  async function callModel(): Promise<ChatResponse> {
    const response = await fetch(url, {
      method: "POST",
      headers: providerHeaders(input.apiKey),
      body: JSON.stringify({
        model: activeModel,
        messages,
        tools,
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
        reply:
          text === "" ? "No pude generar una respuesta. Probá reformulando la pregunta." : text,
        toolLog,
        model: activeModel,
      };
    }

    messages.push({ role: "assistant", content: message?.content ?? null, tool_calls: calls });
    for (const call of calls) {
      const args = parseArgs(call.function.arguments);
      const isPrepare = call.function.name.startsWith("preparar_");
      if (isPrepare && prepared) {
        const blocked = {
          error: "Ya preparé una operación en este turno; confirmala antes de preparar otra.",
        };
        toolLog.push({ name: call.function.name, args, result: blocked });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(blocked),
        });
        continue;
      }
      const result = await runTool(
        input.client,
        input.role,
        input.premium,
        input.conversationId,
        input.writesEnabled,
        input.channel,
        input.actorUserId,
        input.actorWaId,
        call.function.name,
        args,
      );
      if (
        isPrepare &&
        result !== null &&
        typeof (result as { action_id?: unknown }).action_id === "number"
      ) {
        prepared = true;
      }
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
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
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
  role: string,
  premium: boolean,
  conversationId: number,
  writesEnabled: boolean,
  channel: "web" | "whatsapp",
  actorUserId: string,
  actorWaId: string | null,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (name === "buscar_producto") {
    const termino = typeof args.termino === "string" ? args.termino.trim() : "";
    if (termino === "") return { error: "Falta el término de búsqueda." };
    const { data, error } =
      channel === "whatsapp"
        ? await client.rpc("agent_search_products_for_user", {
            p_user: actorUserId,
            p_term: termino,
          })
        : await client.rpc("agent_search_products", { p_term: termino });
    if (error !== null) return { error: "No pude buscar productos." };
    return { productos: data ?? [] };
  }

  if (name === "consultar_stock" || name === "dias_sin_pedido") {
    const productId = Number(args.producto_id);
    if (!Number.isFinite(productId) || productId <= 0) {
      return { error: "producto_id inválido." };
    }
    if (name === "consultar_stock") {
      const { data, error } =
        channel === "whatsapp"
          ? await client.rpc("agent_stock_for_user", {
              p_user: actorUserId,
              p_product: productId,
            })
          : await client.rpc("agent_stock", { p_product: productId });
      if (error !== null) return { error: "No pude consultar el stock." };
      return { stock: data ?? [] };
    }
    const { data, error } =
      channel === "whatsapp"
        ? await client.rpc("agent_last_order_for_user", {
            p_user: actorUserId,
            p_product: productId,
          })
        : await client.rpc("agent_last_order", { p_product: productId });
    if (error !== null) return { error: "No pude consultar los pedidos." };
    return { pedidos: data ?? [] };
  }

  if (name === "consultar_dashboard") {
    if (!premium) return { error: "El dashboard es una función Premium." };
    const period = typeof args.period === "string" ? args.period : "";
    if (!["today", "month", "last_month", "custom"].includes(period)) {
      return { error: "Período inválido." };
    }
    const range = resolvePeriod(
      period as DashboardPeriod,
      typeof args.from === "string" ? args.from : undefined,
      typeof args.to === "string" ? args.to : undefined,
    );
    if ("error" in range) return { error: range.error };

    const { data, error } =
      channel === "whatsapp"
        ? await client.rpc("agent_dashboard_for_user", {
            p_user: actorUserId,
            p_from: range.from,
            p_to: range.to,
          })
        : await client.rpc("get_dashboard", {
            p_from: range.from,
            p_to: range.to,
          });
    if (error !== null) return { error: "No pude consultar el dashboard." };

    const rows: DashboardRow[] = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      day: String(row.day),
      distributor_id: Number(row.distributor_id),
      entries_count: Number(row.entries_count),
      exits_count: Number(row.exits_count),
      entries_value: Number(row.entries_value),
      exits_value: Number(row.exits_value),
    }));
    const scope: DashboardScope = role === "distribuidor" ? "distributor" : "network";
    const names: Record<number, string> = {};
    if (scope === "network") {
      const { data: distributorRows } = await client
        .from("distributors")
        .select("id,name")
        .limit(500);
      for (const distributor of (distributorRows ?? []) as { id: number; name: string }[]) {
        names[distributor.id] = distributor.name;
      }
    }
    return summarizeDashboard(rows, scope, range.from, range.to, names);
  }

  if (name === "listar_tiendas") {
    if (channel === "whatsapp") {
      const { data, error } = await client.rpc("agent_list_stores_for_user", {
        p_user: actorUserId,
      });
      if (error !== null) return { error: "No pude listar las tiendas." };
      return { tiendas: data ?? [] };
    }

    if (role === "distribuidor") {
      const { data, error } = await client
        .from("store_distributors")
        .select("store_id,store:stores(name)")
        .limit(200);
      if (error !== null) return { error: "No pude listar las tiendas." };
      const rows = ((data ?? []) as Record<string, unknown>[]).map((row) => {
        const rawStore = row.store;
        const store = Array.isArray(rawStore) ? rawStore[0] : rawStore;
        const name =
          typeof store === "object" && store !== null
            ? String((store as { name?: unknown }).name ?? "")
            : "";
        return { id: Number(row.store_id), name };
      });
      rows.sort((a, b) => a.name.localeCompare(b.name, "es"));
      return { tiendas: rows };
    }

    let ids: number[] | null = null;
    if (role !== "admin") {
      const scope = await client.rpc("my_store_ids");
      if (scope.error !== null) return { error: "No pude listar las tiendas." };
      ids = Array.isArray(scope.data) ? (scope.data as number[]) : [];
      if (ids.length === 0) return { tiendas: [] };
    }
    let query = client.from("stores").select("id,name").eq("is_active", true).order("name");
    if (ids !== null) query = query.in("id", ids);
    const { data, error } = await query.limit(200);
    if (error !== null) return { error: "No pude listar las tiendas." };
    return { tiendas: data ?? [] };
  }

  if (
    name === "preparar_salida_tienda" ||
    name === "preparar_venta_distribuidor" ||
    name === "preparar_compra_distribuidor" ||
    name === "preparar_cambio_precios" ||
    name === "preparar_faltante"
  ) {
    if (!writesEnabled) {
      return { error: "Las operaciones no están habilitadas." };
    }

    const kind =
      name === "preparar_salida_tienda"
        ? "store_exit"
        : name === "preparar_venta_distribuidor"
          ? "distributor_sale"
          : name === "preparar_compra_distribuidor"
            ? "distributor_purchase"
            : name === "preparar_cambio_precios"
              ? "price_update"
              : "shortage_toggle";

    let payload: Record<string, unknown>;

    if (name === "preparar_salida_tienda" || name === "preparar_venta_distribuidor") {
      payload = { store_id: args.store_id, lines: args.lines, discount: args.discount ?? null };
    } else if (name === "preparar_compra_distribuidor") {
      const lines = Array.isArray(args.lines) ? args.lines : [];
      payload = {
        lines: lines.map((raw) => {
          const line = raw as Record<string, unknown>;
          return {
            product_id: line.product_id,
            quantity: line.quantity,
            unit_price: line.unit_cost,
          };
        }),
      };
    } else if (name === "preparar_cambio_precios") {
      const rawLines = Array.isArray(args.lines) ? args.lines : [];
      const lines = rawLines.map((raw) => {
        const line = raw as Record<string, unknown>;
        const setPurchase =
          line.set_purchase === true || line.set_purchase === "true" || line.set_purchase === 1;
        const setSale = line.set_sale === true || line.set_sale === "true" || line.set_sale === 1;
        return {
          product_id: line.product_id,
          set_purchase: setPurchase,
          purchase_price: line.purchase_price,
          set_sale: setSale,
          sale_price: line.sale_price,
        };
      });
      for (const line of lines) {
        if (
          line.set_purchase &&
          !(typeof line.purchase_price === "number" && line.purchase_price > 0)
        ) {
          return { error: "purchase_price debe ser mayor a 0." };
        }
        if (line.set_sale && !(typeof line.sale_price === "number" && line.sale_price > 0)) {
          return { error: "sale_price debe ser mayor a 0." };
        }
      }
      payload = { scope: args.scope, store_id: args.store_id ?? null, lines };
    } else {
      payload = {
        store_id: args.store_id,
        product_id: args.product_id,
        shortage: args.shortage,
      };
    }

    const { data, error } =
      channel === "whatsapp"
        ? await client.rpc("agent_prepare_action_for_user", {
            p_user: actorUserId,
            p_wa_id: actorWaId,
            p_conversation: conversationId,
            p_kind: kind,
            p_payload: payload,
          })
        : await client.rpc("agent_prepare_action", {
            p_conversation: conversationId,
            p_kind: kind,
            p_payload: payload,
          });
    if (error !== null) return { error: error.message };
    return data;
  }

  return { error: `Herramienta desconocida: ${name}` };
}
