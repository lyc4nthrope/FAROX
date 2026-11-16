import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as inventoryApi from "../../inventory/api";
import * as assistantApi from "../api";
import { AssistantPage } from "./AssistantPage";

vi.mock("../api", () => ({
  askAgent: vi.fn(),
  cancelAction: vi.fn(),
  createConversation: vi.fn(),
  executeAction: vi.fn(),
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock("../../inventory/api", () => ({
  fetchMyStores: vi.fn(),
  fetchDistributorStores: vi.fn(),
}));
vi.mock("../../../app/providers/AuthProvider", () => ({
  useAuth: () => ({ role: "operador", premium: true }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inventoryApi.fetchMyStores).mockResolvedValue({
    data: [{ id: 10, name: "Tienda Centro" }],
    error: null,
  });
  vi.mocked(assistantApi.createConversation).mockResolvedValue({ data: 7, error: null });
  vi.mocked(assistantApi.sendMessage).mockResolvedValue({ error: null });
  vi.mocked(assistantApi.askAgent).mockResolvedValue({
    reply: "Hay 12 unidades en Tienda Centro.",
    action: null,
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("AssistantPage · asistente de consultas (0039)", () => {
  it("envía la consulta, crea la conversación y muestra la respuesta", async () => {
    render(<AssistantPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "¿Cuánto hay de arroz?" }));

    await waitFor(() =>
      expect(assistantApi.createConversation).toHaveBeenCalledWith({
        title: "¿Cuánto hay de arroz?",
        storeId: null,
      }),
    );
    expect(assistantApi.sendMessage).toHaveBeenCalledWith(7, "¿Cuánto hay de arroz?");
    expect(await screen.findByText("Hay 12 unidades en Tienda Centro.")).toBeInTheDocument();
  });

  it("muestra el error del asistente sin perder la conversación", async () => {
    vi.mocked(assistantApi.askAgent).mockResolvedValue({
      reply: null,
      action: null,
      error: "No pude responder ahora. Probá de nuevo en un rato.",
    });
    render(<AssistantPage />);
    const user = userEvent.setup();

    await user.type(
      await screen.findByLabelText("Consulta para el asistente"),
      "¿cuánto hay de café?",
    );
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pude responder ahora. Probá de nuevo en un rato.",
    );
    expect(screen.getByText("¿cuánto hay de café?")).toBeInTheDocument();
  });

  it("0040: muestra el acceso directo a WhatsApp cuando está configurado", async () => {
    vi.stubEnv("VITE_WHATSAPP_AGENT_NUMBER", "57 300 123 4567");
    render(<AssistantPage />);

    const link = await screen.findByRole("link", {
      name: "Abrir el asistente en WhatsApp",
    });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("https://wa.me/573001234567?text="),
    );
    expect(link).toHaveAttribute("href", expect.stringContaining("FAR%C3%98X"));
  });

  it("refresca las pantallas abiertas (useLoad) después de confirmar un borrador", async () => {
    vi.stubEnv("VITE_AGENT_WRITES_ENABLED", "true");
    vi.mocked(assistantApi.askAgent).mockResolvedValue({
      reply: "Preparé la salida.",
      action: {
        action_id: 15,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        summary: {
          kind: "store_exit",
          store: "Tienda Centro",
          lines: [{ name: "Arroz", qty: 1, unit_price: 4500 }],
          discount: 0,
          total: 4500,
        },
      },
      error: null,
    });
    vi.mocked(assistantApi.executeAction).mockResolvedValue({
      data: { ok: true, count: 1 },
      error: null,
    });

    render(<AssistantPage />);
    const user = userEvent.setup();

    await waitFor(() => expect(inventoryApi.fetchMyStores).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole("button", { name: "¿Cuánto hay de arroz?" }));
    const confirm = await screen.findByRole("button", { name: "Confirmar" });
    await user.click(confirm);

    await waitFor(() => expect(inventoryApi.fetchMyStores).toHaveBeenCalledTimes(2));
  });
});
