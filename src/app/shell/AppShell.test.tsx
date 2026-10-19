import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../features/auth/types";
import * as authApi from "../../features/auth/api";
import { AuthProvider } from "../providers/AuthProvider";
import { AppShell } from "./AppShell";

vi.mock("../../features/auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

function renderShell(role: RoleName | null) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
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
  });

  afterEach(() => {
    cleanup();
  });

  it("operador: distribuidores, productos y tiendas; sin /users", async () => {
    renderShell("operador");
    expect(await screen.findByRole("link", { name: "Distribuidores" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Productos" })).toBeInTheDocument();
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
});
