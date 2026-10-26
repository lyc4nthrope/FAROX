import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as productsApi from "../api";
import type { CatalogEntry, ProductListRow } from "../types";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { ProductsPage } from "./ProductsPage";

// D7 (componente, api de la feature mockeada COMPLETA): /products ya no es la
// misma vista para todos (0019). El admin conserva el catálogo general; tienda
// y distribuidor ven SOLO lo relacionado a sus entidades.
vi.mock("../api", () => ({
  fetchProducts: vi.fn(),
  fetchProduct: vi.fn(),
  fetchBrands: vi.fn(),
  fetchUnitTypes: vi.fn(),
  fetchProductCategories: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deactivateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  fetchCatalogContext: vi.fn(),
  fetchStoreCatalog: vi.fn(),
  fetchDistributorCatalog: vi.fn(),
  fetchActiveProductsForCatalog: vi.fn(),
  addStoreCatalogProduct: vi.fn(),
  removeStoreCatalogProduct: vi.fn(),
  addDistributorCatalogProduct: vi.fn(),
  removeDistributorCatalogProduct: vi.fn(),
  setStoreProductQuantity: vi.fn(),
  removeStoreProduct: vi.fn(),
  setStoreProductShortage: vi.fn(),
  fetchShortageProducts: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const FILA: ProductListRow = {
  id: 1,
  name: "Café molido",
  is_active: true,
  brand: { id: 1, name: "Andina" },
  unit: { id: 2, name: "Gramos" },
  category: { id: 1, name: "Bebidas" },
};

const ENTRADA_TIENDA: CatalogEntry = { ...FILA, quantity: 0, is_shortage: false };

const OTRO_PRODUCTO: ProductListRow = {
  id: 2,
  name: "Arroz blanco",
  is_active: true,
  brand: { id: 2, name: "Roa" },
  unit: { id: 1, name: "Kilos" },
  category: { id: 2, name: "Granos" },
};

const ERROR_RLS = { code: "42501", message: "permission denied for table products" };

const SIN_FILTROS = { q: "", categoryId: null, onlyShortage: false };

function renderPagina(role: RoleName) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={["/products"]}>
      <AuthProvider>
        <Routes>
          <Route path="/products" element={<ProductsPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function cajaCatalogo(): Promise<HTMLElement> {
  return (await screen.findByRole("heading", { name: "Catálogo de Tienda Centro" })).closest(
    "section",
  ) as HTMLElement;
}

describe("ProductsPage (0019 · catálogo por entidad)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(productsApi.fetchProducts).mockResolvedValue({
      rows: [FILA],
      count: 1,
      error: null,
    });
    vi.mocked(productsApi.fetchProductCategories).mockResolvedValue({
      rows: [
        { id: 1, name: "Bebidas" },
        { id: 2, name: "Granos" },
      ],
      error: null,
    });
    vi.mocked(productsApi.fetchCatalogContext).mockResolvedValue({
      data: { stores: [{ id: 7, name: "Tienda Centro" }], distributorId: null },
      error: null,
    });
    vi.mocked(productsApi.fetchStoreCatalog).mockResolvedValue({
      rows: [ENTRADA_TIENDA],
      count: 1,
      error: null,
    });
    vi.mocked(productsApi.fetchDistributorCatalog).mockResolvedValue({
      rows: [{ ...FILA, quantity: null, is_shortage: false }],
      count: 1,
      error: null,
    });
    vi.mocked(productsApi.fetchActiveProductsForCatalog).mockResolvedValue({
      rows: [OTRO_PRODUCTO],
      count: 1,
      error: null,
    });
    vi.mocked(productsApi.addStoreCatalogProduct).mockResolvedValue({ error: null });
    vi.mocked(productsApi.removeStoreCatalogProduct).mockResolvedValue({ error: null });
    vi.mocked(productsApi.addDistributorCatalogProduct).mockResolvedValue({ error: null });
    vi.mocked(productsApi.removeDistributorCatalogProduct).mockResolvedValue({ error: null });
    vi.mocked(productsApi.setStoreProductQuantity).mockResolvedValue({ error: null });
    vi.mocked(productsApi.removeStoreProduct).mockResolvedValue({ error: null });
    vi.mocked(productsApi.setStoreProductShortage).mockResolvedValue({ error: null });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("admin: vista GENERAL con todos los productos + alta del catálogo global", async () => {
    renderPagina("admin");

    expect(await screen.findByRole("link", { name: "Café molido" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Nuevo producto" })).toBeInTheDocument();
    expect(productsApi.fetchProducts).toHaveBeenCalledTimes(1);
    expect(productsApi.fetchCatalogContext).not.toHaveBeenCalled();
  });

  it("tienda (operador): ve el catálogo de SU tienda, no el general", async () => {
    renderPagina("operador");

    expect(await screen.findByText("Catálogo de Tienda Centro")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Café molido" })).toBeInTheDocument();
    expect(productsApi.fetchStoreCatalog).toHaveBeenCalledWith(7, {
      page: 0,
      pageSize: 25,
      ...SIN_FILTROS,
    });
    expect(productsApi.fetchProducts).not.toHaveBeenCalled();
  });

  it("distribuidor: ve el catálogo de SU distribuidora (my_distributor_id)", async () => {
    vi.mocked(productsApi.fetchCatalogContext).mockResolvedValue({
      data: { stores: [], distributorId: 3 },
      error: null,
    });
    renderPagina("distribuidor");

    expect(await screen.findByText("Catálogo de mi distribuidora")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Café molido" })).toBeInTheDocument();
    expect(productsApi.fetchDistributorCatalog).toHaveBeenCalledWith({
      page: 0,
      pageSize: 25,
      ...SIN_FILTROS,
    });
    expect(productsApi.fetchStoreCatalog).not.toHaveBeenCalled();
  });

  it("usuario sin tienda ni distribuidora: estado vacío explícito", async () => {
    vi.mocked(productsApi.fetchCatalogContext).mockResolvedValue({
      data: { stores: [], distributorId: null },
      error: null,
    });
    renderPagina("operador");

    expect(
      await screen.findByText("No tenés una tienda ni una distribuidora asociada."),
    ).toBeInTheDocument();
  });

  it("S2: el botón del header abre el registro y agregar suma el producto", async () => {
    const user = userEvent.setup();
    renderPagina("operador");

    // El registro no se pide hasta abrir el alta (no ensucia la carga).
    expect(productsApi.fetchActiveProductsForCatalog).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Agregar producto" }));

    const dialog = await screen.findByRole("dialog", { name: "Agregar productos a mi catálogo" });
    await user.click(await within(dialog).findByRole("button", { name: "Agregar" }));

    await waitFor(() => expect(productsApi.addStoreCatalogProduct).toHaveBeenCalledWith(7, 2));
    expect(await screen.findByText("Producto agregado al catálogo.")).toBeInTheDocument();
    // El catálogo se vuelve a pedir tras el alta (sin realtime).
    expect(productsApi.fetchStoreCatalog).toHaveBeenCalledTimes(2);
  });

  it("S2: el alta es una ventana emergente y Escape la cierra", async () => {
    const user = userEvent.setup();
    renderPagina("operador");

    await user.click(await screen.findByRole("button", { name: "Agregar producto" }));
    const dialog = await screen.findByRole("dialog", { name: "Agregar productos a mi catálogo" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // El foco entra en el buscador del registro.
    expect(within(dialog).getByLabelText("Buscar en el registro")).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // El foco vuelve al botón que la abrió.
    expect(screen.getByRole("button", { name: "Agregar producto" })).toHaveFocus();
  });

  it("S2: el botón Cerrar de la ventana también la cierra", async () => {
    const user = userEvent.setup();
    renderPagina("operador");

    await user.click(await screen.findByRole("button", { name: "Agregar producto" }));
    const dialog = await screen.findByRole("dialog", { name: "Agregar productos a mi catálogo" });
    await user.click(within(dialog).getByRole("button", { name: "Cerrar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("quitar del catálogo del distribuidor: RPC sin ids de tienda", async () => {
    vi.mocked(productsApi.fetchCatalogContext).mockResolvedValue({
      data: { stores: [], distributorId: 3 },
      error: null,
    });
    const user = userEvent.setup();
    renderPagina("distribuidor");

    const boton = await screen.findByRole("button", { name: "Quitar" });
    await user.click(boton);

    await waitFor(() =>
      expect(productsApi.removeDistributorCatalogProduct).toHaveBeenCalledWith(1),
    );
    expect(productsApi.removeStoreProduct).not.toHaveBeenCalled();
  });

  it("S5: un producto INACTIVO ya asignado a la tienda se puede quitar", async () => {
    // El registro "agregar" solo lista activos; si el catálogo ocultara los
    // inactivos asignados, quedarían sin salida (dead end).
    vi.mocked(productsApi.fetchStoreCatalog).mockResolvedValue({
      rows: [{ ...FILA, is_active: false, quantity: 0, is_shortage: false }],
      count: 1,
      error: null,
    });
    renderPagina("operador");

    expect(await screen.findByText("Inactivo")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Quitar" })).toBeInTheDocument();
  });

  it("S5: quitar sin stock pide UNA confirmación y llama la RPC con confirm_stock=false", async () => {
    const user = userEvent.setup();
    renderPagina("operador");

    const section = await cajaCatalogo();
    await user.click(await within(section).findByRole("button", { name: "Quitar" }));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(productsApi.removeStoreProduct).toHaveBeenCalledWith(7, 1, false));
    expect(await screen.findByText("Producto quitado del catálogo.")).toBeInTheDocument();
    expect(productsApi.fetchStoreCatalog).toHaveBeenCalledTimes(2);
  });

  it("S5: quitar CON stock pide DOS confirmaciones y descarta el stock", async () => {
    vi.mocked(productsApi.fetchStoreCatalog).mockResolvedValue({
      rows: [{ ...FILA, quantity: 2, is_shortage: false }],
      count: 1,
      error: null,
    });
    const user = userEvent.setup();
    renderPagina("operador");

    const section = await cajaCatalogo();
    // La cantidad está visible antes de decidir.
    expect(await within(section).findByLabelText("Cantidad de Café molido")).toHaveValue(2);
    await user.click(await within(section).findByRole("button", { name: "Quitar" }));

    expect(window.confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(productsApi.removeStoreProduct).toHaveBeenCalledWith(7, 1, true));
  });

  it("S5: cancelar la primera confirmación NO dispara ninguna baja", async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    vi.mocked(productsApi.fetchStoreCatalog).mockResolvedValue({
      rows: [{ ...FILA, quantity: 2, is_shortage: false }],
      count: 1,
      error: null,
    });
    const user = userEvent.setup();
    renderPagina("operador");

    const section = await cajaCatalogo();
    await user.click(await within(section).findByRole("button", { name: "Quitar" }));

    expect(productsApi.removeStoreProduct).not.toHaveBeenCalled();
  });

  it("S4: la cantidad se edita y se guarda sin movimiento", async () => {
    const user = userEvent.setup();
    renderPagina("operador");

    const section = await cajaCatalogo();
    const input = await within(section).findByLabelText("Cantidad de Café molido");
    await user.clear(input);
    await user.type(input, "5");
    await user.click(await within(section).findByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(productsApi.setStoreProductQuantity).toHaveBeenCalledWith(7, 1, 5));
    expect(await screen.findByText('Cantidad de "Café molido" actualizada.')).toBeInTheDocument();
    expect(productsApi.fetchStoreCatalog).toHaveBeenCalledTimes(2);
  });

  it("S6: marcar faltante prende el flag y la fila lo muestra", async () => {
    const user = userEvent.setup();
    renderPagina("operador");

    const section = await cajaCatalogo();
    await user.click(await within(section).findByRole("button", { name: "Marcar faltante" }));

    await waitFor(() => expect(productsApi.setStoreProductShortage).toHaveBeenCalledWith(7, 1, true));
    expect(await screen.findByText('"Café molido" marcado como faltante.')).toBeInTheDocument();
  });

  it("S6: con faltante activo el botón ofrece quitarlo y muestra la etiqueta", async () => {
    vi.mocked(productsApi.fetchStoreCatalog).mockResolvedValue({
      rows: [{ ...FILA, quantity: 0, is_shortage: true }],
      count: 1,
      error: null,
    });
    const user = userEvent.setup();
    renderPagina("operador");

    const section = await cajaCatalogo();
    expect(await within(section).findByText("Faltante")).toBeInTheDocument();
    await user.click(await within(section).findByRole("button", { name: "Quitar faltante" }));

    await waitFor(() =>
      expect(productsApi.setStoreProductShortage).toHaveBeenCalledWith(7, 1, false),
    );
  });

  it("S3: la búsqueda viaja al servidor (no filtra la página cargada)", async () => {
    const user = userEvent.setup();
    renderPagina("operador");

    const section = await cajaCatalogo();
    await user.type(within(section).getByLabelText("Buscar en mi catálogo"), "café");

    await waitFor(
      () =>
        expect(productsApi.fetchStoreCatalog).toHaveBeenLastCalledWith(7, {
          page: 0,
          pageSize: 25,
          q: "café",
          categoryId: null,
          onlyShortage: false,
        }),
      { timeout: 2000 },
    );
  });

  it("S3: la categoría y el faltante también se filtran en el servidor", async () => {
    const user = userEvent.setup();
    renderPagina("operador");

    const section = await cajaCatalogo();
    await user.selectOptions(within(section).getByLabelText("Categoría"), "2");
    await waitFor(() =>
      expect(productsApi.fetchStoreCatalog).toHaveBeenLastCalledWith(7, {
        page: 0,
        pageSize: 25,
        q: "",
        categoryId: 2,
        onlyShortage: false,
      }),
    );

    await user.click(within(section).getByLabelText("Solo faltantes"));
    await waitFor(() =>
      expect(productsApi.fetchStoreCatalog).toHaveBeenLastCalledWith(7, {
        page: 0,
        pageSize: 25,
        q: "",
        categoryId: 2,
        onlyShortage: true,
      }),
    );
  });

  it("S4: el registro global se pagina (nada queda truncado en silencio)", async () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      ...OTRO_PRODUCTO,
      id: 100 + index,
      name: `Producto ${index + 1}`,
    }));
    vi.mocked(productsApi.fetchActiveProductsForCatalog).mockResolvedValue({
      rows: many,
      count: 30,
      error: null,
    });
    const user = userEvent.setup();
    renderPagina("operador");

    await user.click(await screen.findByRole("button", { name: "Agregar producto" }));
    const dialog = await screen.findByRole("dialog", { name: "Agregar productos a mi catálogo" });
    const pager = await within(dialog).findByRole("navigation", { name: "Paginación" });
    await user.click(within(pager).getByRole("button", { name: "Siguiente" }));

    await waitFor(() =>
      expect(productsApi.fetchActiveProductsForCatalog).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 25,
        ...SIN_FILTROS,
      }),
    );
  });

  it("S4: el catálogo de la tienda pagina (página 2 solicitable)", async () => {
    const many: CatalogEntry[] = Array.from({ length: 25 }, (_, index) => ({
      ...FILA,
      id: 100 + index,
      name: `Producto ${index + 1}`,
      quantity: 0,
      is_shortage: false,
    }));
    vi.mocked(productsApi.fetchStoreCatalog).mockResolvedValue({
      rows: many,
      count: 30,
      error: null,
    });
    const user = userEvent.setup();
    renderPagina("operador");

    const section = await cajaCatalogo();
    const nav = await within(section).findByRole("navigation", { name: "Paginación" });
    await user.click(within(nav).getByRole("button", { name: "Siguiente" }));

    await waitFor(() =>
      expect(productsApi.fetchStoreCatalog).toHaveBeenLastCalledWith(7, {
        page: 1,
        pageSize: 25,
        ...SIN_FILTROS,
      }),
    );
  });

  it("S4: el catálogo del distribuidor pagina (página 2 solicitable)", async () => {
    vi.mocked(productsApi.fetchCatalogContext).mockResolvedValue({
      data: { stores: [], distributorId: 3 },
      error: null,
    });
    const many: CatalogEntry[] = Array.from({ length: 25 }, (_, index) => ({
      ...FILA,
      id: 100 + index,
      name: `Producto ${index + 1}`,
      quantity: null,
      is_shortage: false,
    }));
    vi.mocked(productsApi.fetchDistributorCatalog).mockResolvedValue({
      rows: many,
      count: 30,
      error: null,
    });
    const user = userEvent.setup();
    renderPagina("distribuidor");

    const section = (
      await screen.findByRole("heading", { name: "Catálogo de mi distribuidora" })
    ).closest("section") as HTMLElement;
    const nav = await within(section).findByRole("navigation", { name: "Paginación" });
    await user.click(within(nav).getByRole("button", { name: "Siguiente" }));

    await waitFor(() =>
      expect(productsApi.fetchDistributorCatalog).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 25,
        ...SIN_FILTROS,
      }),
    );
  });

  it("error del alcance ⇒ banner amigable; el texto crudo NUNCA llega (HARD-1)", async () => {
    vi.mocked(productsApi.fetchCatalogContext).mockResolvedValue({
      data: null,
      error: ERROR_RLS,
    });
    renderPagina("operador");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });
});
