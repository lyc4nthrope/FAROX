import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as premiumApi from "../api";
import type { AdminPaymentRow, AdminSubscriptionRow } from "../types";
import { PremiumPaymentsAdminPage } from "./PremiumPaymentsAdminPage";

vi.mock("../api", () => ({
  fetchAdminSubscriptions: vi.fn(),
  fetchAdminPayments: vi.fn(),
  adminCancelSubscription: vi.fn(),
  adminRefundPayment: vi.fn(),
  reconcileSubscriptions: vi.fn(),
}));

const SUBSCRIPTION: AdminSubscriptionRow = {
  id: 7,
  userId: "u1",
  userName: "Ada Lovelace",
  userEmail: "ada@farox.app",
  planCode: "premium_monthly",
  planName: "Premium mensual",
  status: "authorized",
  priceCents: 1000000,
  currency: "COP",
  currentPeriodEnd: "2026-12-31T12:00:00Z",
  cancelAtPeriodEnd: false,
  createdAt: "2026-11-01T12:00:00Z",
  providerSubscriptionId: "2c938084726fca480172750000000000",
};

const PAYMENT: AdminPaymentRow = {
  id: 11,
  userId: "u1",
  userName: "Ada Lovelace",
  userEmail: "ada@farox.app",
  planCode: "premium_monthly",
  planName: "Premium mensual",
  status: "approved",
  amountCents: 1000000,
  currency: "COP",
  providerPaymentId: "999",
  paidAt: "2026-11-01T12:00:00Z",
  createdAt: "2026-11-01T12:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(premiumApi.fetchAdminSubscriptions).mockResolvedValue({
    data: [SUBSCRIPTION],
    error: null,
  });
  vi.mocked(premiumApi.fetchAdminPayments).mockResolvedValue({ data: [PAYMENT], error: null });
  vi.mocked(premiumApi.adminCancelSubscription).mockResolvedValue({ error: null });
  vi.mocked(premiumApi.adminRefundPayment).mockResolvedValue({ error: null });
  vi.mocked(premiumApi.reconcileSubscriptions).mockResolvedValue({
    result: { checkedSubscriptions: 1, checkedPayments: 1, updated: 2 },
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <PremiumPaymentsAdminPage />
    </MemoryRouter>,
  );
}

describe("PremiumPaymentsAdminPage (F5)", () => {
  it("cancela una suscripción y reembolsa un pago con confirmación", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    expect((await screen.findAllByText("Ada Lovelace")).length).toBeGreaterThanOrEqual(2);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(premiumApi.adminCancelSubscription).toHaveBeenCalledWith(7));
    expect(
      await screen.findByText("Suscripción cancelada. El acceso sigue hasta el fin del período."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reembolsar" }));
    await waitFor(() => expect(premiumApi.adminRefundPayment).toHaveBeenCalledWith(11));
    expect(await screen.findByText("Pago reembolsado en Mercado Pago.")).toBeInTheDocument();
  });

  it("permite cargar más de 50 suscripciones", async () => {
    const many = Array.from({ length: 50 }, (_, index) => ({
      ...SUBSCRIPTION,
      id: index + 1,
      userName: `Usuario ${index + 1}`,
    }));
    vi.mocked(premiumApi.fetchAdminSubscriptions).mockResolvedValue({
      data: many,
      error: null,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Cargar más suscripciones" }),
    );

    await waitFor(() =>
      expect(premiumApi.fetchAdminSubscriptions).toHaveBeenLastCalledWith(100),
    );
  });

  it("muestra el resultado de la conciliación", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Conciliar con Mercado Pago" }),
    );

    expect(
      await screen.findByText(/Conciliación: 1 suscripciones, 1 pagos, 2 actualizados/),
    ).toBeInTheDocument();
  });
});
