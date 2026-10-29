import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import * as productsApi from "../../products/api";
import * as inventoryApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { DistributorMovementsPage } from "./DistributorMovementsPage";

vi.mock("../api", () => ({
  fetchDistributorMovements: vi.fn(),
  fetchDistributorStores: vi.fn(),
  registerDistributorSale: vi.fn(),
}));
vi.mock("../../products/api", () => ({
  fetchDistributorCatalog: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const MOVEMENTS: inventoryApi.MovementRow[] = [
  {
    id: 1,
    type: "entry",
    direction: "exit",
    quantity: 12,
    unit_price: 4500,
    order_id: 10,
    created_at: "2026-10-28T10:00:00Z",
    product_name: "Arroz Diana",
    motive_name: "reabastecimiento",
    reverso_of_id: null,
    store_name: "Tienda Centro",
  },
  {
    id: 2,
    type: "entry",
    direction: "exit",
    quantity: 2,
    unit_price: 3000,
    order_id: null,
    created_at: "2026-10-28T11:00:00Z",
    product_name: "Leche Alpina",
    motive_name: "venta",
    reverso_of_id: null,
    store_name: "Tienda Norte",
  },
  {
    id: 3,
    type: "exit",
    direction: "entry",
    quantity: 1,
    unit_price: null,
    order_id: null,
    created_at: "2026-10-28T12:00:00Z",
    product_name: "Arroz Diana",
    motive_name: "ajuste",
    reverso_of_id: null,
    store_name: "Tienda Centro",
  },
  {
    id: 4,
    type: "exit",
    direction: "entry",
    quantity: 1,
    unit_price: null,
    order_id: null,
    created_at: "2026-10-28T13:00:00Z",
    product_name: "Arroz Diana",
    motive_name: "ajuste",
    reverso_of_id: 1,
    store_name: "Tienda Centro",
  },
];

function renderPage() {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({
    role: "distribuidor",
    premium: true,
  });
  return render(
    <AuthProvider>
      <DistributorMovementsPage />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  vi.mocked(inventoryApi.fetchDistributorMovements).mockResolvedValue({
    data: MOVEMENTS,
    error: null,
  });
  vi.mocked(inventoryApi.fetchDistributorStores).mockResolvedValue({
    data: [],
    error: null,
  });
  vi.mocked(inventoryApi.registerDistributorSale).mockResolvedValue({ error: null });
  vi.mocked(productsApi.fetchDistributorCatalog).mockResolvedValue({
    rows: [],
    count: 0,
    error: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("DistributorMovementsPage · historial del distribuidor (S19)", () => {
  it("reutiliza la lista de movimientos con la tienda de cada uno", async () => {
    renderPage();

    expect((await screen.findAllByText("Arroz Diana")).length).toBe(3);
    expect(screen.getByText("Leche Alpina")).toBeInTheDocument();
    expect(screen.getAllByText("Tienda Centro").length).toBe(3);
    expect(screen.getByText("Tienda Norte")).toBeInTheDocument();
    expect(screen.getByText("4 movimientos")).toBeInTheDocument();
    expect(screen.getByText(/4\.500/)).toBeInTheDocument();
    expect(screen.getByText(/3\.000/)).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-tone", "exit");
    expect(items[1]).toHaveAttribute("data-tone", "exit");
    expect(items[2]).toHaveAttribute("data-tone", "entry");
    expect(items[3]).toHaveAttribute("data-tone", "reverse");
  });

  it("filtra entradas y salidas por la dirección del distribuidor", async () => {
    renderPage();
    const user = userEvent.setup();

    await screen.findAllByText("Arroz Diana");
    await user.click(screen.getByRole("button", { name: "Entradas" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("Leche Alpina")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Salidas" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Leche Alpina")).toBeInTheDocument();
  });

  it("registra una venta directa Premium a una tienda vinculada", async () => {
    vi.mocked(inventoryApi.fetchDistributorStores).mockResolvedValue({
      data: [{ id: 7, name: "Tienda Centro" }],
      error: null,
    });
    vi.mocked(productsApi.fetchDistributorCatalog).mockResolvedValue({
      rows: [
        {
          id: 1,
          name: "Arroz Diana",
          is_active: true,
          brand: { id: 1, name: "Diana" },
          unit: { id: 1, name: "kg" },
          category: { id: 1, name: "Granos" },
          quantity: null,
          threshold: null,
          expiry_date: null,
          is_shortage: false,
        },
      ],
      count: 1,
      error: null,
    });
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Registrar venta" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Registrar venta a una tienda",
    });
    await user.selectOptions(within(dialog).getByLabelText("Tienda vinculada"), "7");
    await user.selectOptions(within(dialog).getByLabelText("Producto de mi catálogo"), "1");
    await user.type(within(dialog).getByLabelText("Precio de venta (COP)"), "4500");
    await user.click(within(dialog).getByRole("button", { name: "Registrar venta" }));

    await waitFor(() =>
      expect(inventoryApi.registerDistributorSale).toHaveBeenCalledWith({
        storeId: 7,
        productId: 1,
        quantity: 1,
        unitPrice: 4500,
        expiryDate: null,
      }),
    );
  });

  it("sin movimientos muestra el estado vacío", async () => {
    vi.mocked(inventoryApi.fetchDistributorMovements).mockResolvedValue({
      data: [],
      error: null,
    });
    renderPage();

    expect(await screen.findByText("Todavía no hay movimientos")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("con un filtro sin resultados explica que pruebe otro", async () => {
    vi.mocked(inventoryApi.fetchDistributorMovements).mockResolvedValue({
      data: [MOVEMENTS[0]!],
      error: null,
    });
    renderPage();
    const user = userEvent.setup();

    await screen.findByText("Arroz Diana");
    await user.click(screen.getByRole("button", { name: "Entradas" }));
    expect(await screen.findByText("No hay movimientos de este tipo")).toBeInTheDocument();
  });
});
