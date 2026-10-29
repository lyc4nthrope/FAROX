import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as ordersApi from "../api";
import type { OrderRow } from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { OrderDetailPage } from "./OrderDetailPage";

vi.mock("../api", () => ({
  ORDER_STATUS_LABELS: {
    pending: "Pendiente",
    in_route: "En ruta",
    delivered: "Entregado",
    cancelled: "Cancelado",
  },
  fetchOrder: vi.fn(),
  fetchOrderItems: vi.fn(),
  fetchOrderQuotes: vi.fn(),
  setOrderPrices: vi.fn(),
  setOrderExpectedAt: vi.fn(),
  updateOrderStatus: vi.fn(),
  confirmDelivery: vi.fn(),
  createCredit: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

function renderPage(role: RoleName, premium = false) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium });
  return render(
    <MemoryRouter initialEntries={["/pedidos/5"]}>
      <AuthProvider>
        <Routes>
          <Route path="/pedidos/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function pedido(status: OrderRow["status"], expectedAt: string | null = null): OrderRow {
  return {
    id: 5,
    store_id: 7,
    store_name: "Tienda Centro",
    distributor_name: "Distribuidora Andes",
    status,
    expected_at: expectedAt,
    delivered_at: null,
    created_at: "2026-10-25T12:00:00Z",
    notes: null,
    cancelled_reason: null,
  };
}

describe("OrderDetailPage · fiado (0023)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(ordersApi.fetchOrderItems).mockResolvedValue({ data: [], error: null });
    vi.mocked(ordersApi.fetchOrderQuotes).mockResolvedValue({ data: [], error: null });
    vi.mocked(ordersApi.createCredit).mockResolvedValue({ error: null });
    vi.mocked(ordersApi.setOrderPrices).mockResolvedValue({ error: null });
    vi.mocked(ordersApi.setOrderExpectedAt).mockResolvedValue({ error: null });
    vi.mocked(ordersApi.updateOrderStatus).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("operador: puede crear el fiado de un pedido entregado de su tienda", async () => {
    const user = userEvent.setup();
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("delivered"), error: null });

    renderPage("operador");

    await user.click(await screen.findByRole("button", { name: "Crear crédito para este pedido" }));
    expect(ordersApi.createCredit).toHaveBeenCalledWith(5, null);
  });

  it("operador: sin entrega todavía no hay fiado", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("pending"), error: null });

    renderPage("operador");

    expect(await screen.findByRole("heading", { name: "Pedido #5" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Crear crédito para este pedido" }),
    ).not.toBeInTheDocument();
  });

  it("distribuidor: no crea fiado aunque el pedido esté entregado", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("delivered"), error: null });

    renderPage("distribuidor");

    expect(await screen.findByRole("heading", { name: "Pedido #5" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Crear crédito para este pedido" }),
    ).not.toBeInTheDocument();
  });
});

