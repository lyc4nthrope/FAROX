// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAgent } from "./agent";

const toolCall = (name: string, args: unknown) => ({
  choices: [
    {
      message: {
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      },
    },
  ],
});

const text = { choices: [{ message: { content: "ok" } }] };

function stub(...responses: unknown[]) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => response });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const base = {
  role: "operador",
  premium: true,
  conversationId: 9,
  writesEnabled: true,
  store: null,
  channel: "whatsapp" as const,
  actorUserId: "u-1",
  actorWaId: "573001234567",
  apiKey: "k",
  baseUrl: "https://x",
  model: "m",
  message: "consulta",
  history: [],
};

describe("whatsapp channel routing", () => {
  it("lee stock con agent_stock_for_user y el actor resuelto", async () => {
    stub(toolCall("consultar_stock", { producto_id: 5 }), text);
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await runAgent({ ...base, client: { rpc, from: vi.fn() } as never });

    expect(rpc).toHaveBeenCalledWith("agent_stock_for_user", {
      p_user: "u-1",
      p_product: 5,
    });
  });

  it("prepara con agent_prepare_action_for_user y p_wa_id", async () => {
    stub(toolCall("preparar_faltante", { store_id: 3, product_id: 5, shortage: true }), text);
    const rpc = vi.fn().mockResolvedValue({
      data: { action_id: 1, summary: {}, expires_at: "2030-01-01" },
      error: null,
    });
    await runAgent({ ...base, client: { rpc, from: vi.fn() } as never });

    expect(rpc).toHaveBeenCalledWith(
      "agent_prepare_action_for_user",
      expect.objectContaining({
        p_user: "u-1",
        p_wa_id: "573001234567",
        p_kind: "shortage_toggle",
        p_conversation: 9,
      }),
    );
  });

  it("no llega a una RPC de escritura con writesEnabled=false", async () => {
    stub(toolCall("preparar_faltante", { store_id: 3, product_id: 5, shortage: true }), text);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await runAgent({
      ...base,
      writesEnabled: false,
      client: { rpc, from: vi.fn() } as never,
    });

    expect(rpc).not.toHaveBeenCalled();
  });

  it("no ofrece el cambio de precios por WhatsApp", async () => {
    const fetchMock = stub(text);
    await runAgent({ ...base, client: { rpc: vi.fn(), from: vi.fn() } as never });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as {
      tools: { function: { name: string } }[];
    };
    const names = body.tools.map((tool) => tool.function.name);
    expect(names).not.toContain("preparar_cambio_precios");
    expect(names).toContain("preparar_salida_tienda");
  });
});
