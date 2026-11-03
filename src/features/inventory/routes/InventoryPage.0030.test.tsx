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
  reverseMovement: vi.fn(),
  setPrice: vi.fn(),
}));
vi.mock("../../products/api", () => ({
  fetchProductCategories: vi.fn(),
  fetchStoreCatalog: vi.fn(),
  fetchStoreRelationPrices: vi.fn(),
  fetchDistributorCatalog: vi.fn(),
  fetchStorePurchasePrices: vi.fn(),
  removeStoreProduct: vi.fn(),
  removeDistributorCatalogProduct: vi.fn(),
  setStoreProductShortage: vi.fn(),
  updateStoreProduct: vi.fn(),
  updateStoreProductFull: vi.fn(),
  updateDistributorProductRelation: vi.fn(),
  fetchActiveProductsForCatalog: vi.fn(),
  fetchBrands: vi.fn(),
  fetchUnitTypes: vi.fn(),
  fetchDistributorProductIds: vi.fn(),
  fetchStoreStock: vi.fn(),
  addStoreProduct: vi.fn(),
  addDistributorCatalogProduct: vi.fn(),
  createProduct: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const ROW = {
  id: 2,
  name: "Leche Alpina",
  is_active: true,
  brand: { id: 1, name: "Alpina" },
  unit: { id: 1, name: "L" },
  category: { id: 1, name: "Lacteos" },
  quantity: 30,
  threshold: null,
  expiry_date: null,
  purchase_price: 1000,
  sale_price: 3000,
  is_shortage: false,
};

const NEW_ROW = {
  id: 3,
  name: "Arroz Diana",
  is_active: true,
  brand: { id: 2, name: "Diana" },
  unit: { id: 1, name: "kg" },
  category: { id: 2, name: "Granos" },
  quantity: 0,
  threshold: null,
  expiry_date: null,
  purchase_price: null,
  sale_price: null,
  is_shortage: false,
};

let added = false;
let purchasePrice = 1000;
let salePrice = 3000;

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
  added = false;
  purchasePrice = 1000;
  salePrice = 3000;
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "admin", premium: true });
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  vi.mocked(inventoryApi.fetchStoreName).mockResolvedValue({ data: "Prueba1", error: null });
  vi.mocked(inventoryApi.fetchStockOptions).mockResolvedValue({
    data: [{ product_id: 2, product_name: "Leche Alpina", brand: "Alpina", quantity: 30 }],
    error: null,
  });
  vi.mocked(inventoryApi.fetchPrices).mockImplementation(async () => ({
    data: [{ product_id: 2, product_name: "Leche Alpina", price: salePrice, currency: "COP" }],
    error: null,
  }));
  vi.mocked(inventoryApi.fetchMotives).mockResolvedValue({
    data: [{ id: 1, name: "Compra", suggested_type: "entry" }],
    error: null,
  });
  vi.mocked(inventoryApi.fetchMovements).mockResolvedValue({ data: [], error: null });
  vi.mocked(productsApi.fetchProductCategories).mockResolvedValue({ rows: [], error: null });
  vi.mocked(productsApi.fetchStoreCatalog).mockImplementation(async () => ({
    rows: added ? [ROW, NEW_ROW] : [ROW],
    count: added ? 2 : 1,
    error: null,
  }));
  vi.mocked(productsApi.fetchStoreRelationPrices).mockImplementation(async () => ({
    data: [
      { product_id: 2, sale_price: salePrice, purchase_price: purchasePrice },
      ...(added ? [{ product_id: 3, sale_price: 2500, purchase_price: null }] : []),
    ],
    error: null,
  }));
  vi.mocked(productsApi.fetchActiveProductsForCatalog).mockResolvedValue({
    rows: [
      {
        id: 3,
        name: "Arroz Diana",
        is_active: true,
        brand: { id: 2, name: "Diana" },
        unit: { id: 1, name: "kg" },
        category: { id: 2, name: "Granos" },
      },
    ],
    count: 1,
    error: null,
  });
  vi.mocked(productsApi.fetchStoreStock).mockResolvedValue({ data: [], error: null });
  vi.mocked(productsApi.fetchDistributorProductIds).mockResolvedValue({ data: [], error: null });
  vi.mocked(productsApi.addStoreProduct).mockImplementation(async () => {
    added = true;
    return { error: null };
  });
  vi.mocked(productsApi.fetchStorePurchasePrices).mockImplementation(async () => ({
    data: new Map([[2, purchasePrice]]),
    error: null,
  }));
  vi.mocked(productsApi.updateStoreProductFull).mockImplementation(
    async (
      _storeId: number,
      _productId: number,
      _quantity: number,
      _threshold: number | null,
      _shortage: boolean | null,
      _expiry: string | null,
      nextPurchase: number | null,
      nextSale: number | null,
    ) => {
      if (nextPurchase !== null) purchasePrice = nextPurchase;
      if (nextSale !== null) salePrice = nextSale;
      return { error: null };
    },
  );
});

