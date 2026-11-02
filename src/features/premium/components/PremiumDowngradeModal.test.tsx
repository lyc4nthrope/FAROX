import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import * as premiumApi from "../api";
import type { OwnedStore, PremiumStatus } from "../types";
import { PremiumDowngradeModal } from "./PremiumDowngradeModal";

vi.mock("../api", () => ({
  fetchMyPremiumStatus: vi.fn(),
  fetchMyOwnedStores: vi.fn(),
  chooseStoreForFreePlan: vi.fn(),
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
    isActive: true,
    deactivatedReason: null,
  },
  {
    id: 3,
    name: "Tienda Sur",
    city: "Cali",
    createdAt: "2026-03-10T12:00:00Z",
    isActive: true,
    deactivatedReason: null,
  },
];

const GRACE: PremiumStatus = {
  premium: false,
  premiumUntil: null,
  premiumGraceUntil: "2026-11-08T12:00:00Z",
  graceActive: true,
  needsStoreChoice: false,
  activeOwnedStores: 3,
};

function renderModal(role: RoleName = "operador", path = "/inicio") {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <PremiumDowngradeModal />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  vi.mocked(premiumApi.fetchMyPremiumStatus).mockResolvedValue({ data: GRACE, error: null });
  vi.mocked(premiumApi.fetchMyOwnedStores).mockResolvedValue({ data: STORES, error: null });
  vi.mocked(premiumApi.chooseStoreForFreePlan).mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
});

describe("PremiumDowngradeModal (0033)", () => {
  it("muestra las 3 tiendas y permite conservar una", async () => {
    const user = userEvent.setup();
    renderModal();

    expect(await screen.findByText("Tu Premium venció")).toBeInTheDocument();
    expect(screen.getByText("Tienda Centro")).toBeInTheDocument();
    expect(screen.getByText("Tienda Norte")).toBeInTheDocument();
    expect(screen.getByText("Tienda Sur")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Renovar Premium" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decidir después" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Tienda Norte/ }));
    await user.click(screen.getByRole("button", { name: "Conservar esta tienda" }));

    await waitFor(() =>
      expect(premiumApi.chooseStoreForFreePlan).toHaveBeenCalledWith(2),
    );
  });

  it("después de la gracia es bloqueante: sin cerrar ni posponer", async () => {
    vi.mocked(premiumApi.fetchMyPremiumStatus).mockResolvedValue({
      data: { ...GRACE, graceActive: false, needsStoreChoice: true },
      error: null,
    });
    renderModal();

    expect(await screen.findByText("Tu Premium venció")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cerrar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decidir después" })).not.toBeInTheDocument();
    expect(screen.getByText(/La gracia terminó/)).toBeInTheDocument();
  });

  it("no aparece para admin ni distribuidor", async () => {
    renderModal("admin");
    expect(screen.queryByText("Tu Premium venció")).not.toBeInTheDocument();

    cleanup();
    renderModal("distribuidor");
    expect(screen.queryByText("Tu Premium venció")).not.toBeInTheDocument();
  });

  it("no se superpone en /premium", async () => {
    renderModal("operador", "/premium");

    await waitFor(() => expect(premiumApi.fetchMyPremiumStatus).not.toHaveBeenCalled());
    expect(screen.queryByText("Tu Premium venció")).not.toBeInTheDocument();
  });
});
