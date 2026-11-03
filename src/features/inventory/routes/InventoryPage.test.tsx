import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import * as productsApi from "../../products/api";
import * as inventoryApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { InventoryPage } from "./InventoryPage";

vi.mock("../api", () => ({
  fetchMotives: vi.fn(),
  fetchMovements: vi.fn(),
  fetchMyStores: vi.fn(),
  fetchPrices: vi.fn(),
  fetchStockOptions: vi.fn(),
  fetchStoreName: vi.fn(),
  registerMovement: vi.fn(),
  registerMovementsBulk: vi.fn(),
  fetchMovementTemplates: vi.fn(),
  saveMovementTemplate: vi.fn(),
  deleteMovementTemplate: vi.fn(),
  reverseMovement: vi.fn(),
  setPrice: vi.fn(),
}));
// El catálogo/asignación se prueba en StoreCatalogPanel.test: acá solo importa
// que Inventario componga la pestaña «Productos».
vi.mock("../../products/components/StoreCatalogPanel", () => ({
  StoreCatalogPanel: () => <p>Panel de productos de la tienda</p>,
}));
vi.mock("../../products/api", () => ({
  fetchStorePurchasePrices: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const EMPTY_MOVEMENTS = "Todavía no hay movimientos en esta tienda";

const ENTRY_MOVEMENT = {
  id: 1,
  type: "entry" as const,
  quantity: 5,
  created_at: "2026-10-26T12:00:00Z",
  reverso_of_id: null,
  product_name: "Arroz Diana 500 g",
  motive_name: "Compra",
};

const EXIT_MOVEMENT = {
  id: 2,
  type: "exit" as const,
  quantity: 2,
  created_at: "2026-10-26T13:00:00Z",
  reverso_of_id: null,
  product_name: "Leche Alpina 1 L",
  motive_name: "Venta",
};

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
  vi.mocked(inventoryApi.fetchStockOptions).mockResolvedValue({ data: [], error: null });
  vi.mocked(inventoryApi.fetchPrices).mockResolvedValue({ data: [], error: null });
  vi.mocked(productsApi.fetchStorePurchasePrices).mockResolvedValue({
    data: new Map<number, number>(),
    error: null,
  });
  vi.mocked(inventoryApi.fetchMovementTemplates).mockResolvedValue({
    data: [],
    error: null,
  });
  vi.mocked(inventoryApi.fetchMotives).mockResolvedValue({ data: [], error: null });
  vi.mocked(inventoryApi.fetchMovements).mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  cleanup();
});

describe("InventoryPage · pestaña Productos (0024)", () => {
  it("es la pestaña inicial y compone el catálogo de la tienda", async () => {
    renderPage();

    expect(await screen.findByText("Panel de productos de la tienda")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Productos" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Asignar producto" })).not.toBeInTheDocument();
  });
});

describe("InventoryPage · pestañas", () => {
  it("muestra los movimientos como lista con tono por tipo", async () => {
    vi.mocked(inventoryApi.fetchMovements).mockResolvedValue({
      data: [ENTRY_MOVEMENT, EXIT_MOVEMENT],
      error: null,
    });

    renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /movimientos/i }));

    expect(await screen.findByText("Arroz Diana 500 g")).toBeInTheDocument();
    const items = within(screen.getByRole("tabpanel")).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-tone", "entry");
    expect(items[1]).toHaveAttribute("data-tone", "exit");
  });

  it("sin movimientos: muestra el estado vacío en lugar de una lista vacía", async () => {
    renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /movimientos/i }));

    expect(await screen.findByText(EMPTY_MOVEMENTS)).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("precios en su propia pestaña y el alta abre un diálogo", async () => {
    vi.mocked(inventoryApi.fetchPrices).mockResolvedValue({
      data: [{ product_id: 1, product_name: "Arroz Diana 500 g", price: 2500, currency: "COP" }],
      error: null,
    });

    renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /precios/i }));

    expect(await screen.findByText("Arroz Diana 500 g")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publicar precio" }));

    expect(await screen.findByRole("dialog", { name: "Publicar precio" })).toBeInTheDocument();
  });
});

