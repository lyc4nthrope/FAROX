import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import * as inventoryApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { DistributorMovementsPage } from "./DistributorMovementsPage";

vi.mock("../api", () => ({
  fetchDistributorMovements: vi.fn(),
  fetchDistributorPurchases: vi.fn(),
  fetchDistributorMovementOptions: vi.fn(),
  fetchDistributorStores: vi.fn(),
  fetchMovementRanking: vi.fn(),
  fetchMovementTemplates: vi.fn(),
  saveMovementTemplate: vi.fn(),
  deleteMovementTemplate: vi.fn(),
  registerDistributorSalesBulk: vi.fn(),
  registerDistributorPurchasesBulk: vi.fn(),
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

const PRODUCT = {
  id: 1,
  name: "Arroz Diana",
  brand: "Diana",
  barcode: "770123",
  quantity: 10,
  purchasePrice: 3000,
  salePrice: 4500,
};

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

function renderNonPremium() {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({
    role: "distribuidor",
    premium: false,
  });
  return render(
    <AuthProvider>
      <DistributorMovementsPage />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inventoryApi.fetchMovementRanking).mockResolvedValue({ data: new Map(), error: null });
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  vi.mocked(inventoryApi.fetchDistributorMovements).mockResolvedValue({
    data: MOVEMENTS,
    error: null,
  });
  vi.mocked(inventoryApi.fetchDistributorPurchases).mockResolvedValue({
    data: [],
    error: null,
  });
  vi.mocked(inventoryApi.fetchDistributorMovementOptions).mockResolvedValue({
    data: [PRODUCT],
    error: null,
  });
  vi.mocked(inventoryApi.fetchMovementTemplates).mockResolvedValue({
    data: [],
    error: null,
  });
  vi.mocked(inventoryApi.saveMovementTemplate).mockResolvedValue({ error: null });
  vi.mocked(inventoryApi.fetchDistributorStores).mockResolvedValue({
    data: [],
    error: null,
  });
  vi.mocked(inventoryApi.registerDistributorSalesBulk).mockResolvedValue({ error: null });
  vi.mocked(inventoryApi.registerDistributorPurchasesBulk).mockResolvedValue({ error: null });
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
    expect(items[0]).toHaveAttribute("data-tone", "reverse");
    expect(items[1]).toHaveAttribute("data-tone", "entry");
    expect(items[2]).toHaveAttribute("data-tone", "exit");
    expect(items[3]).toHaveAttribute("data-tone", "exit");
  });

  it("suma las compras propias como entradas del historial", async () => {
    vi.mocked(inventoryApi.fetchDistributorPurchases).mockResolvedValue({
      data: [
        {
          id: 90,
          type: "entry",
          direction: "entry",
          quantity: 6,
          unit_price: 2800,
          created_at: "2026-10-28T14:00:00Z",
          product_name: "Café Ávila",
          motive_name: "Compra a proveedor",
          reverso_of_id: null,
          store_name: null,
          source: "purchase",
        },
      ],
      error: null,
    });

    renderPage();

    expect(await screen.findByText("Café Ávila")).toBeInTheDocument();
    expect(screen.getByText("5 movimientos")).toBeInTheDocument();
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

  it("0037: en Todos hay compra y venta; cada filtro deja solo su acción", async () => {
    renderPage();
    const user = userEvent.setup();

    expect(await screen.findByRole("button", { name: "Registrar compra" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar venta" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Salidas" }));
    expect(screen.getByRole("button", { name: "Registrar venta" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Registrar compra" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Entradas" }));
    expect(screen.getByRole("button", { name: "Registrar compra" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar venta" })).not.toBeInTheDocument();
  });

  it("0037: registra una venta por ticket con descuento", async () => {
    vi.mocked(inventoryApi.fetchDistributorStores).mockResolvedValue({
      data: [{ id: 7, name: "Tienda Centro" }],
      error: null,
    });
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Registrar venta" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Registrar venta a una tienda",
    });
    await user.selectOptions(within(dialog).getByLabelText("Tienda vinculada"), "7");

    // Escanear o escribir el código y Enter: agrega sin tocar la lista.
    await user.type(within(dialog).getByLabelText("Buscar producto o código"), "770123{Enter}");
    const price = within(dialog).getByLabelText("Precio de venta de Arroz Diana");
    expect(price).toHaveValue(4500);

    await user.type(within(dialog).getByLabelText("Descuento (%)"), "10");
    expect(dialog).toHaveTextContent("4.050");
    expect(dialog).toHaveTextContent("ahorrás");
    await user.click(within(dialog).getByRole("button", { name: "Registrar venta" }));

    await waitFor(() =>
      expect(inventoryApi.registerDistributorSalesBulk).toHaveBeenCalledWith({
        storeId: 7,
        lines: [{ productId: 1, quantity: 1, unitPrice: 4050, expiryDate: null }],
        discountPct: 10,
      }),
    );
  });

  it("0038: «últimos vendidos» agrega el producto con un toque", async () => {
    vi.mocked(inventoryApi.fetchDistributorMovements).mockResolvedValue({
      data: [{ ...MOVEMENTS[0]!, product_id: 1 }],
      error: null,
    });
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Registrar venta" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Registrar venta a una tienda",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Agregar Arroz Diana de últimos vendidos" }),
    );

    expect(
      within(dialog).getByLabelText("Precio de venta de Arroz Diana"),
    ).toBeInTheDocument();
  });

  it("0038: aplicar una recurrente carga sus líneas con el precio vigente", async () => {
    vi.mocked(inventoryApi.fetchMovementTemplates).mockResolvedValue({
      data: [
        {
          id: 5,
          name: "Venta mostrador",
          kind: "exit",
          lines: [{ productId: 1, quantity: 2 }],
        },
      ],
      error: null,
    });
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Registrar venta" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Registrar venta a una tienda",
    });
    await user.click(
      await within(dialog).findByRole("button", {
        name: "Agregar Venta mostrador de recurrentes",
      }),
    );

    expect(within(dialog).getByLabelText("Cantidad de Arroz Diana")).toHaveValue(2);
    expect(within(dialog).getByLabelText("Precio de venta de Arroz Diana")).toHaveValue(4500);
  });

  it("0038: guarda el ticket actual como recurrente", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Registrar venta" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Registrar venta a una tienda",
    });
    await user.click(within(dialog).getByRole("button", { name: /Arroz Diana/ }));
    await user.click(within(dialog).getByRole("button", { name: "Guardar recurrente" }));
    await user.type(within(dialog).getByLabelText("Nombre de la plantilla"), "Venta mostrador");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(inventoryApi.saveMovementTemplate).toHaveBeenCalledWith({
        name: "Venta mostrador",
        kind: "exit",
        storeId: null,
        lines: [{ productId: 1, quantity: 1 }],
      }),
    );
  });

  it("0037: registra una compra a proveedor como entrada", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Registrar compra" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Registrar compra a proveedor",
    });
    await user.click(within(dialog).getByRole("button", { name: /Arroz Diana/ }));
    expect(within(dialog).getByLabelText("Precio de compra de Arroz Diana")).toHaveValue(3000);
    await user.click(within(dialog).getByRole("button", { name: "Registrar compra" }));

    await waitFor(() =>
      expect(inventoryApi.registerDistributorPurchasesBulk).toHaveBeenCalledWith({
        lines: [{ productId: 1, quantity: 1, unitPrice: 3000, expiryDate: null }],
      }),
    );
  });

  it("sin Premium no muestra el precio de la operación", async () => {
    renderNonPremium();

    expect(await screen.findByText("Leche Alpina")).toBeInTheDocument();
    expect(screen.queryByText(/Precio:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/4\.500/)).not.toBeInTheDocument();
    expect(inventoryApi.fetchDistributorMovementOptions).not.toHaveBeenCalled();
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
