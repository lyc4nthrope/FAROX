import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { LandingPage } from "./LandingPage";

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe("LandingPage (presentación pública)", () => {
  afterEach(() => {
    cleanup();
  });

  it("presenta la propuesta y el CTA principal que inicia el registro", () => {
    renderLanding();

    expect(
      screen.getByRole("heading", { level: 1, name: "Todo tu negocio, en orden." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Empezar ahora" })).toHaveAttribute(
      "href",
      "/register",
    );

    const registros = screen.getAllByRole("link", { name: "Registrarse" });
    expect(registros.length).toBeGreaterThan(0);
    for (const link of registros) {
      expect(link).toHaveAttribute("href", "/register");
    }

    const logins = screen.getAllByRole("link", { name: "Iniciar sesión" });
    expect(logins.length).toBeGreaterThan(0);
    for (const link of logins) {
      expect(link).toHaveAttribute("href", "/login");
    }
  });

  it("explica los tres roles y los pasos, incluida la confirmación de email", () => {
    renderLanding();

    expect(screen.getByText("Administrador")).toBeInTheDocument();
    expect(screen.getByText("Operador de tienda")).toBeInTheDocument();
    expect(screen.getByText("Distribuidor")).toBeInTheDocument();
    expect(
      screen.getByText(/Sin confirmarlo no vas a poder iniciar sesión/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Política de Privacidad" })).toHaveAttribute(
      "href",
      "/privacidad",
    );
  });
});
