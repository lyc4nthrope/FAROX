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

function renderHome(role: RoleName | null, premium = false) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium });
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

  it("distribuidor: no muestra la vista de ejemplo en el inicio", async () => {
    renderHome("distribuidor");

    expect(await screen.findByRole("heading", { name: "Bienvenido a FARØX" })).toBeInTheDocument();
    expect(screen.queryByText("Tu día, de un vistazo")).not.toBeInTheDocument();
    expect(screen.queryByText("Vista de ejemplo")).not.toBeInTheDocument();
    expect(screen.queryByText("Tienda Central")).not.toBeInTheDocument();
    // Las secciones reales siguen disponibles.
    expect(screen.getByText("Mi ruta")).toBeInTheDocument();
  });

  it("operador: conserva el inicio actual sin la vista del distribuidor", async () => {
    renderHome("operador");

    expect(await screen.findByRole("heading", { name: "Bienvenido a FARØX" })).toBeInTheDocument();
    expect(screen.queryByText("Tu día, de un vistazo")).not.toBeInTheDocument();
    expect(screen.queryByText("Vista de ejemplo")).not.toBeInTheDocument();
  });

  it("ADM-11.1: con Premium la cabecera muestra la insignia y el título sigue solo", async () => {
    renderHome("operador", true);

    expect(await screen.findByText("Premium")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bienvenido a FARØX" })).toBeInTheDocument();
  });
});
