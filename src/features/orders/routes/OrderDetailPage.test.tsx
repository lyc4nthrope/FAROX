import { cleanup, render, screen } from "@testing-library/react";
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

function renderPage(role: RoleName) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
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

function pedido(status: OrderRow["status"]): OrderRow {
  return {
    id: 5,
    store_id: 7,
    store_name: "Tienda Centro",
    distributor_name: "Distribuidora Andes",
    status,
    expected_at: null,
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
    vi.mocked(ordersApi.createCredit).mockResolvedValue({ error: null });
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
