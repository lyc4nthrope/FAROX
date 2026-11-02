import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as premiumApi from "../api";
import type { PremiumStatus } from "../types";
import { PremiumStatusCard } from "./PremiumStatusCard";

vi.mock("../api", () => ({
  fetchMyPremiumStatus: vi.fn(),
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
});

afterEach(() => {
  cleanup();
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
