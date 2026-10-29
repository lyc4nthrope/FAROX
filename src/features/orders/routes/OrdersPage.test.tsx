import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import * as ordersApi from "../api";
import type { OrderRow } from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { OrdersPage } from "./OrdersPage";

vi.mock("../api", () => ({
  ORDER_STATUS_LABELS: {
    pending: "Pendiente",
    in_route: "En ruta",
    delivered: "Entregado",
    cancelled: "Cancelado",
  },
  fetchOrders: vi.fn(),
  updateOrderStatus: vi.fn(),
  confirmFullDelivery: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

function order(id: number, status: OrderRow["status"]): OrderRow {
  return {
    id,
    store_id: 7,
    store_name: "Tienda Centro",
    distributor_name: "Distribuidora Andes",
    status,
    expected_at: null,
    delivered_at: null,
    created_at: "2026-10-28T10:00:00Z",
    notes: null,
    cancelled_reason: null,
  };
}

const ORDERS = [order(1, "pending"), order(2, "in_route")];

function renderPage(role: "distribuidor" | "operador") {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter>
      <AuthProvider>
        <OrdersPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  vi.mocked(ordersApi.fetchOrders).mockResolvedValue({ data: ORDERS, error: null });
  vi.mocked(ordersApi.updateOrderStatus).mockResolvedValue({ error: null });
  vi.mocked(ordersApi.confirmFullDelivery).mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
});

describe("OrdersPage · acciones de estado del distribuidor (0028)", () => {
  it("marca un pedido pendiente en ruta", async () => {
    renderPage("distribuidor");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "En ruta" }));

    expect(ordersApi.updateOrderStatus).toHaveBeenCalledWith(1, "in_route", null);
  });

  it("devuelve un pedido en ruta a pendiente", async () => {
    renderPage("distribuidor");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Pendiente" }));

    expect(ordersApi.updateOrderStatus).toHaveBeenCalledWith(2, "pending", null);
  });

  it("entrega completo desde la lista con confirmación", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage("distribuidor");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Entregar" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(ordersApi.confirmFullDelivery).toHaveBeenCalledWith(2));
    confirm.mockRestore();
  });

  it("el operador no ve las acciones de estado", async () => {
    renderPage("operador");

    expect((await screen.findAllByText("Tienda Centro")).length).toBe(2);
    expect(screen.queryByRole("button", { name: "En ruta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Entregar" })).not.toBeInTheDocument();
  });
});
