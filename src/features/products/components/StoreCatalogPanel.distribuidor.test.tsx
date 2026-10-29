import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as productsApi from "../api";
import type { CatalogEntry } from "../types";
import { StoreCatalogPanel } from "./StoreCatalogPanel";

vi.mock("../api", () => ({
  fetchProductCategories: vi.fn(),
  fetchStoreCatalog: vi.fn(),
  fetchStoreRelationPrices: vi.fn(),
  fetchDistributorCatalog: vi.fn(),
  removeStoreProduct: vi.fn(),
  removeDistributorCatalogProduct: vi.fn(),
  setStoreProductShortage: vi.fn(),
  updateStoreProduct: vi.fn(),
  updateStoreProductFull: vi.fn(),
  updateDistributorProductRelation: vi.fn(),
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
  quantity: 4,
  threshold: null,
  expiry_date: null,
  purchase_price: 3000,
  sale_price: 4500,
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
  vi.mocked(productsApi.updateDistributorProductRelation).mockResolvedValue({ error: null });
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

function renderPanel(canSetPrice = false) {
  return render(
    <StoreCatalogPanel
      kind="distribuidor"
      storeId={0}
      storeName="mi distribuidora"
      canSetPrice={canSetPrice}
    />,
  );
}

describe("StoreCatalogPanel · modo distribuidor (S15/S21)", () => {
  it("reutiliza el panel con la cantidad propia y el estado En catálogo", async () => {
    renderPanel();

    expect(await screen.findByText("Arroz Diana")).toBeInTheDocument();
    expect(screen.getByText("En catálogo")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Cantidad" })).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    for (const header of ["Umbral", "Vence", "Precio de venta"]) {
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

  it("muestra avisos de cantidad y vencimiento de la relación", async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    vi.mocked(productsApi.fetchDistributorCatalog).mockResolvedValue({
      rows: [{ ...ROW, threshold: 5, expiry_date: soon }],
      count: 1,
      error: null,
    });

    renderPanel();

    expect(await screen.findByText("Bajo")).toBeInTheDocument();
    expect(screen.getByText("Vence")).toBeInTheDocument();
  });

  it("Editar abre la relación (cantidad) y nunca la ficha del producto", async () => {
    renderPanel();
    const user = userEvent.setup();

    await screen.findByText("Arroz Diana");
    await user.click(screen.getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar Arroz Diana" });

    expect(within(dialog).getByText("Cantidad que poseo")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Nombre")).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(/genera una alerta de stock/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/genera una alerta de caducidad/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Los precios de compra y venta son una función Premium."),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Sumar cantidad de Arroz Diana" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(productsApi.updateDistributorProductRelation).toHaveBeenCalledWith(
        1,
        5,
        null,
        null,
        null,
        null,
      ),
    );
    expect(productsApi.updateStoreProductFull).not.toHaveBeenCalled();
  });

  it("Premium edita los precios de compra y venta de la relación", async () => {
    renderPanel(true);
    const user = userEvent.setup();

    await screen.findByText("Arroz Diana");
    await user.click(screen.getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar Arroz Diana" });

    expect(within(dialog).getByLabelText("Precio de compra (COP)")).toHaveValue(3000);
    const sale = within(dialog).getByLabelText("Precio de venta (COP)");
    expect(sale).toHaveValue(4500);
    await user.clear(sale);
    await user.type(sale, "5000");
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(productsApi.updateDistributorProductRelation).toHaveBeenCalledWith(
        1,
        4,
        null,
        null,
        3000,
        5000,
      ),
    );
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
