import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as productsApi from "../api";
import type { ProductListRow } from "../types";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { ProductsPage } from "./ProductsPage";

// D7 (componente, api de la feature mockeada COMPLETA): los escenarios de
// lectura de PROD-1 (spec #483 S5). Cero red, cero supabase (el módulo real
// importa el cliente, que valida env en el arranque — V0-1).
vi.mock("../api", () => ({
  fetchProducts: vi.fn(),
  fetchProduct: vi.fn(),
  fetchBrands: vi.fn(),
  fetchUnitTypes: vi.fn(),
  fetchProductCategories: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deactivateProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

// Fila tal como la pinta ProductList con los embeds del listado (marca /
// unidad / categoría en 1 request — Base:698, sin N+1).
const FILA: ProductListRow = {
  id: 1,
  name: "Café molido",
  is_active: true,
  brand: { id: 1, name: "Andina" },
  unit: { id: 2, name: "Gramos" },
  category: { id: 1, name: "Bebidas" },
};

// Forma REAL de una denegación PostgREST/RLS: SQLSTATE 42501 en `code`
// (misma forma canónica que mapError.test.ts / useList.test.tsx). Variable
// porque el literal con `code` chocaría con el excess-property check de TS.
const ERROR_RLS = { code: "42501", message: "permission denied for table products" };

function renderPagina(role: RoleName) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={["/products"]}>
      <AuthProvider>
        <Routes>
          <Route path="/products" element={<ProductsPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ProductsPage (PROD-1 · §S2 fila /products)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(productsApi.fetchProducts).mockResolvedValue({
      rows: [FILA],
      count: 1,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("admin: fila con marca/unidad/categoría y estado + control Nuevo (PROD-1 / SEC-01 idea:113)", async () => {
    renderPagina("admin");

    expect(await screen.findByRole("link", { name: "Café molido" })).toBeInTheDocument();
    expect(screen.getByText("Andina")).toBeInTheDocument();
    expect(screen.getByText("Gramos")).toBeInTheDocument();
    expect(screen.getByText("Bebidas")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    // Control dependiente del rol (admin): la sesión resuelve de forma
    // asíncrona, así que se espera con findBy.
    expect(await screen.findByRole("link", { name: "Nuevo producto" })).toBeInTheDocument();
    // 1 sola petición de listado y CERO pedidos de catálogo: los nombres
    // vienen embebidos (Base:698) — PROD-1 "one request… no N+1".
    expect(productsApi.fetchProducts).toHaveBeenCalledTimes(1);
    expect(productsApi.fetchBrands).not.toHaveBeenCalled();
    expect(productsApi.fetchUnitTypes).not.toHaveBeenCalled();
    expect(productsApi.fetchProductCategories).not.toHaveBeenCalled();
  });

  it("operador: filas visibles y también puede crear (SEC-01 idea:113 ✔ crear)", async () => {
    renderPagina("operador");

    expect(await screen.findByRole("link", { name: "Café molido" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Nuevo producto" })).toBeInTheDocument();
  });

  it("distribuidor: catálogo legible SIN control de alta (SEC-01 idea:113 solo lectura)", async () => {
    renderPagina("distribuidor");

    expect(await screen.findByRole("link", { name: "Café molido" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nuevo producto" })).not.toBeInTheDocument();
  });

  it("lista vacía SIN error ⇒ EmptyState, nunca banner (vacío ≠ error, PROD-1)", async () => {
    vi.mocked(productsApi.fetchProducts).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    renderPagina("operador");

    expect(await screen.findByText("No hay productos todavía")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("error del backend ⇒ banner amigable; el texto crudo NUNCA llega (HARD-1)", async () => {
    vi.mocked(productsApi.fetchProducts).mockResolvedValue({
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
