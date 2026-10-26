import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  fetchStockOptions: vi.fn(),
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

function stockRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    product_id: index + 1,
    product_name: `Producto ${index + 1}`,
    quantity: 10,
    threshold: 5,
    expiry_date: null,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "admin", premium: true });
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  vi.mocked(inventoryApi.fetchStoreName).mockResolvedValue({ data: "Prueba1", error: null });
  vi.mocked(inventoryApi.fetchStock).mockResolvedValue({ rows: [], count: 0, error: null });
  vi.mocked(inventoryApi.fetchStockOptions).mockResolvedValue({ data: [], error: null });
  vi.mocked(inventoryApi.fetchPrices).mockResolvedValue({ data: [], error: null });
  vi.mocked(inventoryApi.fetchActiveProducts).mockResolvedValue({ data: [], error: null });
  vi.mocked(inventoryApi.fetchMotives).mockResolvedValue({ data: [], error: null });
  vi.mocked(inventoryApi.fetchMovements).mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  cleanup();
});

describe("InventoryPage · stock paginado", () => {
  it("muestra la primera página y pide la siguiente con el mismo tamaño", async () => {
    vi.mocked(inventoryApi.fetchStock).mockResolvedValue({
      rows: stockRows(25),
      count: 60,
      error: null,
    });

    renderPage();

    expect(await screen.findByText("Producto 1")).toBeInTheDocument();
    expect(inventoryApi.fetchStock).toHaveBeenCalledWith(10, { page: 0, pageSize: 25 });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    await waitFor(() =>
      expect(inventoryApi.fetchStock).toHaveBeenLastCalledWith(10, { page: 1, pageSize: 25 }),
    );
  });

  it("sin stock: muestra el estado vacío con la pista para asignar", async () => {
    renderPage();

    expect(await screen.findByText("La tienda no tiene productos asignados")).toBeInTheDocument();
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

  it("asignar producto abre su formulario en un diálogo", async () => {
    renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Asignar producto" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Asignar producto a la tienda",
    });
    expect(within(dialog).getByRole("button", { name: "Asignar producto" })).toBeInTheDocument();
  });
});
