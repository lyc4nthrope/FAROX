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
  setStoreProductShortage: vi.fn(),
  updateStoreProduct: vi.fn(),
  // AddProductsPanel (montado dentro del modal) usa estas.
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
  vi.mocked(productsApi.updateStoreProduct).mockResolvedValue({ error: null });
  vi.mocked(productsApi.setStoreProductShortage).mockResolvedValue({ error: null });
  vi.mocked(productsApi.removeStoreProduct).mockResolvedValue({ error: null });
  vi.mocked(productsApi.fetchActiveProductsForCatalog).mockResolvedValue({
    rows: [],
    count: 0,
    error: null,
  });
  vi.mocked(productsApi.fetchStoreStock).mockResolvedValue({ data: [], error: null });
  vi.mocked(productsApi.fetchDistributorProductIds).mockResolvedValue({
    data: [],
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
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
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

  it("edita cantidad y umbral en un modal y guarda con UNA sola RPC", async () => {
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar Arroz Diana" });

    await user.click(
      within(dialog).getByRole("button", { name: "Sumar cantidad de Arroz Diana" }),
    );
    const umbral = within(dialog).getByLabelText("Umbral de alerta (opcional)");
    await user.clear(umbral);
    await user.type(umbral, "8");
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(productsApi.updateStoreProduct).toHaveBeenCalledWith(10, 1, 13, 8, false),
    );
    expect(productsApi.updateStoreProduct).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('"Arroz Diana" actualizado.')).toBeInTheDocument();
  });

  it("cancelar la edición no guarda nada", async () => {
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar Arroz Diana" });
    await user.click(
      within(dialog).getByRole("button", { name: "Sumar cantidad de Arroz Diana" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    expect(productsApi.updateStoreProduct).not.toHaveBeenCalled();
  });

  it("tipear no dispara RPC: un solo Guardar hace UNA llamada", async () => {
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar Arroz Diana" });
    const quantity = within(dialog).getByLabelText("Cantidad de Arroz Diana");
    await user.clear(quantity);
    await user.type(quantity, "20");
    const umbral = within(dialog).getByLabelText("Umbral de alerta (opcional)");
    await user.clear(umbral);
    await user.type(umbral, "8");
    expect(productsApi.updateStoreProduct).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(productsApi.updateStoreProduct).toHaveBeenCalledWith(10, 1, 20, 8, false),
    );
    expect(productsApi.updateStoreProduct).toHaveBeenCalledTimes(1);
  });

  it("umbral vacío se guarda como null", async () => {
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar Arroz Diana" });
    await user.clear(within(dialog).getByLabelText("Umbral de alerta (opcional)"));
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(productsApi.updateStoreProduct).toHaveBeenCalledWith(10, 1, 12, null, false),
    );
  });

  it("cantidad vacía no guarda 0 en silencio", async () => {
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar Arroz Diana" });
    await user.clear(within(dialog).getByLabelText("Cantidad de Arroz Diana"));
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    expect(await within(dialog).findByText("Ingresá una cantidad.")).toBeInTheDocument();
    expect(productsApi.updateStoreProduct).not.toHaveBeenCalled();
  });

  it("la tabla no tiene Guardar ni inputs por celda", async () => {
    renderPanel();

    await screen.findByText("Arroz Diana");
    expect(screen.queryByRole("button", { name: /^Guardar/ })).toBeNull();
    expect(screen.queryByLabelText("Cantidad de Arroz Diana")).toBeNull();
    expect(screen.queryByLabelText("Umbral de Arroz Diana")).toBeNull();
  });

  it("cada acción tiene un tono distinto y suave", async () => {
    renderPanel();

    expect((await screen.findByRole("button", { name: "Editar" })).className).toMatch(/text-sky-/);
    expect(screen.getByRole("button", { name: "Marcar faltante" }).className).toMatch(
      /text-amber-/,
    );
    expect(screen.getByRole("button", { name: "Quitar" }).className).toMatch(/text-red-/);
  });

  it("marca el faltante del producto con su acción propia", async () => {
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