describe("InventoryPage · acciones en botones", () => {
  it("registrar movimiento abre el ticket de compra en un diálogo", async () => {
    renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /registrar movimiento/i }));

    const dialog = await screen.findByRole("dialog", {
      name: "Registrar compra",
    });
    expect(within(dialog).getByLabelText("Buscar producto o código")).toBeInTheDocument();
  });

  it("la compra se busca por marca y se registra como ticket", async () => {
    vi.mocked(inventoryApi.fetchStockOptions).mockResolvedValue({
      data: [
        { product_id: 1, product_name: "Arroz Diana", brand: "Diana", quantity: 12 },
        { product_id: 2, product_name: "Leche Alpina", brand: "Alpina", quantity: 30 },
      ],
      error: null,
    });
    vi.mocked(inventoryApi.fetchMotives).mockResolvedValue({
      data: [{ id: 1, name: "Compra", suggested_type: "entry" }],
      error: null,
    });
    vi.mocked(inventoryApi.registerMovementsBulk).mockResolvedValue({ error: null });

    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /registrar movimiento/i }));
    const dialog = await screen.findByRole("dialog", {
      name: "Registrar compra",
    });

    await user.type(within(dialog).getByLabelText("Buscar producto o código"), "alpina");
    expect(within(dialog).queryByRole("button", { name: /Arroz Diana/ })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /Leche Alpina/ }));
    await user.click(
      within(dialog).getByRole("button", { name: "Sumar cantidad de Leche Alpina" }),
    );
    await user.type(within(dialog).getByLabelText("Precio de compra de Leche Alpina"), "4500");
    await user.selectOptions(within(dialog).getByLabelText("Motivo"), "1");
    await user.click(within(dialog).getByRole("button", { name: "Registrar compra" }));

    await waitFor(() =>
      expect(inventoryApi.registerMovementsBulk).toHaveBeenCalledWith({
        storeId: 10,
        type: "entry",
        motiveId: 1,
        lines: [{ productId: 2, quantity: 2, unitPrice: 4500, expiryDate: null }],
        discountPct: null,
      }),
    );
  });

  it("prellena el precio de compra de la relación y muestra el total del ticket (0030)", async () => {
    vi.mocked(inventoryApi.fetchStockOptions).mockResolvedValue({
      data: [
        {
          product_id: 2,
          product_name: "Leche Alpina",
          brand: "Alpina",
          quantity: 30,
        },
      ],
      error: null,
    });
    vi.mocked(productsApi.fetchStorePurchasePrices).mockResolvedValue({
      data: new Map([[2, 4500]]),
      error: null,
    });
    vi.mocked(inventoryApi.fetchMotives).mockResolvedValue({
      data: [{ id: 1, name: "Compra", suggested_type: "entry" }],
      error: null,
    });

    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /registrar movimiento/i }));
    const dialog = await screen.findByRole("dialog", {
      name: "Registrar compra",
    });

    await user.type(within(dialog).getByLabelText("Buscar producto o código"), "alpina");
    await user.click(within(dialog).getByRole("button", { name: /Leche Alpina/ }));
    await user.click(
      within(dialog).getByRole("button", { name: "Sumar cantidad de Leche Alpina" }),
    );

    expect(within(dialog).getByLabelText("Precio de compra de Leche Alpina")).toHaveValue(4500);
    expect(dialog).toHaveTextContent("9.000");
  });

  it("en una venta prellena el precio activo y aplica el descuento al neto (0037)", async () => {
    vi.mocked(inventoryApi.fetchStockOptions).mockResolvedValue({
      data: [{ product_id: 2, product_name: "Leche Alpina", brand: "Alpina", quantity: 30 }],
      error: null,
    });
    vi.mocked(inventoryApi.fetchPrices).mockResolvedValue({
      data: [{ product_id: 2, product_name: "Leche Alpina", price: 3000, currency: "COP" }],
      error: null,
    });
    vi.mocked(inventoryApi.fetchMotives).mockResolvedValue({
      data: [{ id: 2, name: "Venta", suggested_type: "exit" }],
      error: null,
    });
    vi.mocked(inventoryApi.registerMovementsBulk).mockResolvedValue({ error: null });

    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /movimientos/i }));
    await user.click(await screen.findByRole("button", { name: "Registrar venta" }));
    const dialog = await screen.findByRole("dialog", { name: "Registrar venta" });

    await user.type(within(dialog).getByLabelText("Buscar producto o código"), "alpina");
    await user.click(within(dialog).getByRole("button", { name: /Leche Alpina/ }));
    expect(within(dialog).getByLabelText("Precio de venta de Leche Alpina")).toHaveValue(3000);

    await user.type(within(dialog).getByLabelText("Descuento (%)"), "10");
    expect(dialog).toHaveTextContent("2.700");
    expect(dialog).toHaveTextContent("1 producto");
    expect(dialog).toHaveTextContent("ahorrás");

    await user.selectOptions(within(dialog).getByLabelText("Motivo"), "2");
    await user.click(within(dialog).getByRole("button", { name: "Registrar venta" }));

    await waitFor(() =>
      expect(inventoryApi.registerMovementsBulk).toHaveBeenCalledWith({
        storeId: 10,
        type: "exit",
        motiveId: 2,
        lines: [{ productId: 2, quantity: 1, unitPrice: 2700, expiryDate: null }],
        discountPct: 10,
      }),
    );
  });

  it("sin premium: el mismo botón explica el candado en vez de esconderlo", async () => {
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "admin", premium: false });

    renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /registrar movimiento/i }));

    expect(await screen.findByText("Función Premium")).toBeInTheDocument();
  });
});
