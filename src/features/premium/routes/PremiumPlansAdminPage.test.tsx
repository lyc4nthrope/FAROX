import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as premiumApi from "../api";
import type { AdminPlan, PlanPreview } from "../types";
import { PremiumPlansAdminPage } from "./PremiumPlansAdminPage";

vi.mock("../api", () => ({
  fetchAdminPlans: vi.fn(),
  fetchPlanVersions: vi.fn(),
  previewPlanQuote: vi.fn(),
  updatePlanPricing: vi.fn(),
}));

const PLAN: AdminPlan = {
  id: 1,
  code: "premium_monthly",
  name: "Premium mensual",
  amountCents: 1000000,
  currency: "COP",
  intervalMonths: 1,
  taxRateBps: 1900,
  taxIncluded: true,
  mpFeeBps: 329,
  mpFeeFixedCents: 80000,
  mpFeeTaxBps: 1900,
  feePassedToCustomer: false,
  active: true,
  version: 1,
};

const PREVIEW: PlanPreview = {
  finalCents: 1000000,
  baseCents: 840336,
  taxCents: 159664,
  mpFeeCents: 134351,
  netCents: 705985,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(premiumApi.fetchAdminPlans).mockResolvedValue({ data: [PLAN], error: null });
  vi.mocked(premiumApi.fetchPlanVersions).mockResolvedValue({
    data: [
      {
        version: 1,
        amountCents: 1000000,
        taxRateBps: 1900,
        taxIncluded: true,
        mpFeeBps: 329,
        mpFeeFixedCents: 80000,
        mpFeeTaxBps: 1900,
        feePassedToCustomer: false,
        validFrom: "2026-11-01T12:00:00Z",
      },
    ],
    error: null,
  });
  vi.mocked(premiumApi.previewPlanQuote).mockResolvedValue({ preview: PREVIEW, error: null });
  vi.mocked(premiumApi.updatePlanPricing).mockResolvedValue({ version: 2, error: null });
});

afterEach(() => {
  cleanup();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <PremiumPlansAdminPage />
    </MemoryRouter>,
  );
}

describe("PremiumPlansAdminPage (F5)", () => {
  it("previsualiza el desglose y guarda una versión nueva", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByLabelText("Precio final (COP)")).toHaveValue(10000);
    await user.click(screen.getByRole("button", { name: "Previsualizar" }));

    await waitFor(() =>
      expect(premiumApi.previewPlanQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          amountCents: 1000000,
          taxRateBps: 1900,
          mpFeeBps: 329,
          mpFeeFixedCents: 80000,
        }),
      ),
    );
    expect(await screen.findByText("Neto FAROX")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar y crear versión" }));
    await waitFor(() =>
      expect(premiumApi.updatePlanPricing).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "premium_monthly",
          amountCents: 1000000,
          feePassedToCustomer: false,
          active: true,
        }),
      ),
    );
    expect(await screen.findByText(/Se creó la versión 2/)).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });
});
