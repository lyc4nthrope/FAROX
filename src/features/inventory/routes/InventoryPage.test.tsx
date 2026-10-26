import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import * as inventoryApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { InventoryPage } from "./InventoryPage";

vi.mock("../api", () => ({
  assignProduct: vi.fn(),
  fetchActiveProducts: vi.fn(),
  fetchMotives: vi.fn(),
  fetchMovements: vi.fn(),
  fetchMyStores: vi.fn(),
  fetchPrices: vi.fn(),
  fetchStock: vi.fn(),
  fetchStoreName: vi.fn(),
  registerMovement: vi.fn(),
  reverseMovement: vi.fn(),
  setPrice: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const EMPTY_MOVEMENTS = "Todavía no hay movimientos en esta tienda";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/inventario/10"]}>
      <AuthProvider>
        <Routes>
          <Route path="/inventario/:storeId" element={<InventoryPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "admin", premium: true });
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  vi.mocked(inventoryApi.fetchStoreName).mockResolvedValue({ data: "Prueba1", error: null });
  vi.mocked(inventoryApi.fetchStock).mockResolvedValue({ data: [], error: null });
  vi.mocked(inventoryApi.fetchPrices).mockResolvedValue({ data: [], error: null });
  vi.mocked(inventoryApi.fetchActiveProducts).mockResolvedValue({ data: [], error: null });
  vi.mocked(inventoryApi.fetchMotives).mockResolvedValue({ data: [], error: null });
  vi.mocked(inventoryApi.fetchMovements).mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  cleanup();
});

describe("InventoryPage · últimos movimientos", () => {
  // Sin movimientos la tabla quedaba solo con encabezados y parecía rota.
  it("sin movimientos: muestra el estado vacío en lugar de una tabla sin filas", async () => {
    renderPage();

    expect(await screen.findByText(EMPTY_MOVEMENTS)).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Motivo" })).not.toBeInTheDocument();
  });

  it("con movimientos: muestra la tabla y no el estado vacío", async () => {
    vi.mocked(inventoryApi.fetchMovements).mockResolvedValue({
      data: [
        {
          id: 1,
          type: "entry",
          quantity: 5,
          created_at: "2026-10-26T12:00:00Z",
          reverso_of_id: null,
          product_name: "Arroz Diana 500 g",
          motive_name: "Compra",
        },
      ],
      error: null,
    });
    renderPage();

    expect(await screen.findByText("Arroz Diana 500 g")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_MOVEMENTS)).not.toBeInTheDocument();
  });
});
