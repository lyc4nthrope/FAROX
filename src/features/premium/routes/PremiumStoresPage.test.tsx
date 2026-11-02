import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import * as premiumApi from "../api";
import type { OwnedStore } from "../types";
import { PremiumStoresPage } from "./PremiumStoresPage";

vi.mock("../api", () => ({
  fetchMyOwnedStores: vi.fn(),
  chooseStoreForFreePlan: vi.fn(),
  reactivatePremiumStores: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const STORES: OwnedStore[] = [
  {
    id: 1,
    name: "Tienda Centro",
    city: "Bogotá",
    createdAt: "2026-01-10T12:00:00Z",
    isActive: true,
    deactivatedReason: null,
  },
  {
    id: 2,
    name: "Tienda Norte",
    city: "Medellín",
    createdAt: "2026-02-10T12:00:00Z",
    isActive: false,
    deactivatedReason: "premium_expired",
  },
  {
    id: 3,
    name: "Tienda Sur",
    city: "Cali",
    createdAt: "2026-03-10T12:00:00Z",
    isActive: false,
    deactivatedReason: "premium_expired",
  },
];

function renderPage(premium: boolean) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "operador", premium });
  return render(
    <MemoryRouter>
      <AuthProvider>
        <PremiumStoresPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  vi.mocked(premiumApi.fetchMyOwnedStores).mockResolvedValue({ data: STORES, error: null });
  vi.mocked(premiumApi.chooseStoreForFreePlan).mockResolvedValue({ error: null });
  vi.mocked(premiumApi.reactivatePremiumStores).mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
});

describe("PremiumStoresPage (0033)", () => {
  it("Premium ve las pausadas y las reactiva", async () => {
    const user = userEvent.setup();
    renderPage(true);

    expect(await screen.findByText("Tienda Centro")).toBeInTheDocument();
    expect(screen.getAllByText("Pausada por plan").length).toBe(2);
    expect(screen.queryByText("Renovar para reactivar")).not.toBeInTheDocument();

    const reactivate = screen.getAllByRole("button", { name: "Reactivar" })[0];
    await user.click(reactivate);

    await waitFor(() =>
      expect(premiumApi.reactivatePremiumStores).toHaveBeenCalledWith([2]),
    );
    expect(await screen.findByText("Tienda reactivada.")).toBeInTheDocument();
  });

  it("sin Premium permite elegir la tienda principal desde la página", async () => {
    vi.mocked(premiumApi.fetchMyOwnedStores).mockResolvedValue({
      data: [STORES[0], { ...STORES[1], isActive: true, deactivatedReason: null }, { ...STORES[2], isActive: true, deactivatedReason: null }],
      error: null,
    });
    const user = userEvent.setup();
    renderPage(false);

    expect(await screen.findByText("Elegí tu tienda principal")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Tienda Norte" }));
    await user.click(screen.getByRole("button", { name: "Conservar esta tienda" }));

    await waitFor(() =>
      expect(premiumApi.chooseStoreForFreePlan).toHaveBeenCalledWith(2),
    );
  });

  it("sin Premium muestra la principal y el enlace para renovar", async () => {
    renderPage(false);

    expect(await screen.findByText("Tienda Centro")).toBeInTheDocument();
    expect(screen.getByText("Principal")).toBeInTheDocument();
    expect(screen.getAllByText("Renovar para reactivar").length).toBe(2);
    expect(screen.queryByRole("button", { name: "Reactivar" })).not.toBeInTheDocument();
    expect(screen.getByText(/2 tiendas pausadas/)).toBeInTheDocument();
  });
});
