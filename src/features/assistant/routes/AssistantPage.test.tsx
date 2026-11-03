import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as inventoryApi from "../../inventory/api";
import * as assistantApi from "../api";
import { AssistantPage } from "./AssistantPage";

vi.mock("../api", () => ({
  askAgent: vi.fn(),
  createConversation: vi.fn(),
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
    expect(
      await screen.findByText("Hay 12 unidades en Tienda Centro."),
    ).toBeInTheDocument();
  });

  it("muestra el error del asistente sin perder la conversación", async () => {
    vi.mocked(assistantApi.askAgent).mockResolvedValue({
      reply: null,
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
});
