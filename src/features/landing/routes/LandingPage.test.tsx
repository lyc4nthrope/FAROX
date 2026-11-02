import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as premiumApi from "../../premium/api";
import type { PlanQuote } from "../../premium/types";
import { LandingPage } from "./LandingPage";

vi.mock("../../premium/api", () => ({
  fetchPlanQuote: vi.fn(),
}));

const QUOTE: PlanQuote = {
  code: "premium_monthly",
  name: "Premium mensual",
  finalCents: 1000000,
  baseCents: 840336,
  taxCents: 159664,
  mpFeeCents: 134351,
  netCents: 705985,
  currency: "COP",
  intervalMonths: 1,
  taxIncluded: true,
  feePassedToCustomer: false,
  mpFeeBps: 329,
  mpFeeFixedCents: 80000,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(premiumApi.fetchPlanQuote).mockImplementation(async (code) => ({
    quote:
      code === "premium_annual"
        ? { ...QUOTE, code: "premium_annual", finalCents: 10000000 }
        : QUOTE,
    error: null,
  }));
});

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

  it("muestra la sección Premium con el precio de quote_plan", async () => {
    renderLanding();

    expect(await screen.findByRole("heading", { name: "Más tiendas y control para tu operación." })).toBeInTheDocument();
    expect(screen.getByText("Hasta 3 tiendas activas")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear cuenta y ver planes" })).toHaveAttribute(
      "href",
      "/register",
    );
  });
});
