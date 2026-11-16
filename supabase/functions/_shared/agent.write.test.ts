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

const text = { choices: [{ message: { content: "Listo." } }] };

function stubFetch(...responses: unknown[]) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => response });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const baseInput = {
  role: "distribuidor",
  premium: true,
  conversationId: 1,
  store: { id: 10, name: "Tienda Centro" },
  channel: "web" as const,
  actorUserId: "u1",
  actorWaId: null,
  apiKey: "k",
  baseUrl: "https://example.test",
  model: "m",
  message: "Compré 2 arroz a 10",
  history: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("write tools", () => {
  it("preparar_compra_distribuidor envía unit_price, no unit_cost", async () => {
    stubFetch(
      toolCall("preparar_compra_distribuidor", {
        lines: [{ product_id: 5, quantity: 2, unit_cost: 10 }],
      }),
      text,
    );
    const rpc = vi.fn().mockResolvedValue({
      data: { action_id: 7, summary: {}, expires_at: "2030-01-01T00:00:00Z" },
      error: null,
    });
    await runAgent({
      ...baseInput,
      client: { rpc, from: vi.fn() } as never,
      writesEnabled: true,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, params] = rpc.mock.calls[0] as [
      string,
      { p_kind: string; p_payload: { lines: Record<string, unknown>[] } },
    ];
    expect(fn).toBe("agent_prepare_action");
    expect(params.p_kind).toBe("distributor_purchase");
    expect(params.p_payload.lines[0]).toMatchObject({
      product_id: 5,
      quantity: 2,
      unit_price: 10,
    });
    expect(params.p_payload.lines[0]).not.toHaveProperty("unit_cost");
  });

  it("no prepara nada si writesEnabled=false", async () => {
    stubFetch(toolCall("preparar_faltante", { store_id: 10, product_id: 2, shortage: true }), text);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await runAgent({
      ...baseInput,
      client: { rpc, from: vi.fn() } as never,
      writesEnabled: false,
    });

    expect(rpc).not.toHaveBeenCalled();
  });

  it("no ofrece las tools de escritura si writesEnabled=false", async () => {
    const fetchMock = stubFetch(text);
    await runAgent({
      ...baseInput,
      client: { rpc: vi.fn(), from: vi.fn() } as never,
      writesEnabled: false,
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as {
      tools: { function: { name: string } }[];
    };
    const names = body.tools.map((tool) => tool.function.name);
    expect(names).toContain("buscar_producto");
    expect(names).not.toContain("preparar_salida_tienda");
  });

  it("ofrece las tools de escritura y la tienda activa si writesEnabled=true", async () => {
    const fetchMock = stubFetch(text);
    await runAgent({
      ...baseInput,
      client: { rpc: vi.fn(), from: vi.fn() } as never,
      writesEnabled: true,
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as {
      messages: { content: string }[];
      tools: { function: { name: string } }[];
    };
    const names = body.tools.map((tool) => tool.function.name);
    expect(names).toContain("preparar_salida_tienda");
    expect(names).toContain("preparar_cambio_precios");
    expect(body.messages[0]?.content).toContain("Tienda Centro");
    expect(body.messages[0]?.content).toContain("id 10");
  });

  it("el system prompt limita el alcance al negocio", async () => {
    const fetchMock = stubFetch(text);
    await runAgent({
      ...baseInput,
      client: { rpc: vi.fn(), from: vi.fn() } as never,
      writesEnabled: false,
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as {
      messages: { content: string }[];
    };
    expect(body.messages[0]?.content).toContain(
      "Alcance: solo respondés sobre la operación de FARØX",
    );
  });
});

describe("tiempo límite del proveedor", () => {
  it("un modelo que no responde termina en error en vez de colgar el turno", async () => {
    // fetch que nunca resuelve salvo que se aborte su señal.
    const fetchMock = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const started = Date.now();
    await expect(runAgent({ ...baseInput, writesEnabled: false, timeoutMs: 50 })).rejects.toThrow(
      /timeout/i,
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un cuerpo de respuesta que se corta a medias también es timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new DOMException("The signal has been aborted", "TimeoutError");
        },
      })),
    );

    await expect(runAgent({ ...baseInput, writesEnabled: false, timeoutMs: 50 })).rejects.toThrow(
      /provider timeout/,
    );
  });
});
