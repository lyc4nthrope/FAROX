import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as premiumApi from "../api";
import type { PremiumStatus } from "../types";
import { PremiumResultPage } from "./PremiumResultPage";

const mocks = vi.hoisted(() => ({ refreshPrivileges: vi.fn() }));

vi.mock("../api", () => ({
  fetchMyPremiumStatus: vi.fn(),
}));
vi.mock("../../../app/providers/AuthProvider", () => ({
  useAuth: () => ({ refreshPrivileges: mocks.refreshPrivileges }),
}));

const FREE: PremiumStatus = {
  premium: false,
  premiumUntil: null,
  premiumGraceUntil: null,
  graceActive: false,
  needsStoreChoice: false,
  activeOwnedStores: 1,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <PremiumResultPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(premiumApi.fetchMyPremiumStatus).mockResolvedValue({ data: FREE, error: null });
});

afterEach(() => {
  cleanup();
});

describe("PremiumResultPage (F4)", () => {
  it("si el webhook todavía no activó muestra pago pendiente", async () => {
    renderPage();

    expect(await screen.findByText("Pago pendiente de confirmación.")).toBeInTheDocument();
    expect(mocks.refreshPrivileges).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Actualizar estado" })).toBeInTheDocument();
  });

  it("si el pago se aprobó muestra Premium y la fecha", async () => {
    vi.mocked(premiumApi.fetchMyPremiumStatus).mockResolvedValue({
      data: { ...FREE, premium: true, premiumUntil: "2026-12-31T12:00:00Z" },
      error: null,
    });

    renderPage();

    expect(await screen.findByText("Premium activo.")).toBeInTheDocument();
    expect(screen.getByText(/Tenés acceso hasta el/)).toBeInTheDocument();
    expect(screen.queryByText("Pago pendiente de confirmación.")).not.toBeInTheDocument();
  });
});
