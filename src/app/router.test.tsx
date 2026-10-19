import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../features/auth/types";
import * as authApi from "../features/auth/api";
import * as distributorsApi from "../features/distributors/api";
import * as profileApi from "../features/profile/api";
import { AuthProvider } from "./providers/AuthProvider";
import { AppRoutes } from "./router";

vi.mock("../features/auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));
// B5 (T5.2): /distributors ya no es placeholder — el api de la feature se
// mockea COMPLETO como en el resto de los tests: sin esto, el módulo real
// importa el cliente supabase, que valida el env en el arranque (V0-1).
vi.mock("../features/distributors/api", () => ({
  fetchDistributors: vi.fn(),
  fetchDistributor: vi.fn(),
  createDistributor: vi.fn(),
  updateDistributor: vi.fn(),
  deactivateDistributor: vi.fn(),
  deleteDistributor: vi.fn(),
}));
vi.mock("../features/profile/api", () => ({
  fetchMyProfile: vi.fn(),
  updateMyProfile: vi.fn(),
}));

const SESSION = { userId: "u1", email: "demo@farox.app" };

function conSesion(role: RoleName | null) {
  vi.mocked(authApi.getSession).mockResolvedValue(SESSION);
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
}

function renderRuta(ruta: string) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AppRoutes (V0-2/V0-4/§S2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(profileApi.fetchMyProfile).mockResolvedValue({
      row: {
        full_name: "Ada Lovelace",
        phone_number: "555-1234",
        contact_preference: "whatsapp",
      },
      error: null,
    });
    vi.mocked(profileApi.updateMyProfile).mockResolvedValue({ error: null });
    vi.mocked(distributorsApi.fetchDistributors).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(distributorsApi.fetchDistributor).mockResolvedValue({ row: null, error: null });
    conSesion("admin");
  });

  afterEach(() => {
    cleanup();
  });

  it("anónimo en una ruta de datos: cae en /login con cero llamadas de datos (V0-2)", async () => {
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    renderRuta("/stores");
    expect(await screen.findByText("Iniciar sesión")).toBeInTheDocument();
    expect(authApi.fetchPrivileges).not.toHaveBeenCalled();
  });

  it("cada ruta §S2 resuelve pantalla o placeholder explícito, nunca en blanco (V0-4)", async () => {
    const rutas = [
      "/",
      "/distributors",
      "/distributors/new",
      "/distributors/1",
      "/products",
      "/products/new",
      "/products/1",
      "/stores",
      "/stores/new",
      "/stores/1",
      "/users",
      "/profile",
    ];
    for (const ruta of rutas) {
      renderRuta(ruta);
      const main = await screen.findByRole("main");
      expect(main.textContent?.length, `ruta ${ruta}`).toBeGreaterThan(0);
      cleanup();
    }
  });

  it("ruta desconocida: placeholder explícito (V0-4)", async () => {
    renderRuta("/ruta/que/no/existe");
    expect(await screen.findByText("Página no encontrada")).toBeInTheDocument();
  });

  it("§S2: operador con /users por URL directa → denegado", async () => {
    conSesion("operador");
    renderRuta("/users");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
  });

  it("§S2: distribuidor con /stores por URL directa → denegado (SEC-01 tiendas NO)", async () => {
    conSesion("distribuidor");
    renderRuta("/stores");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
  });

  it("sesionado en /login: redirige al home con el rol visible", async () => {
    renderRuta("/login");
    const main = await screen.findByRole("main");
    expect(main).toHaveTextContent("Sesión iniciada como Administrador");
  });
});