describe("OrderDetailPage · cotización del distribuidor (0024)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(ordersApi.fetchOrderItems).mockResolvedValue({
      data: [
        {
          id: 1,
          product_id: 10,
          product_name: "Arroz",
          quantity: 2,
          received_quantity: null,
          status: "pending",
          unit_price: null,
        },
      ],
      error: null,
    });
    vi.mocked(ordersApi.setOrderPrices).mockResolvedValue({ error: null });
    vi.mocked(ordersApi.fetchOrderQuotes).mockResolvedValue({
      data: [{ product_id: 10, distributor_price: null }],
      error: null,
    });
    vi.mocked(ordersApi.setOrderExpectedAt).mockResolvedValue({ error: null });
    vi.mocked(ordersApi.updateOrderStatus).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("el distribuidor cotiza las líneas de un pedido pendiente", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("pending"), error: null });
    const user = userEvent.setup();

    renderPage("distribuidor");

    const precio = await screen.findByLabelText("Precio de Arroz");
    await user.type(precio, "2500");
    await user.click(screen.getByRole("button", { name: "Guardar cotización" }));

    expect(ordersApi.setOrderPrices).toHaveBeenCalledWith(5, [
      { product_id: 10, distributor_price: 2500 },
    ]);
  });

  it("precarga la cotización ya guardada del distribuidor", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("pending"), error: null });
    vi.mocked(ordersApi.fetchOrderQuotes).mockResolvedValue({
      data: [{ product_id: 10, distributor_price: 3200 }],
      error: null,
    });

    renderPage("distribuidor");

    const input = await screen.findByLabelText("Precio de Arroz");
    await waitFor(() => expect(input).toHaveValue(3200));
  });

  it("el operador no cotiza: la caja es del distribuidor", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("pending"), error: null });

    renderPage("operador");

    expect(await screen.findByRole("heading", { name: "Pedido #5" })).toBeInTheDocument();
    expect(screen.queryByText("Cotización del distribuidor")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Precio de Arroz")).not.toBeInTheDocument();
  });

  it("el operador Premium ve la cotización guardada, sin formulario", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("pending"), error: null });
    vi.mocked(ordersApi.fetchOrderQuotes).mockResolvedValue({
      data: [{ product_id: 10, distributor_price: 2500 }],
      error: null,
    });

    renderPage("operador", true);

    expect(await screen.findByText(/2\.500/)).toBeInTheDocument();
    expect(screen.getByText("Total cotizado por el distribuidor:")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Guardar cotización" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Precio de Arroz")).not.toBeInTheDocument();
  });

  it("el operador no Premium también ve la cotización del distribuidor", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("pending"), error: null });
    vi.mocked(ordersApi.fetchOrderQuotes).mockResolvedValue({
      data: [{ product_id: 10, distributor_price: 2500 }],
      error: null,
    });

    renderPage("operador");

    expect(await screen.findByText(/2\.500/)).toBeInTheDocument();
    expect(screen.getByText("Total cotizado por el distribuidor:")).toBeInTheDocument();
  });

  it("el distribuidor Premium ve el precio registrado como sugerencia", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("pending"), error: null });
    vi.mocked(ordersApi.fetchOrderItems).mockResolvedValue({
      data: [
        {
          id: 1,
          product_id: 10,
          product_name: "Arroz",
          quantity: 2,
          received_quantity: null,
          status: "pending",
          unit_price: 3200,
        },
      ],
      error: null,
    });
    vi.mocked(ordersApi.fetchOrderQuotes).mockResolvedValue({
      data: [{ product_id: 10, distributor_price: null }],
      error: null,
    });

    renderPage("distribuidor", true);

    const precio = await screen.findByLabelText("Precio de Arroz");
    await waitFor(() => expect(precio).toHaveValue(3200));
  });

  it("el distribuidor no Premium no precarga el precio registrado", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("pending"), error: null });
    vi.mocked(ordersApi.fetchOrderItems).mockResolvedValue({
      data: [
        {
          id: 1,
          product_id: 10,
          product_name: "Arroz",
          quantity: 2,
          received_quantity: null,
          status: "pending",
          unit_price: 3200,
        },
      ],
      error: null,
    });

    renderPage("distribuidor");

    const precio = await screen.findByLabelText("Precio de Arroz");
    await waitFor(() => expect(precio).toHaveValue(null));
  });

  it("el distribuidor devuelve un pedido en ruta a pendiente", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("in_route"), error: null });
    const user = userEvent.setup();

    renderPage("distribuidor");
    await user.click(await screen.findByRole("button", { name: "Volver a pendiente" }));

    expect(ordersApi.updateOrderStatus).toHaveBeenCalledWith(5, "pending", null);
  });

  it("un pedido en ruta todavía admite ajustar la cotización", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("in_route"), error: null });

    renderPage("distribuidor");

    expect(await screen.findByText("Cotización del distribuidor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar cotización" })).toBeInTheDocument();
  });
});

describe("OrderDetailPage · ciclo del pedido en manos del distribuidor (0025)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(ordersApi.fetchOrderItems).mockResolvedValue({ data: [], error: null });
    vi.mocked(ordersApi.fetchOrderQuotes).mockResolvedValue({ data: [], error: null });
    vi.mocked(ordersApi.updateOrderStatus).mockResolvedValue({ error: null });
    vi.mocked(ordersApi.confirmDelivery).mockResolvedValue({ error: null });
    vi.mocked(ordersApi.setOrderExpectedAt).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("el operador que pidió no marca en ruta ni confirma la entrega", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("pending"), error: null });

    renderPage("operador");

    expect(
      await screen.findByText(
        "El distribuidor marca el pedido en ruta y confirma la entrega. Vos seguís el estado acá.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar en ruta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar entrega" })).not.toBeInTheDocument();
  });

  it("el distribuidor marca el pedido en ruta", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("pending"), error: null });
    const user = userEvent.setup();

    renderPage("distribuidor");
    await user.click(await screen.findByRole("button", { name: "Marcar en ruta" }));

    expect(ordersApi.updateOrderStatus).toHaveBeenCalledWith(5, "in_route", null);
  });

  it("el distribuidor confirma la entrega", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("in_route"), error: null });
    const user = userEvent.setup();

    renderPage("distribuidor");
    await user.click(await screen.findByRole("button", { name: "Confirmar entrega" }));

    expect(ordersApi.confirmDelivery).toHaveBeenCalledWith(5, []);
  });

  it("la fecha prometida es opcional y la guarda el distribuidor", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({ data: pedido("pending"), error: null });
    const user = userEvent.setup();

    renderPage("distribuidor");
    const fecha = await screen.findByLabelText("Fecha prometida (opcional)");
    fireEvent.change(fecha, { target: { value: "2026-11-02" } });
    // fireEvent no espera el commit del input controlado: sin este waitFor el
    // click puede leer el borrador anterior bajo carga.
    await waitFor(() => expect(fecha).toHaveValue("2026-11-02"));
    await user.click(screen.getByRole("button", { name: "Guardar fecha" }));

    expect(ordersApi.setOrderExpectedAt).toHaveBeenCalledWith(5, "2026-11-02T12:00:00Z");
  });

  it("S8: el distribuidor quita la fecha prometida", async () => {
    vi.mocked(ordersApi.fetchOrder).mockResolvedValue({
      data: pedido("in_route", "2026-11-02T12:00:00Z"),
      error: null,
    });
    const user = userEvent.setup();

    renderPage("distribuidor");
    await user.click(await screen.findByRole("button", { name: "Quitar fecha" }));

    expect(ordersApi.setOrderExpectedAt).toHaveBeenCalledWith(5, null);
  });
});
