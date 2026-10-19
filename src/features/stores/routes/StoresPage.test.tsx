import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as storesApi from "../api";
import type { StoreListRow } from "../types";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { RequireRole } from "../../../app/guards/RequireRole";
import { StoresPage } from "./StoresPage";

// D7 (componente, api de la feature mockeada COMPLETA): los escenarios de
// lectura de STORE-2 (spec #483 S6). Cero red, cero supabase (el módulo real
// importa el cliente, que valida env en el arranque — V0-1).
vi.mock("../api", () => ({
  fetchStores: vi.fn(),
  fetchStore: vi.fn(),
  fetchStoreGeo: vi.fn(),
  fetchStoreTypes: vi.fn(),
  createStore: vi.fn(),
  updateStore: vi.fn(),
  deactivateStore: vi.fn(),
  deleteStore: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

// Fila tal como la pinta StoreList: lat/lng YA computados por la vista
// stores_geo en el servidor (0004:1546-1547 — st_x ⇒ lng, st_y ⇒ lat); el
// front jamás ejecuta ST_X/ST_Y (Base:165, STORE-2).
const FILA: StoreListRow = {
  id: 1,
  name: "Tienda Centro",
  city: "Bogotá",
  is_active: true,
  lat: 4.6097,
  lng: -74.0631,
};

// Forma REAL de una denegación PostgREST/RLS: SQLSTATE 42501 en `code`
// (misma forma canónica que mapError.test.ts / useList.test.tsx). Variable
// porque el literal con `code` chocaría con el excess-property check de TS.
const ERROR_RLS = { code: "42501", message: "permission denied for table stores_geo" };

// El harness replica las rutas DEL ROUTER REAL (B7): /stores exige
// admin|operador — distribuidor es ✘ total en tiendas (SEC-01 idea:114, §S2
// "distribuidor NO"). RequireRole además resuelve el rol ANTES de montar el
// contenedor, que es lo que hace estable el scope mine/all.
function renderPagina(role: RoleName) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={["/stores"]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/stores"
            element={
              <RequireRole roles={["admin", "operador"]}>
                <StoresPage />
              </RequireRole>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("StoresPage (STORE-2 · §S2 fila /stores)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(storesApi.fetchStores).mockResolvedValue({
      rows: [FILA],
      count: 1,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("admin: fila con ciudad/lat/lng/estado + control Nueva; scope ALL (§S2)", async () => {
    renderPagina("admin");

    expect(await screen.findByRole("link", { name: "Tienda Centro" })).toBeInTheDocument();
    expect(screen.getByText("Bogotá")).toBeInTheDocument();
    // Las coordenadas se pintan TAL CUAL las trae stores_geo (números, con el
    // signo correcto) — STORE-2 "each row's lat/lng comes from the view".
    expect(screen.getByText("4.6097")).toBeInTheDocument();
    expect(screen.getByText("-74.0631")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    // Control dependiente del rol (admin): la sesión resuelve de forma
    // asíncrona, así que se espera con findBy.
    expect(await screen.findByRole("link", { name: "Nueva tienda" })).toBeInTheDocument();
    // 1 sola petición de listado y scope "all": el admin NO pide my_store_ids.
    expect(storesApi.fetchStores).toHaveBeenCalledTimes(1);
    const [, scope] = vi.mocked(storesApi.fetchStores).mock.calls[0];
    expect(scope).toBe("all");
  });

  it("operador: filas visibles, puede crear y el scope es MINE (§S2 'operador own')", async () => {
    renderPagina("operador");

    expect(await screen.findByRole("link", { name: "Tienda Centro" })).toBeInTheDocument();
    // SEC-01 idea:114: operador ✔ crear — ver su propio alcance (el filtro
    // aplica la capa api con my_store_ids, 00_foundation.sql:167-174).
    expect(await screen.findByRole("link", { name: "Nueva tienda" })).toBeInTheDocument();
    const [, scope] = vi.mocked(storesApi.fetchStores).mock.calls[0];
    expect(scope).toBe("mine");
  });

  it("distribuidor: denegado ANTES de montar — cero llamadas (SEC-01 idea:114 ✘)", async () => {
    renderPagina("distribuidor");

    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(storesApi.fetchStores).not.toHaveBeenCalled();
  });

  it("lista vacía SIN error ⇒ EmptyState, nunca banner (vacío ≠ error, STORE-2)", async () => {
    vi.mocked(storesApi.fetchStores).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    renderPagina("operador");

    expect(await screen.findByText("No hay tiendas todavía")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("error del backend ⇒ banner amigable; el texto crudo NUNCA llega (HARD-1)", async () => {
    vi.mocked(storesApi.fetchStores).mockResolvedValue({
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
});
