import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as rolesApi from "../api";
import type { RoleListRow } from "../types";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { RequireRole } from "../../../app/guards/RequireRole";
import { RolesPage } from "./RolesPage";

// sdd/admin-console T-C2 + T-B10 (ADM-8.3/8.5): lista /roles con el api de
// la feature mockeado COMPLETO y fetchPrivileges mockeado por rol (patrón
// StoresPage.test.tsx:56-57) — NINGÚN test depende de un admin real (R4/B0).
// Cero red real: los errores se inyectan con su forma canónica.
vi.mock("../api", () => ({
  fetchRoles: vi.fn(),
  fetchRole: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const ADMIN_SEED: RoleListRow = {
  id: 1,
  name: "admin",
  description: "Acceso total: catálogos, usuarios, override de edición",
};
const OPERADOR_SEED: RoleListRow = {
  id: 2,
  name: "operador",
  description: "Ejecución con alcance por tienda (user_stores)",
};
// Rol LEGACY fuera de ROLE_NAMES (R3): normalizeRole lo degrada a null.
const LEGACY: RoleListRow = {
  id: 4,
  name: "supervisor",
  description: "Rol viejo de otra época",
};

// Forma REAL de una denegación PostgREST/RLS: SQLSTATE 42501 en `code`.
// Variable porque el literal con `code` chocaría con el excess-property check.
const ERROR_RLS = { code: "42501", message: "permission denied for table roles" };

function renderPagina(role: RoleName = "admin") {
  vi.mocked(authApi.getSession).mockResolvedValue({
    userId: "u1",
    email: "demo@farox.app",
  });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={["/roles"]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/roles"
            element={
              <RequireRole roles={["admin"]}>
                <RolesPage />
              </RequireRole>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RolesPage (ADM-8 · lista /roles)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(rolesApi.fetchRoles).mockResolvedValue({
      rows: [ADMIN_SEED, OPERADOR_SEED, LEGACY],
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("pinta la lista de roles con sus descripciones", async () => {
    renderPagina();

    expect(await screen.findByText("admin")).toBeInTheDocument();
    expect(screen.getByText("operador")).toBeInTheDocument();
    expect(
      screen.getByText("Rol viejo de otra época"),
    ).toBeInTheDocument();
    expect(rolesApi.fetchRoles).toHaveBeenCalledTimes(1);
  });

  it("ADM-8.3: el rol legacy «supervisor» muestra el chip de aviso R3", async () => {
    renderPagina();

    const supervisor = await screen.findByRole("link", { name: "supervisor" });
    const fila = supervisor.closest("tr");
    expect(fila).not.toBeNull();
    expect(
      screen.getByText("Rol no reconocido: degrada a «sin rol»"),
    ).toBeInTheDocument();
  });

  it("ADM-8.5: las filas semilla NO tienen link, ni botones de renombrar/borrar", async () => {
    renderPagina();

    const admin = await screen.findByText("admin");
    const filaAdmin = admin.closest("tr");
    expect(filaAdmin).not.toBeNull();
    expect(filaAdmin?.querySelector("a")).toBeNull();
    // Ninguna fila de la lista ofrece controles de renombrar ni borrar: el
    // único link de la tabla es el del rol legacy (cleanup path).
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/eliminar|borrar/i)).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(2); // supervisor + «Nuevo rol»
  });

  it("ofrece «Nuevo rol» hacia /roles/new (ADM-8.1 la vía de alta)", async () => {
    renderPagina();

    expect(
      await screen.findByRole("link", { name: "Nuevo rol" }),
    ).toHaveAttribute("href", "/roles/new");
  });

  it("sin roles ⇒ estado vacío amigable, vacío NO es error", async () => {
    vi.mocked(rolesApi.fetchRoles).mockResolvedValue({ rows: [], error: null });
    renderPagina();

    expect(
      await screen.findByText("Todavía no hay roles cargados."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("error de la query (42501) ⇒ ErrorBanner con mapError, jamás texto crudo", async () => {
    vi.mocked(rolesApi.fetchRoles).mockResolvedValue({
      rows: [],
      error: ERROR_RLS,
    });
    renderPagina();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByText(/permission denied/)).toBeNull();
  });

  it("ADM-12.3/R4: operador denegado ⇒ AccessDenied sin UNA sola query de la feature", async () => {
    renderPagina("operador");

    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(rolesApi.fetchRoles).not.toHaveBeenCalled();
  });
});
