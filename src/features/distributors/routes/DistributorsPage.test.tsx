import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as distributorsApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { RequireRole } from "../../../app/guards/RequireRole";
import { DistributorsPage } from "./DistributorsPage";

// D7 (componente, api de la feature mockeada COMPLETA): los escenarios de
// lectura de DIST-1 (spec #483 S4). Cero red, cero supabase (el módulo real
// importa el cliente, que valida env en el arranque — V0-1).
vi.mock("../api", () => ({
  fetchDistributors: vi.fn(),
  fetchDistributor: vi.fn(),
  createDistributor: vi.fn(),
  updateDistributor: vi.fn(),
  deactivateDistributor: vi.fn(),
  deleteDistributor: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const FILA = { id: 1, name: "Distribuidora Andes", nit: "900123456", is_active: true };

// Forma REAL de una denegación PostgREST/RLS: SQLSTATE 42501 en `code`
// (misma forma canónica que mapError.test.ts / useList.test.tsx). Variable
// porque el literal con `code` chocaría con el excess-property check de TS.
const ERROR_RLS = { code: "42501", message: "permission denied for table distributors" };

function renderPagina(role: RoleName) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={["/distributors"]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/distributors"
            element={
              <RequireRole roles={["admin", "operador"]}>
                <DistributorsPage />
              </RequireRole>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("DistributorsPage (DIST-1 · §S2 fila /distributors)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(distributorsApi.fetchDistributors).mockResolvedValue({
      rows: [FILA],
      count: 1,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("admin: filas visibles con nombre, NIT y estado; control Nuevo (SEC-01 idea:119)", async () => {
    renderPagina("admin");

    expect(await screen.findByRole("link", { name: "Distribuidora Andes" })).toBeInTheDocument();
    expect(screen.getByText("900123456")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    // Control dependiente del rol (admin): la sesión resuelve de forma
    // asíncrona, así que se espera con findBy.
    expect(await screen.findByRole("link", { name: "Nuevo distribuidor" })).toBeInTheDocument();
    expect(distributorsApi.fetchDistributors).toHaveBeenCalledTimes(1);
  });

  it("operador: lista visible pero sin controles de escritura (DIST-1 read-only)", async () => {
    renderPagina("operador");

    expect(await screen.findByRole("link", { name: "Distribuidora Andes" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nuevo distribuidor" })).not.toBeInTheDocument();
  });

  it("lista vacía SIN error ⇒ EmptyState, nunca banner (vacío ≠ error, D4)", async () => {
    vi.mocked(distributorsApi.fetchDistributors).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    renderPagina("admin");

    expect(await screen.findByText("No hay distribuidores todavía")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("error del backend ⇒ banner amigable; el texto crudo NUNCA llega (HARD-1)", async () => {
    vi.mocked(distributorsApi.fetchDistributors).mockResolvedValue({
      rows: [],
      count: null,
      error: ERROR_RLS,
    });
    renderPagina("admin");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });

  it("distribuidor: denegado ANTES de montar — cero llamadas de datos (§S2 / DIST-1)", async () => {
    renderPagina("distribuidor");

    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(distributorsApi.fetchDistributors).not.toHaveBeenCalled();
  });
});
