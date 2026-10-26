import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../features/auth/types";
import * as authApi from "../../features/auth/api";
import { AuthProvider } from "../providers/AuthProvider";
import { HomePage } from "./HomePage";

vi.mock("../../features/auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

function renderHome(role: RoleName | null) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter>
      <AuthProvider>
        <HomePage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("HomePage · vista de ejemplo del distribuidor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("distribuidor: muestra pedidos, paradas y ruta de hoy, marcado como ejemplo", async () => {
    renderHome("distribuidor");

    expect(await screen.findByText("Tu día, de un vistazo")).toBeInTheDocument();
    expect(screen.getByText("Vista de ejemplo")).toBeInTheDocument();
    expect(screen.getByText("Pedidos")).toBeInTheDocument();
    expect(screen.getByText("Paradas")).toBeInTheDocument();
    expect(screen.getByText("Ruta de hoy")).toBeInTheDocument();
    expect(screen.getByText("Tienda Central")).toBeInTheDocument();
    expect(screen.queryByText("Stock bajo")).not.toBeInTheDocument();
  });

  it("operador: conserva el inicio actual sin la vista del distribuidor", async () => {
    renderHome("operador");

    expect(
      await screen.findByRole("heading", { name: "Bienvenido a FARØX" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Tu día, de un vistazo")).not.toBeInTheDocument();
    expect(screen.queryByText("Vista de ejemplo")).not.toBeInTheDocument();
  });
});
