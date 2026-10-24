import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as productsApi from "../api";
import type { ProductListRow, ProductRow } from "../types";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { RequireRole } from "../../../app/guards/RequireRole";
import { ProductFormPage } from "./ProductFormPage";
import { ProductsPage } from "./ProductsPage";

// D7 (componente, api de la feature mockeada COMPLETA): los escenarios de
// escritura de PROD-2/PROD-3 (spec #483 S5). /products usa la página REAL
// para probar "la fila aparece en la lista tras el refetch" (HARD-3, D4).
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

const P1: ProductRow = {
  id: 1,
  name: "Café molido",
  description: "Tueste medio",
  category_id: 1,
  brand_id: 1,
  unit_type_id: 2,
  base_quantity: 1.5,
  barcode: null,
};

// Fila del listado tras el refetch (embeds resueltos — Base:698).
const FILA_NUEVA: ProductListRow = {
  id: 7,
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

// Las rutas del harness son las MISMAS del router real (B6): /products abierto
// a todo rol, /products/new con RequireRole, /products/:id legible por todos.
function renderRutas(entrada: string, role: RoleName) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <AuthProvider>
        <Routes>
          <Route path="/products" element={<ProductsPage />} />
          <Route
            path="/products/new"
            element={
              <RequireRole roles={["admin", "operador"]}>
                <ProductFormPage />
              </RequireRole>
            }
          />
          <Route path="/products/:id" element={<ProductFormPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// El botón de envío solo existe con el rol escritor YA resuelto y los
// catálogos cargados: esperarlo ANTES de tipear evita escribir en inputs
// todavía deshabilitados (carrera con la resolución asíncrona de AuthProvider,
// lección #509 aplicada al patrón de B5).
async function completarAlta(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByRole("button", { name: "Crear producto" });
  await user.type(screen.getByLabelText("Nombre"), "Café molido");
  await user.selectOptions(screen.getByLabelText("Marca"), "1");
  await user.selectOptions(screen.getByLabelText("Unidad de medida"), "2");
  await user.selectOptions(screen.getByLabelText("Categoría"), "1");
  await user.type(screen.getByLabelText("Cantidad base"), "1.5");
}

describe("ProductFormPage (PROD-2/PROD-3 · §S2 fila Product form)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(productsApi.fetchProducts).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(productsApi.fetchProduct).mockResolvedValue({ row: null, error: null });
    vi.mocked(productsApi.fetchBrands).mockResolvedValue({
      rows: [{ id: 1, name: "Andina" }],
      error: null,
    });
    vi.mocked(productsApi.fetchUnitTypes).mockResolvedValue({
      rows: [{ id: 2, name: "Gramos" }],
      error: null,
    });
    vi.mocked(productsApi.fetchProductCategories).mockResolvedValue({
      rows: [{ id: 1, name: "Bebidas" }],
      error: null,
    });
    vi.mocked(productsApi.createProduct).mockResolvedValue({ error: null });
    vi.mocked(productsApi.updateProduct).mockResolvedValue({ error: null });
    vi.mocked(productsApi.deactivateProduct).mockResolvedValue({ error: null });
    vi.mocked(productsApi.deleteProduct).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("admin crea un producto y la fila aparece en la lista tras el refetch (PROD-2)", async () => {
    // 1.er mount de la lista: vacía. Tras crear, el re-entrada de la ruta
    // vuelve a pedir y ahora la fila existe (refetch, sin realtime).
    vi.mocked(productsApi.fetchProducts).mockResolvedValueOnce({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(productsApi.fetchProducts).mockResolvedValueOnce({
      rows: [FILA_NUEVA],
      count: 1,
      error: null,
    });
    const user = userEvent.setup();
    renderRutas("/products", "admin");

    expect(await screen.findByText("No hay productos todavía")).toBeInTheDocument();
    // El control depende del rol (admin): esperarlo con findBy porque la
    // sesión resuelve de forma asíncrona (AuthProvider → fetchPrivileges).
    await user.click(await screen.findByRole("link", { name: "Nuevo producto" }));

    await completarAlta(user);
    await user.click(await screen.findByRole("button", { name: "Crear producto" }));

    expect(await screen.findByRole("link", { name: "Café molido" })).toBeInTheDocument();
    expect(productsApi.createProduct).toHaveBeenCalledTimes(1);
    const [values] = vi.mocked(productsApi.createProduct).mock.calls[0];
    expect(values).toEqual({
      name: "Café molido",
      description: "",
      brand_id: "1",
      unit_type_id: "2",
      category_id: "1",
      base_quantity: "1.5",
      barcode: "",
    });
    expect(productsApi.fetchProducts).toHaveBeenCalledTimes(2);
  });

  it("operador con alcance: la creación tiene éxito y la fila aparece (PROD-2)", async () => {
    // El alcance es de la DB (has_scope, 0006:146-149): acá se prueba el
    // camino de éxito — el backend no deniega y la UI navega al listado.
    vi.mocked(productsApi.fetchProducts).mockResolvedValueOnce({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(productsApi.fetchProducts).mockResolvedValueOnce({
      rows: [FILA_NUEVA],
      count: 1,
      error: null,
    });
    const user = userEvent.setup();
    renderRutas("/products", "operador");

    expect(await screen.findByText("No hay productos todavía")).toBeInTheDocument();
    await user.click(await screen.findByRole("link", { name: "Nuevo producto" }));

    await completarAlta(user);
    await user.click(await screen.findByRole("button", { name: "Crear producto" }));

    expect(await screen.findByRole("link", { name: "Café molido" })).toBeInTheDocument();
    expect(productsApi.createProduct).toHaveBeenCalledTimes(1);
  });

  it("campos obligatorios vacíos: errores inline y CERO requests (PROD-3 / idea:198)", async () => {
    const user = userEvent.setup();
    renderRutas("/products/new", "admin");

    await user.click(await screen.findByRole("button", { name: "Crear producto" }));

    expect(await screen.findByText("Ingresá el nombre del producto")).toBeInTheDocument();
    expect(screen.getByText("Elegí una marca")).toBeInTheDocument();
    expect(screen.getByText("Elegí la unidad de medida")).toBeInTheDocument();
    expect(screen.getByText("Elegí una categoría")).toBeInTheDocument();
    expect(screen.getByText("Ingresá una cantidad mayor a cero")).toBeInTheDocument();
    expect(productsApi.createProduct).not.toHaveBeenCalled();
  });

  it("cantidad inválida (0): error inline y CERO requests (Zod, idea:198)", async () => {
    const user = userEvent.setup();
    renderRutas("/products/new", "admin");

    await user.click(await screen.findByRole("button", { name: "Crear producto" }));
    await user.type(screen.getByLabelText("Nombre"), "Café molido");
    await user.selectOptions(screen.getByLabelText("Marca"), "1");
    await user.selectOptions(screen.getByLabelText("Unidad de medida"), "2");
    await user.selectOptions(screen.getByLabelText("Categoría"), "1");
    await user.type(screen.getByLabelText("Cantidad base"), "0");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    expect(await screen.findByText("Ingresá una cantidad mayor a cero")).toBeInTheDocument();
    expect(productsApi.createProduct).not.toHaveBeenCalled();
  });

  it("operador sin alcance (42501): mensaje amigable, nunca un falso éxito (PROD-2)", async () => {
    // Sin pre-check de has_scope en el cliente (D2): el create se envía igual
    // y la policy products_insert (0006:146-149) lo deniega con 42501 real.
    vi.mocked(productsApi.createProduct).mockResolvedValue({ error: ERROR_RLS });
    const user = userEvent.setup();
    renderRutas("/products/new", "operador");

    await completarAlta(user);
    await user.click(await screen.findByRole("button", { name: "Crear producto" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
    // Sigo en el formulario: no hubo navegación de éxito ni refetch de lista.
    expect(screen.getByRole("button", { name: "Crear producto" })).toBeInTheDocument();
    expect(productsApi.fetchProducts).not.toHaveBeenCalled();
  });

  it("producto ajeno (operador): update denegado ⇒ amigable, sin navegación (PROD-2)", async () => {
    // El operador abre cualquier producto (lectura con USING true) y el
    // ownership lo resuelve la policy: update con 0 filas afectadas ⇒
    // api.ts sintetiza 42501 (nunca un falso éxito) ⇒ mensaje amigable.
    vi.mocked(productsApi.fetchProduct).mockResolvedValue({ row: P1, error: null });
    vi.mocked(productsApi.updateProduct).mockResolvedValue({ error: ERROR_RLS });
    const user = userEvent.setup();
    renderRutas("/products/1", "operador");

    const botonGuardar = await screen.findByRole("button", { name: "Guardar cambios" });
    expect(screen.getByDisplayValue("Café molido")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Café especial");
    await user.click(botonGuardar);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
    expect(productsApi.updateProduct).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: "Café especial" }),
    );
    // El título del listado ("Productos") nunca aparece: no hubo navegación
    // (el h1 del formulario es "Producto" — nombres accesibles distintos).
    expect(screen.queryByRole("heading", { name: "Productos" })).not.toBeInTheDocument();
  });

  it("operador: datos en modo edición SIN control de eliminar (SEC-01 idea:113 ✘)", async () => {
    vi.mocked(productsApi.fetchProduct).mockResolvedValue({ row: P1, error: null });
    renderRutas("/products/1", "operador");

    expect(await screen.findByDisplayValue("Café molido")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Guardar cambios" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar producto" })).not.toBeInTheDocument();
  });

  it("admin: desactivar solo hace soft-delete (C0.2) — nunca borra la fila", async () => {
    vi.mocked(productsApi.fetchProduct).mockResolvedValue({ row: P1, error: null });
    const user = userEvent.setup();
    renderRutas("/products/1", "admin");

    await user.click(await screen.findByRole("button", { name: "Desactivar producto" }));

    // Prueba estructural de que navigate("/products") salió del form al listado.
    expect(await screen.findByRole("heading", { name: "Productos" })).toBeInTheDocument();
    expect(productsApi.deactivateProduct).toHaveBeenCalledWith(1);
    expect(productsApi.deleteProduct).not.toHaveBeenCalled();
  });

  it("si la desactivación falla, el error es amigable y no se navega", async () => {
    vi.mocked(productsApi.fetchProduct).mockResolvedValue({ row: P1, error: null });
    vi.mocked(productsApi.deactivateProduct).mockResolvedValue({ error: ERROR_RLS });
    const user = userEvent.setup();
    renderRutas("/products/1", "admin");

    await user.click(await screen.findByRole("button", { name: "Desactivar producto" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(productsApi.deleteProduct).not.toHaveBeenCalled();
    // Misma prueba estructural que el caso feliz, en negativo: el título del
    // listado NUNCA aparece porque no hubo navegación.
    expect(screen.queryByRole("heading", { name: "Productos" })).not.toBeInTheDocument();
  });

  it("distribuidor en /products/new: denegado ANTES de montar — cero llamadas (PROD-2)", async () => {
    renderRutas("/products/new", "distribuidor");

    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(productsApi.fetchBrands).not.toHaveBeenCalled();
    expect(productsApi.fetchProduct).not.toHaveBeenCalled();
    expect(productsApi.createProduct).not.toHaveBeenCalled();
  });

  it("distribuidor en /products/:id: solo lectura — datos visibles, cero controles (§S2)", async () => {
    vi.mocked(productsApi.fetchProduct).mockResolvedValue({ row: P1, error: null });
    renderRutas("/products/1", "distribuidor");

    expect(await screen.findByDisplayValue("Café molido")).toBeInTheDocument();
    expect(
      screen.getByText("Vista de solo lectura: no tenés permisos para editar productos."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar producto" })).not.toBeInTheDocument();
  });
});
