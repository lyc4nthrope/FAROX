import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
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
  reverseMovement: vi.fn(),
  setPrice: vi.fn(),
}));
// El catálogo/asignación se prueba en StoreCatalogPanel.test: acá solo importa
// que Inventario componga la pestaña «Productos».
vi.mock("../../products/components/StoreCatalogPanel", () => ({
  StoreCatalogPanel: () => <p>Panel de productos de la tienda</p>,
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

  it("el botón «Productos de la tienda» vuelve a la pestaña desde otra sección", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: /movimientos/i }));
    expect(screen.queryByText("Panel de productos de la tienda")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Productos de la tienda" }));
    expect(await screen.findByText("Panel de productos de la tienda")).toBeInTheDocument();
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
  it("registrar movimiento abre el formulario en un diálogo", async () => {
    renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /registrar movimiento/i }));

    const dialog = await screen.findByRole("dialog", {
      name: "Registrar entrada o salida",
    });
    expect(within(dialog).getByRole("group", { name: "Tipo de movimiento" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Producto")).toBeInTheDocument();
  });

  it("el selector de producto filtra por marca y cantidad en stock", async () => {
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

    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /registrar movimiento/i }));
    const dialog = await screen.findByRole("dialog", {
      name: "Registrar entrada o salida",
    });

    await user.type(within(dialog).getByLabelText("Buscar producto"), "alpina");
    expect(within(dialog).queryByRole("option", { name: /Arroz Diana/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: /Leche Alpina/ })).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText("Buscar producto"));
    await user.type(within(dialog).getByLabelText("Cantidad mínima en stock"), "20");
    expect(within(dialog).getByRole("option", { name: /Leche Alpina/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: /Arroz Diana/ })).not.toBeInTheDocument();
  });

  it("sin premium: el mismo botón explica el candado en vez de esconderlo", async () => {
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "admin", premium: false });

    renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /registrar movimiento/i }));

    expect(await screen.findByText("Función Premium")).toBeInTheDocument();
  });
});
