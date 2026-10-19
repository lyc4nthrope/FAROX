import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../features/auth/api";
import { AuthProvider } from "../providers/AuthProvider";
import { RequireAuth } from "./RequireAuth";

// La capa api se mockea COMPLETA: el cliente supabase (con su validación de
// env a nivel de módulo) jamás se carga en un test.
vi.mock("../../features/auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

function renderRuta(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>pantalla de login</p>} />
          <Route element={<RequireAuth />}>
            <Route path="/privada" element={<p>contenido privado</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RequireAuth (V0-2: sin sesión → /login con cero llamadas de datos)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: null, premium: false });
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("anon: redirige a /login y NO pide privilegios", async () => {
    renderRuta("/privada");
    expect(await screen.findByText("pantalla de login")).toBeInTheDocument();
    expect(screen.queryByText("contenido privado")).not.toBeInTheDocument();
    expect(authApi.fetchPrivileges).not.toHaveBeenCalled();
  });

  it("cargando: muestra espera, sin parpadeo a /login", () => {
    vi.mocked(authApi.getSession).mockReturnValue(new Promise<never>(() => {}));
    renderRuta("/privada");
    expect(screen.getByText(/Cargando sesión/)).toBeInTheDocument();
    expect(screen.queryByText("pantalla de login")).not.toBeInTheDocument();
  });

  it("autenticado: renderiza la ruta protegida", async () => {
    vi.mocked(authApi.getSession).mockResolvedValue({
      userId: "u1",
      email: "demo@farox.app",
    });
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "operador", premium: false });
    renderRuta("/privada");
    expect(await screen.findByText("contenido privado")).toBeInTheDocument();
    expect(authApi.fetchPrivileges).toHaveBeenCalledTimes(1);
  });
});