afterEach(() => {
  cleanup();
});

describe("0030 · el prellenado refleja el precio recién editado", () => {
  it("entrada: usa el precio de compra actualizado en la relación", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Leche Alpina");
    await user.click(screen.getByRole("button", { name: "Editar" }));
    const edit = await screen.findByRole("dialog", { name: "Editar Leche Alpina" });
    const purchase = within(edit).getByLabelText("Precio de compra (COP)");
    expect(purchase).toHaveValue(1000);
    await user.clear(purchase);
    await user.type(purchase, "2000");
    await user.click(within(edit).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(productsApi.updateStoreProductFull).toHaveBeenCalledWith(
        10, 2, 30, null, false, null, 2000, 3000,
      ),
    );

    await user.click(screen.getByRole("button", { name: /registrar movimiento/i }));
    const movement = await screen.findByRole("dialog", { name: "Registrar compra" });
    await user.type(within(movement).getByLabelText("Buscar producto o código"), "leche");
    await user.click(within(movement).getByRole("button", { name: /Leche Alpina/ }));

    await waitFor(() =>
      expect(within(movement).getByLabelText("Precio de compra de Leche Alpina")).toHaveValue(2000),
    );
  });

  it("salida: usa el precio de venta actualizado en la relación", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Leche Alpina");
    await user.click(screen.getByRole("button", { name: "Editar" }));
    const edit = await screen.findByRole("dialog", { name: "Editar Leche Alpina" });
    const sale = within(edit).getByLabelText("Precio de venta (COP)");
    expect(sale).toHaveValue(3000);
    await user.clear(sale);
    await user.type(sale, "4000");
    await user.click(within(edit).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(productsApi.updateStoreProductFull).toHaveBeenCalledWith(
        10, 2, 30, null, false, null, 1000, 4000,
      ),
    );

    await user.click(screen.getByRole("tab", { name: /movimientos/i }));
    await user.click(await screen.findByRole("button", { name: "Registrar venta" }));
    const movement = await screen.findByRole("dialog", { name: "Registrar venta" });
    await user.type(within(movement).getByLabelText("Buscar producto o código"), "leche");
    await user.click(within(movement).getByRole("button", { name: /Leche Alpina/ }));

    await waitFor(() =>
      expect(within(movement).getByLabelText("Precio de venta de Leche Alpina")).toHaveValue(4000),
    );
  });

  it("alta: el modal muestra el precio de venta recién cargado", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Leche Alpina");
    await user.click(screen.getByRole("button", { name: "Agregar productos" }));
    const add = await screen.findByRole("dialog", { name: "Agregar productos a la tienda" });
    await user.type(within(add).getByLabelText("Precio de venta de Arroz Diana"), "2500");
    const addRow = within(add).getByText("Arroz Diana").closest("tr") as HTMLElement;
    await user.click(within(addRow).getByRole("button", { name: "Agregar" }));
    await waitFor(() =>
      expect(productsApi.addStoreProduct).toHaveBeenCalledWith(10, 3, 0, null, 2500),
    );
    await user.click(within(add).getByRole("button", { name: "Cerrar" }));

    await screen.findByText("Arroz Diana");
    const row = screen.getByText("Arroz Diana").closest("tr") as HTMLElement;
    const editButton = within(row).getByRole("button", { name: "Editar" });
    await waitFor(() => expect(editButton).toBeEnabled());
    await user.click(editButton);
    const edit = await screen.findByRole("dialog", { name: "Editar Arroz Diana" });

    expect(within(edit).getByLabelText("Precio de venta (COP)")).toHaveValue(2500);
  });
});
