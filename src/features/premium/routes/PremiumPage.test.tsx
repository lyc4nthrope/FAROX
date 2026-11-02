import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as premiumApi from "../api";
import type { PlanQuote } from "../types";
import { PremiumPage } from "./PremiumPage";

vi.mock("../api", () => ({
  fetchPlanQuote: vi.fn(),
  fetchMyPremiumStatus: vi.fn(),
}));

const MONTHLY: PlanQuote = {
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

const ANNUAL: PlanQuote = {
  ...MONTHLY,
  code: "premium_annual",
  name: "Premium anual",
  finalCents: 10000000,
  taxCents: 1596639,
  mpFeeCents: 486710,
  netCents: 7916651,
  intervalMonths: 12,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(premiumApi.fetchPlanQuote).mockImplementation(async (code) => ({
    quote: code === "premium_annual" ? ANNUAL : MONTHLY,
    error: null,
  }));
  vi.mocked(premiumApi.fetchMyPremiumStatus).mockResolvedValue({
    data: {
      premium: false,
      premiumUntil: null,
      premiumGraceUntil: null,
      graceActive: false,
      needsStoreChoice: false,
      activeOwnedStores: 1,
    },
    error: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("PremiumPage (0033)", () => {
  it("muestra el desglose de precio de los dos planes", async () => {
    render(
      <MemoryRouter>
        <PremiumPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Premium mensual")).toBeInTheDocument();
    expect(screen.getByText("Premium anual")).toBeInTheDocument();
    expect(screen.getAllByText(/IVA incluido/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Mercado Pago estimado/).length).toBe(2);
    expect(screen.getAllByText(/Neto FAROX/).length).toBe(2);
    expect(screen.getAllByText("Pago disponible próximamente").length).toBe(2);
    expect(screen.getByText("Gratis vs Premium")).toBeInTheDocument();
    expect(screen.getByText("Preguntas frecuentes")).toBeInTheDocument();
    expect(screen.getByText("Hasta 3")).toBeInTheDocument();
  });

  it("si ya es Premium no ofrece pagar de nuevo", async () => {
    vi.mocked(premiumApi.fetchMyPremiumStatus).mockResolvedValue({
      data: {
        premium: true,
        premiumUntil: "2026-12-31T12:00:00Z",
        premiumGraceUntil: null,
        graceActive: false,
        needsStoreChoice: false,
        activeOwnedStores: 3,
      },
      error: null,
    });

    render(
      <MemoryRouter>
        <PremiumPage />
      </MemoryRouter>,
    );

    expect((await screen.findAllByText(/Ya sos Premium/)).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Pago disponible próximamente")).not.toBeInTheDocument();
  });
});
