import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../features/auth/types";
import * as authApi from "../../features/auth/api";
import * as alertsApi from "../../features/inventory/alertsApi";
import * as ordersApi from "../../features/orders/api";
import { AuthProvider } from "../providers/AuthProvider";
import { AppShell } from "./AppShell";

vi.mock("../../features/auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));
vi.mock("../../features/inventory/alertsApi", () => ({
  fetchOpenAlerts: vi.fn(),
}));
vi.mock("../../features/orders/api", () => ({
  fetchOpenOrdersCount: vi.fn(),
}));

function renderShell(role: RoleName | null, premium = false) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium });
  return render(
    <MemoryRouter initialEntries={["/products"]}>
      <AuthProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/products" element={<p>contenido de productos</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AppShell (V0-5: nav mobile-first por rol)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(alertsApi.fetchOpenAlerts).mockResolvedValue({ data: [], error: null });
    vi.mocked(ordersApi.fetchOpenOrdersCount).mockResolvedValue({ data: 0, error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("operador: distribuidores, inventario y tiendas; sin /users ni /products", async () => {
    renderShell("operador");
    expect(await screen.findByRole("link", { name: "Distribuidores" })).toBeInTheDocument();
    // 0024: Productos se fusionó en Inventario.
    expect(screen.queryByRole("link", { name: "Productos" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inventario" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tiendas" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Usuarios" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Perfil" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salir" })).toBeInTheDocument();
  });

  it("distribuidor: solo lectura de productos entre las entidades (V0-5)", async () => {
    renderShell("distribuidor");
    expect(await screen.findByRole("link", { name: "Productos" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Distribuidores" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tiendas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Usuarios" })).not.toBeInTheDocument();
    // Perfil es utilidad de cuenta en el header, no una entrada de entidad.
    expect(screen.getByRole("link", { name: "Perfil" })).toBeInTheDocument();
  });

  it("sin rol (my_role() NULL): cero controles privilegiados (V0-3)", async () => {
    renderShell(null);
    expect(await screen.findByRole("link", { name: "Productos" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Distribuidores" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tiendas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Usuarios" })).not.toBeInTheDocument();
  });

  it("Mis pedidos muestra la notificación de pedidos abiertos", async () => {
    vi.mocked(ordersApi.fetchOpenOrdersCount).mockResolvedValue({ data: 2, error: null });

    renderShell("distribuidor");

    const badge = await screen.findByLabelText("2 pedidos abiertos");
    expect(badge).toHaveTextContent("2");
  });

  it("Alertas muestra el número de alertas abiertas", async () => {
    vi.mocked(alertsApi.fetchOpenAlerts).mockResolvedValue({
      data: [
        {
          id: 1,
          type: "stock_low",
          message: "Arroz bajo",
          created_at: "2026-10-28T10:00:00Z",
          read_at: null,
        },
        {
          id: 2,
          type: "expiry_soon",
          message: "Leche vence",
          created_at: "2026-10-28T10:00:00Z",
          read_at: null,
        },
        {
          id: 3,
          type: "order_late",
          message: "Pedido atrasado",
          created_at: "2026-10-28T10:00:00Z",
          read_at: "2026-10-28T11:00:00Z",
        },
        {
          id: 4,
          type: "credit_overdue",
          message: "Fiado vencido",
          created_at: "2026-10-28T10:00:00Z",
          read_at: null,
        },
      ],
      error: null,
    });

    renderShell("operador");

    // Cuenta solo las NO leídas (3 de 4).
    const badge = await screen.findByLabelText("3 alertas");
    expect(badge).toHaveTextContent("3");
  });

  it("menú móvil: alterna el estado expuesto en aria-expanded", async () => {
    const user = userEvent.setup();
    renderShell("admin");
    expect(await screen.findByRole("link", { name: "Usuarios" })).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Menú" });
    // En jsdom no aplica la CSS de Tailwind (hidden): el estado real del menú
    // se expone en aria-expanded, que es lo que se verifica.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  // sdd/admin-console T-E1 — ADM-11: el `premium` del contexto se vuelve
  // visible en el shell junto al badge de rol, con la gate D7 (is_premium()
  // = premium OR admin, 0004:39-48).
  it("ADM-11.1: premium true ⇒ insignia «Premium» visible junto al rol", async () => {
    renderShell("operador", true);

    expect(await screen.findByText("Premium")).toBeInTheDocument();
    expect(screen.getByText("Operador")).toBeInTheDocument();
  });

  it("ADM-11.2: premium false sin rol admin ⇒ sin insignia", async () => {
    renderShell("operador", false);

    expect(await screen.findByRole("link", { name: "Inventario" })).toBeInTheDocument();
    expect(screen.queryByText("Premium")).not.toBeInTheDocument();
  });

  it("ADM-11.3: admin con premium false ⇒ la insignia SÍ se ve (exención D7)", async () => {
    renderShell("admin", false);

    expect(await screen.findByText("Premium")).toBeInTheDocument();
    expect(screen.getByText("Administrador")).toBeInTheDocument();
  });
});
