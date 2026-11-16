import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as premiumApi from "../api";
import type { PremiumStatus } from "../types";
import { PremiumStatusCard } from "./PremiumStatusCard";

vi.mock("../api", () => ({
  fetchMyPremiumStatus: vi.fn(),
  fetchMySubscription: vi.fn(),
  cancelSubscription: vi.fn(),
}));

const FREE: PremiumStatus = {
  premium: false,
  premiumUntil: null,
  premiumGraceUntil: null,
  graceActive: false,
  needsStoreChoice: false,
  activeOwnedStores: 1,
};

function renderCard() {
  return render(
    <MemoryRouter>
      <PremiumStatusCard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(premiumApi.fetchMySubscription).mockResolvedValue({ data: null, error: null });
  vi.mocked(premiumApi.cancelSubscription).mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PremiumStatusCard (0032)", () => {
  it("muestra el plan gratuito", async () => {
    vi.mocked(premiumApi.fetchMyPremiumStatus).mockResolvedValue({ data: FREE, error: null });

    renderCard();

    expect(await screen.findByText("Plan gratuito")).toBeInTheDocument();
    expect(screen.getByText("Gratis")).toBeInTheDocument();
  });

  it("muestra Premium hasta la fecha", async () => {
    vi.mocked(premiumApi.fetchMyPremiumStatus).mockResolvedValue({
      data: {
        ...FREE,
        premium: true,
        premiumUntil: "2026-12-31T12:00:00Z",
      },
      error: null,
    });

    renderCard();

    expect(await screen.findByText("Premium")).toBeInTheDocument();
    expect(screen.getByText(/Activo hasta el/)).toBeInTheDocument();
  });

  it("muestra el grant manual sin vencimiento", async () => {
    vi.mocked(premiumApi.fetchMyPremiumStatus).mockResolvedValue({
      data: { ...FREE, premium: true },
      error: null,
    });

    renderCard();

    expect(await screen.findByText(/Grant manual/)).toBeInTheDocument();
  });

  it("avisa la gracia y la elección de tienda", async () => {
    vi.mocked(premiumApi.fetchMyPremiumStatus).mockResolvedValue({
      data: {
        ...FREE,
        premiumGraceUntil: "2026-11-08T12:00:00Z",
        graceActive: true,
        needsStoreChoice: true,
        activeOwnedStores: 3,
      },
      error: null,
    });

    renderCard();

    expect(await screen.findByText(/Tu Premium venció/)).toBeInTheDocument();
    expect(screen.getByText(/elegir una tienda principal/)).toBeInTheDocument();
  });

  it("muestra la suscripción activa y permite cancelar la renovación", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(premiumApi.fetchMyPremiumStatus).mockResolvedValue({
      data: { ...FREE, premium: true, premiumUntil: "2026-12-31T12:00:00Z" },
      error: null,
    });
    vi.mocked(premiumApi.fetchMySubscription).mockResolvedValue({
      data: {
        id: 1,
        status: "authorized",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: "2026-12-31T12:00:00Z",
        planCode: "premium_monthly",
        planName: "Premium mensual",
      },
      error: null,
    });

    renderCard();

    expect(
      await screen.findByText("Renovación automática activa con Mercado Pago."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancelar suscripción" }));

    await waitFor(() => expect(premiumApi.cancelSubscription).toHaveBeenCalled());
    expect(
      await screen.findByText("Renovación cancelada. El acceso sigue hasta el final del período."),
    ).toBeInTheDocument();
  });

  it("una suscripción cancelada no ofrece cancelar de nuevo", async () => {
    vi.mocked(premiumApi.fetchMyPremiumStatus).mockResolvedValue({
      data: { ...FREE, premium: true, premiumUntil: "2026-12-31T12:00:00Z" },
      error: null,
    });
    vi.mocked(premiumApi.fetchMySubscription).mockResolvedValue({
      data: {
        id: 1,
        status: "cancelled",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: "2026-12-31T12:00:00Z",
        planCode: "premium_monthly",
        planName: "Premium mensual",
      },
      error: null,
    });

    renderCard();

    expect(
      await screen.findByText(
        "Renovación cancelada. El acceso sigue hasta el final del período pagado.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar suscripción" })).not.toBeInTheDocument();
  });

  it("muestra un error amigable", async () => {
    vi.mocked(premiumApi.fetchMyPremiumStatus).mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });

    renderCard();

    expect(await screen.findByText(/Ocurrió un error inesperado/)).toBeInTheDocument();
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });
});
