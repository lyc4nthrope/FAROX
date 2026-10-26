import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as productsApi from "../api";
import type { CatalogEntry } from "../types";
import { StoreCatalogPanel } from "./StoreCatalogPanel";

vi.mock("../api", () => ({
  fetchProductCategories: vi.fn(),
  fetchStoreCatalog: vi.fn(),
  removeStoreProduct: vi.fn(),
  setStoreProductQuantity: vi.fn(),
  setStoreProductShortage: vi.fn(),
  setStoreProductThreshold: vi.fn(),
  // AddProductsPanel (montado dentro del modal) usa estas.
  fetchActiveProductsForCatalog: vi.fn(),
  addStoreCatalogProduct: vi.fn(),
  addDistributorCatalogProduct: vi.fn(),
  createProduct: vi.fn(),
  fetchBrands: vi.fn(),
  fetchUnitTypes: vi.fn(),
}));

const ROW: CatalogEntry = {
  id: 1,
  name: "Arroz Diana",
  is_active: true,
  brand: { id: 3, name: "Diana" },
  unit: { id: 1, name: "kg" },
  category: { id: 2, name: "Granos" },
  quantity: 12,
  threshold: 5,
  expiry_date: "2026-12-31",
  is_shortage: false,
};

function renderPanel() {
  return render(<StoreCatalogPanel storeId={10} storeName="Tienda Centro" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(productsApi.fetchProductCategories).mockResolvedValue({
    rows: [{ id: 2, name: "Granos" }],
    error: null,
  });
  vi.mocked(productsApi.fetchStoreCatalog).mockResolvedValue({
    rows: [ROW],
    count: 1,
    error: null,
  });
  vi.mocked(productsApi.setStoreProductQuantity).mockResolvedValue({ error: null });
  vi.mocked(productsApi.setStoreProductThreshold).mockResolvedValue({ error: null });
  vi.mocked(productsApi.setStoreProductShortage).mockResolvedValue({ error: null });
  vi.mocked(productsApi.removeStoreProduct).mockResolvedValue({ error: null });
  vi.mocked(productsApi.fetchActiveProductsForCatalog).mockResolvedValue({
    rows: [],
    count: 0,
    error: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("StoreCatalogPanel · catálogo y asignación de la tienda", () => {
  it("lista el stock con cantidad, umbral, vencimiento y estado", async () => {
    renderPanel();

    expect(await screen.findByText("Arroz Diana")).toBeInTheDocument();
    expect(screen.getByText("Diana")).toBeInTheDocument();
    expect(screen.getByLabelText("Cantidad de Arroz Diana")).toHaveValue(12);
    expect(screen.getByLabelText("Umbral de Arroz Diana")).toHaveValue(5);
    expect(screen.getByText("2026-12-31")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(productsApi.fetchStoreCatalog).toHaveBeenCalledWith(10, {
      page: 0,
      pageSize: 25,
      q: "",
      categoryId: null,
      onlyShortage: false,
    });
  });

  it("guarda la cantidad editada sin registrar un movimiento", async () => {
    renderPanel();
    const user = userEvent.setup();

    const input = await screen.findByLabelText("Cantidad de Arroz Diana");
    await user.clear(input);
    await user.type(input, "20");
    await user.click(within(input.parentElement as HTMLElement).getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(productsApi.setStoreProductQuantity).toHaveBeenCalledWith(10, 1, 20),
    );
    expect(await screen.findByText('Cantidad de "Arroz Diana" actualizada.')).toBeInTheDocument();
  });

  it("guarda y limpia el umbral con set_stock_threshold", async () => {
    renderPanel();
    const user = userEvent.setup();

    const input = await screen.findByLabelText("Umbral de Arroz Diana");
    await user.clear(input);
    await user.click(within(input.parentElement as HTMLElement).getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(productsApi.setStoreProductThreshold).toHaveBeenCalledWith(10, 1, null),
    );
  });

  it("marca el faltante del producto", async () => {
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Marcar faltante" }));

    await waitFor(() =>
      expect(productsApi.setStoreProductShortage).toHaveBeenCalledWith(10, 1, true),
    );
  });

  it("quita el producto con doble confirmación cuando hay stock", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Quitar" }));

    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(productsApi.removeStoreProduct).toHaveBeenCalledWith(10, 1, true),
    );
    confirm.mockRestore();
  });

  it("filtra por nombre en el servidor con debounce", async () => {
    renderPanel();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Buscar en la tienda"), "arroz");

    await waitFor(
      () =>
        expect(productsApi.fetchStoreCatalog).toHaveBeenLastCalledWith(10, {
          page: 0,
          pageSize: 25,
          q: "arroz",
          categoryId: null,
          onlyShortage: false,
        }),
      { timeout: 1500 },
    );
  });

  it("abre el alta de productos del registro en un diálogo", async () => {
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Agregar productos" }));

    expect(
      await screen.findByRole("dialog", { name: "Agregar productos a la tienda" }),
    ).toBeInTheDocument();
  });

  it("sin filas explica que la tienda no tiene productos asignados", async () => {
    vi.mocked(productsApi.fetchStoreCatalog).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    renderPanel();

    expect(await screen.findByText("La tienda no tiene productos asignados")).toBeInTheDocument();
  });
});
