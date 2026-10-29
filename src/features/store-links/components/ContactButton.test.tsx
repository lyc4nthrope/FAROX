import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { contactHref } from "../contact";
import { ContactButton } from "./ContactButton";

vi.mock("../api", () => ({
  fetchCounterpartContact: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("contactHref (0029)", () => {
  it("arma WhatsApp, teléfono y email; null si falta el identificador", () => {
    expect(
      contactHref({
        full_name: "Distribuidora",
        phone_number: "+57 300 123 4567",
        email: null,
        contact_preference: "whatsapp",
      }),
    ).toBe("https://wa.me/573001234567");
    expect(
      contactHref({
        full_name: "Distribuidora",
        phone_number: "3001234567",
        email: null,
        contact_preference: "phone",
      }),
    ).toBe("tel:3001234567");
    expect(
      contactHref({
        full_name: "Distribuidora",
        phone_number: null,
        email: "dist@farox.app",
        contact_preference: "email",
      }),
    ).toBe("mailto:dist@farox.app");
    expect(
      contactHref({
        full_name: "Distribuidora",
        phone_number: null,
        email: null,
        contact_preference: "whatsapp",
      }),
    ).toBeNull();
  });
});

describe("ContactButton (0029)", () => {
  it("abre el medio configurado de la contraparte", async () => {
    vi.mocked(api.fetchCounterpartContact).mockResolvedValue({
      data: [
        {
          full_name: "Distribuidora Andes",
          phone_number: "3001234567",
          email: "andes@farox.app",
          contact_preference: "whatsapp",
        },
      ],
      error: null,
    });

    render(<ContactButton kind="distribuidor" id={7} name="Distribuidora Andes" />);

    const link = await screen.findByRole("link", { name: "Contactar a Distribuidora Andes" });
    expect(link).toHaveAttribute("href", "https://wa.me/3001234567");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("sin identificador muestra la alerta Sin contacto", async () => {
    vi.mocked(api.fetchCounterpartContact).mockResolvedValue({
      data: [
        {
          full_name: "Distribuidora Andes",
          phone_number: null,
          email: null,
          contact_preference: "whatsapp",
        },
      ],
      error: null,
    });

    render(<ContactButton kind="distribuidor" id={7} name="Distribuidora Andes" />);

    expect(await screen.findByText("Sin contacto")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
