import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as productsApi from "../api";
import type { CatalogEntry } from "../types";
import { StoreCatalogPanel } from "./StoreCatalogPanel";

vi.mock("../api", () => ({
  fetchProductCategories: vi.fn(),
  fetchStoreCatalog: vi.fn(),
  fetchDistributorCatalog: vi.fn(),
  removeStoreProduct: vi.fn(),
  removeDistributorCatalogProduct: vi.fn(),
  setStoreProductShortage: vi.fn(),
  updateStoreProduct: vi.fn(),
  fetchActiveProductsForCatalog: vi.fn(),
  addStoreProduct: vi.fn(),
  addDistributorCatalogProduct: vi.fn(),
  createProduct: vi.fn(),
  fetchBrands: vi.fn(),
  fetchUnitTypes: vi.fn(),
  fetchStoreStock: vi.fn(),
  fetchDistributorProductIds: vi.fn(),
}));

const ROW: CatalogEntry = {
  id: 1,
  name: "Arroz Diana",
  is_active: true,
  brand: { id: 3, name: "Diana" },
  unit: { id: 1, name: "kg" },
  category: { id: 2, name: "Granos" },
  quantity: null,
  threshold: null,
  expiry_date: null,
  is_shortage: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(productsApi.fetchProductCategories).mockResolvedValue({
    rows: [{ id: 2, name: "Granos" }],
    error: null,
  });
  vi.mocked(productsApi.fetchDistributorCatalog).mockResolvedValue({
    rows: [ROW],
    count: 1,
    error: null,
  });
  vi.mocked(productsApi.removeDistributorCatalogProduct).mockResolvedValue({ error: null });
  vi.mocked(productsApi.fetchActiveProductsForCatalog).mockResolvedValue({
    rows: [],
    count: 0,
    error: null,
  });
  vi.mocked(productsApi.fetchDistributorProductIds).mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  cleanup();
});

function renderPanel() {
  return render(
    <MemoryRouter>
      <StoreCatalogPanel kind="distribuidor" storeId={0} storeName="mi distribuidora" />
    </MemoryRouter>,
  );
}

describe("StoreCatalogPanel · modo distribuidor (S15)", () => {
  it("reutiliza el panel sin columnas de stock y con el estado En catálogo", async () => {
    renderPanel();

    expect(await screen.findByText("Arroz Diana")).toBeInTheDocument();
    expect(screen.getByText("En catálogo")).toBeInTheDocument();
    for (const header of ["Cantidad", "Umbral", "Vence", "Precio de venta"]) {
      expect(screen.queryByRole("columnheader", { name: header })).not.toBeInTheDocument();
    }
    expect(screen.getByLabelText("Buscar en el catálogo")).toBeInTheDocument();
    expect(productsApi.fetchDistributorCatalog).toHaveBeenCalledWith({
      page: 0,
      pageSize: 25,
      q: "",
      categoryId: null,
      onlyShortage: false,
    });
  });

  it("ofrece Editar hacia el formulario del producto", async () => {
    renderPanel();

    await screen.findByText("Arroz Diana");
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute("href", "/products/1");
  });

  it("filtra por categoría y quita con la RPC del distribuidor", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText("Arroz Diana");
    await user.selectOptions(screen.getByLabelText("Categoría"), "2");
    await waitFor(() =>
      expect(productsApi.fetchDistributorCatalog).toHaveBeenLastCalledWith(
        expect.objectContaining({ categoryId: 2 }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Quitar" }));
    await waitFor(() =>
      expect(productsApi.removeDistributorCatalogProduct).toHaveBeenCalledWith(1),
    );
    confirm.mockRestore();
  });
});
