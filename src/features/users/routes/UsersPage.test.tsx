import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as usersApi from "../api";
import type { UserListRow } from "../types";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { RequireRole } from "../../../app/guards/RequireRole";
import { UsersPage } from "./UsersPage";

// sdd/admin-console T-B4 + T-B10 (ADM-3): lista /users con el api de la
// feature mockeado COMPLETO y fetchPrivileges mockeado por rol (patrón
// StoresPage.test.tsx:56-57) — NINGÚN test depende de un admin real (R4/B0).
// Cero red real: los errores se inyectan con su forma canónica.
vi.mock("../api", () => ({
  fetchUsers: vi.fn(),
  fetchUser: vi.fn(),
  updateUserProfile: vi.fn(),
  updateUserRole: vi.fn(),
  setUserPremium: vi.fn(),
  setUserActive: vi.fn(),
  fetchUserStores: vi.fn(),
  fetchUserStoreCounts: vi.fn(),
  fetchDistributorOptions: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

// store_count lo pisa UsersPage con la query de apoyo (FLAG-4): el valor del
// fetcher es siempre null y el número llega de fetchUserStoreCounts.
const OMAR: UserListRow = {
  id: "u2",
  email: "omar@farox.app",
  full_name: "Omar Prueba",
  premium: true,
  is_active: true,
  role_name: "operador",
  store_count: null,
};

const VERA: UserListRow = {
  id: "u3",
  email: "vera@farox.app",
  full_name: "Vera Vendedora",
  premium: false,
  is_active: false,
  role_name: "distribuidor",
  store_count: null,
};

// Forma REAL de una denegación PostgREST/RLS: SQLSTATE 42501 en `code`
// (misma forma canónica que mapError.test.ts). Variable porque el literal con
// `code` chocaría con el excess-property check de TS.
const ERROR_RLS = { code: "42501", message: "permission denied for table users" };
// Mismo motivo: literal con `code` en variable (excess-property check de TS,
// patrón StoresPage.test.tsx:49).
const ERROR_SIN_GRANT = {
  code: "42P01",
  message: "relation user_stores does not exist",
};

// El harness replica la ruta DEL ROUTER REAL: /users exige admin (ADM-3.3 —
// la denegación antes de montar se prueba en router.test, T-B9). RequireRole
// además resuelve el rol ANTES de montar el contenedor.
function renderPagina(role: RoleName = "admin") {
  vi.mocked(authApi.getSession).mockResolvedValue({
    userId: "u1",
    email: "demo@farox.app",
  });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={["/users"]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/users"
            element={
              <RequireRole roles={["admin"]}>
                <UsersPage />
              </RequireRole>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("UsersPage (ADM-3 · lista admin de /users)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(usersApi.fetchUsers).mockResolvedValue({
      rows: [OMAR, VERA],
      count: 2,
      error: null,
    });
    vi.mocked(usersApi.fetchUserStoreCounts).mockResolvedValue({
      counts: { u2: 3, u3: 0 },
      error: null,
    });
    // Queries del detalle que este árbol NO monta: por las dudas, jamás reales.
    vi.mocked(usersApi.fetchUser).mockResolvedValue({ row: null, error: null });
    vi.mocked(usersApi.fetchUserStores).mockResolvedValue({ rows: [], error: null });
    vi.mocked(usersApi.fetchDistributorOptions).mockResolvedValue({
      options: [],
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("ADM-3.1: pinta nombre (link), email, insignia de rol, premium y estado", async () => {
    renderPagina();

    const link = await screen.findByRole("link", { name: "Omar Prueba" });
    const fila = link.closest("tr");
    expect(fila).not.toBeNull();
    const omar = within(fila as HTMLElement);
    expect(omar.getByText("omar@farox.app")).toBeInTheDocument();
    expect(omar.getByText("Operador")).toBeInTheDocument(); // insignia de rol
    expect(omar.getByText("Premium")).toBeInTheDocument();
    expect(omar.getByText("Activo")).toBeInTheDocument();

    // Segunda fila con los valores opuestos (premium ✘, inactiva).
    const linkVera = screen.getByRole("link", { name: "Vera Vendedora" });
    const vera = within(linkVera.closest("tr") as HTMLElement);
    expect(vera.getByText("Distribuidor")).toBeInTheDocument();
    expect(vera.getByText("Inactivo")).toBeInTheDocument();
    expect(vera.queryByText("Premium")).toBeNull();
    expect(usersApi.fetchUsers).toHaveBeenCalledTimes(1);
  });

  it("ADM-3.2: la columna Tiendas muestra el conteo de la query de apoyo", async () => {
    renderPagina();

    const link = await screen.findByRole("link", { name: "Omar Prueba" });
    const omar = within(link.closest("tr") as HTMLElement);
    expect(omar.getByText("3")).toBeInTheDocument();

    const linkVera = screen.getByRole("link", { name: "Vera Vendedora" });
    const vera = within(linkVera.closest("tr") as HTMLElement);
    expect(vera.getByText("0")).toBeInTheDocument();
    expect(usersApi.fetchUserStoreCounts).toHaveBeenCalledTimes(1);
  });

  it("ADM-3.2: la lista NO ofrece controles de creación ni de borrado de usuarios (D3)", async () => {
    renderPagina();

    expect(await screen.findByRole("link", { name: "Omar Prueba" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link", { name: /nuevo|crear|agregar/i })).toBeNull();
    expect(screen.queryByText(/eliminar|borrar/i)).toBeNull();
  });

  it("ADM-3.4: sin usuarios ⇒ estado vacío amigable, vacío NO es error", async () => {
    vi.mocked(usersApi.fetchUsers).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    renderPagina();

    expect(
      await screen.findByText("Todavía no hay usuarios registrados."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("error de la query (42501) ⇒ ErrorBanner con mapError, jamás texto crudo", async () => {
    vi.mocked(usersApi.fetchUsers).mockResolvedValue({
      rows: [],
      count: null,
      error: ERROR_RLS,
    });
    renderPagina();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByText(/permission denied/)).toBeNull();
  });

  it("FLAG-4: si la query de conteo falla, la columna «Tiendas» degrada a «—» sin romper la lista", async () => {
    vi.mocked(usersApi.fetchUserStoreCounts).mockResolvedValue({
      counts: null,
      error: ERROR_SIN_GRANT,
    });
    renderPagina();

    const link = await screen.findByRole("link", { name: "Omar Prueba" });
    const omar = within(link.closest("tr") as HTMLElement);
    expect(omar.getByText("—")).toBeInTheDocument();
    // La lista sigue viva: sin ErrorBanner (el error crudo jamás se renderiza).
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: "Vera Vendedora" })).toBeInTheDocument();
  });

  it("ADM-3.3/R4: operador denegado ⇒ AccessDenied sin UNA sola query de la feature", async () => {
    renderPagina("operador");

    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(usersApi.fetchUsers).not.toHaveBeenCalled();
    expect(usersApi.fetchUserStoreCounts).not.toHaveBeenCalled();
  });
});
