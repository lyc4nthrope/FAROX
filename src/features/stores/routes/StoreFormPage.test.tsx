import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as storesApi from "../api";
import type { StoreGeo, StoreListRow, StoreRow } from "../types";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { RequireRole } from "../../../app/guards/RequireRole";
import { StoreFormPage } from "./StoreFormPage";
import { StoresPage } from "./StoresPage";

// D7 (componente, api de la feature mockeada COMPLETA): los escenarios de
// STORE-1 y STORE-3 (spec #483 S6). /stores usa la página REAL para probar
// "la fila aparece en la lista tras el refetch" (HARD-3, D4).
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

const T1: StoreRow = {
  id: 1,
  name: "Tienda Centro",
  store_type_id: 1,
  address: "Calle 1 #2-3",
  city: "Bogotá",
  phone: "300 000 0000",
};

// Coordenadas tal como las trae stores_geo del servidor (0004:1546-1547).
const GEO1: StoreGeo = { lat: 4.6097, lng: -74.0631 };

// Fila del listado tras el refetch.
const FILA_NUEVA: StoreListRow = {
  id: 7,
  name: "Tienda Centro",
  city: "Bogotá",
  is_active: true,
  lat: 4.6097,
  lng: -74.0631,
};

// Formas REAL de fallos backend (PostgREST/RLS y RAISE de plpgsql): SQLSTATE
// en `code` + mensaje crudo. Variables porque los literales con `code`
// chocarían con el excess-property check de TS.
const ERROR_RLS = { code: "42501", message: "permission denied for table stores" };
const ERROR_TOPE = { code: "P0001", message: "D34: tope de tiendas alcanzado (1 activas, tope 1)" };
const ERROR_STORE_TYPE = { code: "P0001", message: "store_type inexistente: 99" };
const ERROR_NOT_NULL = {
  code: "23502",
  message: 'null value in column "location" of relation "stores" violates not-null constraint',
};

// Las rutas del harness son las MISMAS del router real (B7): las tres con
// RequireRole admin|operador — distribuidor es ✘ total en tiendas (SEC-01
// idea:114, §S2 "distribuidor NO").
function renderRutas(entrada: string, role: RoleName) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={[entrada]}>
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
          <Route
            path="/stores/new"
            element={
              <RequireRole roles={["admin", "operador"]}>
                <StoreFormPage />
              </RequireRole>
            }
          />
          <Route
            path="/stores/:id"
            element={
              <RequireRole roles={["admin", "operador"]}>
                <StoreFormPage />
              </RequireRole>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// El botón de envío solo existe con el rol escritor YA resuelto y el catálogo
// cargado: esperarlo ANTES de tipear evita escribir en inputs todavía
// deshabilitados (carrera con la resolución asíncrona de AuthProvider,
// lección #509 aplicada al patrón de B6).
async function completarAlta(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByRole("button", { name: "Crear tienda" });
  await user.type(screen.getByLabelText("Nombre"), "Tienda Centro");
  await user.selectOptions(screen.getByLabelText("Tipo de tienda"), "1");
  await user.type(screen.getByLabelText("Dirección"), "Calle 1 #2-3");
  await user.type(screen.getByLabelText("Ciudad"), "Bogotá");
  // Campos numéricos MANUALES sin mapa (D3): los labels llevan el rango para
  // que el orden lat/lng no se confunda en pantalla (trap #2 de B7).
  await user.type(screen.getByLabelText("Latitud (-90 a 90)"), "4.6097");
  await user.type(screen.getByLabelText("Longitud (-180 a 180)"), "-74.0631");
}

describe("StoreFormPage (STORE-1/STORE-3 · §S2 fila Store form)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(storesApi.fetchStores).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(storesApi.fetchStore).mockResolvedValue({ row: null, error: null });
    vi.mocked(storesApi.fetchStoreGeo).mockResolvedValue({ geo: null, error: null });
    vi.mocked(storesApi.fetchStoreTypes).mockResolvedValue({
      rows: [{ id: 1, name: "Minimercado" }],
      error: null,
    });
    vi.mocked(storesApi.createStore).mockResolvedValue({ error: null });
    vi.mocked(storesApi.updateStore).mockResolvedValue({ error: null });
    vi.mocked(storesApi.deactivateStore).mockResolvedValue({ error: null });
    vi.mocked(storesApi.deleteStore).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("admin crea una tienda y la fila aparece en la lista tras el refetch (STORE-1)", async () => {
    // 1.er mount de la lista: vacía. Tras crear, el re-entrada de la ruta
    // vuelve a pedir y ahora la fila existe (refetch, sin realtime).
    vi.mocked(storesApi.fetchStores).mockResolvedValueOnce({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(storesApi.fetchStores).mockResolvedValueOnce({
      rows: [FILA_NUEVA],
      count: 1,
      error: null,
    });
    const user = userEvent.setup();
    renderRutas("/stores", "admin");

    expect(await screen.findByText("No hay tiendas todavía")).toBeInTheDocument();
    await user.click(await screen.findByRole("link", { name: "Nueva tienda" }));

    await completarAlta(user);
    await user.click(await screen.findByRole("button", { name: "Crear tienda" }));

    expect(await screen.findByRole("link", { name: "Tienda Centro" })).toBeInTheDocument();
    expect(storesApi.createStore).toHaveBeenCalledTimes(1);
    // El payload lleva lat y lng en sus Campos NOMINADOS — el intercambio
    // lat/lng es imposible en esta frontera (el EWKT lng-first se prueba en
    // geo.test.ts, que cubre el armado del request en la capa api).
    const [values] = vi.mocked(storesApi.createStore).mock.calls[0];
    expect(values).toEqual({
      name: "Tienda Centro",
      store_type_id: "1",
      address: "Calle 1 #2-3",
      city: "Bogotá",
      phone: "",
      lat: "4.6097",
      lng: "-74.0631",
    });
    expect(storesApi.fetchStores).toHaveBeenCalledTimes(2);
  });

  it("operador: SÍ ve y completa el alta — su ruta de bootstrap de alcance (idea:114, D35)", async () => {
    // README:38-39 afirma que create_store exige admin y está MAL: la RPC solo
    // valida sesión/nombre/store_type (0004:649-657). El operador dentro del
    // tope D34 crea su tienda (SEC-01 idea:114 ✔ crear) — el UI NO lo oculta.
    const user = userEvent.setup();
    renderRutas("/stores/new", "operador");

    await completarAlta(user);
    await user.click(screen.getByRole("button", { name: "Crear tienda" }));

    expect(await screen.findByRole("heading", { name: "Tiendas" })).toBeInTheDocument();
    expect(storesApi.createStore).toHaveBeenCalledTimes(1);
  });

  it("coordenadas vacías: errores inline y CERO requests (STORE-1, idea:198)", async () => {
    // stores.location NOT NULL (0002:131) vs p_location DEFAULT NULL (0004:641):
    // sin esta validación el backend devolvería un not_null_violation crudo.
    const user = userEvent.setup();
    renderRutas("/stores/new", "admin");

    await screen.findByRole("button", { name: "Crear tienda" });
    await user.type(screen.getByLabelText("Nombre"), "Tienda Centro");
    await user.selectOptions(screen.getByLabelText("Tipo de tienda"), "1");
    await user.click(screen.getByRole("button", { name: "Crear tienda" }));

    expect(await screen.findByText("Ingresá una latitud válida entre -90 y 90")).toBeInTheDocument();
    expect(
      screen.getByText("Ingresá una longitud válida entre -180 y 180"),
    ).toBeInTheDocument();
    expect(storesApi.createStore).not.toHaveBeenCalled();
    expect(storesApi.updateStore).not.toHaveBeenCalled();
  });

  it("latitud fuera de rango (120): error inline y CERO requests (Zod −90..90)", async () => {
    const user = userEvent.setup();
    renderRutas("/stores/new", "admin");

    await screen.findByRole("button", { name: "Crear tienda" });
    await user.type(screen.getByLabelText("Nombre"), "Tienda Centro");
    await user.selectOptions(screen.getByLabelText("Tipo de tienda"), "1");
    await user.type(screen.getByLabelText("Latitud (-90 a 90)"), "120");
    await user.type(screen.getByLabelText("Longitud (-180 a 180)"), "-74.0631");
    await user.click(screen.getByRole("button", { name: "Crear tienda" }));

    expect(await screen.findByText("Ingresá una latitud válida entre -90 y 90")).toBeInTheDocument();
    expect(storesApi.createStore).not.toHaveBeenCalled();
  });

  it("tope D34 (trigger 0004:376): mensaje amigable, jamás el crudo (HARD-1)", async () => {
    vi.mocked(storesApi.createStore).mockResolvedValue({ error: ERROR_TOPE });
    const user = userEvent.setup();
    renderRutas("/stores/new", "admin");

    await completarAlta(user);
    await user.click(await screen.findByRole("button", { name: "Crear tienda" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Alcanzaste el tope de tiendas (1 activa; 3 con premium).",
    );
    expect(screen.queryByText(/D34/)).not.toBeInTheDocument();
    // Sigo en el formulario: no hubo navegación de éxito.
    expect(screen.getByRole("button", { name: "Crear tienda" })).toBeInTheDocument();
  });

  it("store_type inexistente (RAISE 0004:656): mensaje amigable (HARD-1)", async () => {
    vi.mocked(storesApi.createStore).mockResolvedValue({ error: ERROR_STORE_TYPE });
    const user = userEvent.setup();
    renderRutas("/stores/new", "admin");

    await completarAlta(user);
    await user.click(await screen.findByRole("button", { name: "Crear tienda" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El tipo de tienda no existe.",
    );
    expect(screen.queryByText(/store_type inexistente/)).not.toBeInTheDocument();
  });

  it("not_null de stores.location (23502) llega igual: mensaje amigable (STORE-1)", async () => {
    vi.mocked(storesApi.createStore).mockResolvedValue({ error: ERROR_NOT_NULL });
    const user = userEvent.setup();
    renderRutas("/stores/new", "admin");

    await completarAlta(user);
    await user.click(await screen.findByRole("button", { name: "Crear tienda" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Faltan datos obligatorios (coordenadas).",
    );
    expect(screen.queryByText(/violates not-null/)).not.toBeInTheDocument();
  });

  it("alta denegada (42501): amigable, sin falso éxito ni navegación (HARD-1)", async () => {
    vi.mocked(storesApi.createStore).mockResolvedValue({ error: ERROR_RLS });
    const user = userEvent.setup();
    renderRutas("/stores/new", "operador");

    await completarAlta(user);
    await user.click(await screen.findByRole("button", { name: "Crear tienda" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tiendas" })).not.toBeInTheDocument();
  });

  it("dueño edita su tienda: persiste y vuelve al listado (STORE-3)", async () => {
    vi.mocked(storesApi.fetchStore).mockResolvedValue({ row: T1, error: null });
    vi.mocked(storesApi.fetchStoreGeo).mockResolvedValue({ geo: GEO1, error: null });
    const user = userEvent.setup();
    renderRutas("/stores/1", "operador");

    const botonGuardar = await screen.findByRole("button", { name: "Guardar cambios" });
    // Las coordenadas se re-binddean desde stores_geo (String(4.6097)). Con
    // findBy (no getBy): el geo llega por un useEffect asíncrono — si el botón
    // se resuelve antes que el geo, getBy fallaría por timing, no por bug.
    expect(await screen.findByDisplayValue("4.6097")).toBeInTheDocument();
    expect(screen.getByDisplayValue("-74.0631")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Tienda Centro renovada");
    await user.click(botonGuardar);

    expect(await screen.findByRole("heading", { name: "Tiendas" })).toBeInTheDocument();
    // lat/lng viajan sin mezclar también por el camino de UPDATE.
    expect(storesApi.updateStore).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        name: "Tienda Centro renovada",
        lat: "4.6097",
        lng: "-74.0631",
      }),
    );
  });

  it("tienda ajena (operador): update denegado ⇒ amigable, sin navegación (STORE-3)", async () => {
    // stores_update exige admin o created_by = auth.uid() con has_scope
    // (0006:166-171): un update denegado responde 0 filas y api.ts sintetiza
    // 42501 — nunca un falso éxito.
    vi.mocked(storesApi.fetchStore).mockResolvedValue({ row: T1, error: null });
    vi.mocked(storesApi.fetchStoreGeo).mockResolvedValue({ geo: GEO1, error: null });
    vi.mocked(storesApi.updateStore).mockResolvedValue({ error: ERROR_RLS });
    const user = userEvent.setup();
    renderRutas("/stores/1", "operador");

    const botonGuardar = await screen.findByRole("button", { name: "Guardar cambios" });
    // SEC-01 idea:114: el operador crea/edita pero NO borra (idea:130).
    expect(screen.queryByRole("button", { name: "Eliminar tienda" })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Tienda Ajenal");
    await user.click(botonGuardar);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
    // El título del listado ("Tiendas") nunca aparece: no hubo navegación.
    expect(screen.queryByRole("heading", { name: "Tiendas" })).not.toBeInTheDocument();
  });

  it("admin: eliminar en DOS pasos — desactiva y DESPUÉS purga, en ese orden (0006:172-174)", async () => {
    vi.mocked(storesApi.fetchStore).mockResolvedValue({ row: T1, error: null });
    vi.mocked(storesApi.fetchStoreGeo).mockResolvedValue({ geo: GEO1, error: null });
    const user = userEvent.setup();
    renderRutas("/stores/1", "admin");

    await user.click(await screen.findByRole("button", { name: "Eliminar tienda" }));

    expect(await screen.findByRole("heading", { name: "Tiendas" })).toBeInTheDocument();
    expect(storesApi.deactivateStore).toHaveBeenCalledWith(1);
    expect(storesApi.deleteStore).toHaveBeenCalledWith(1);
    const ordenDesactivar =
      vi.mocked(storesApi.deactivateStore).mock.invocationCallOrder[0];
    const ordenBorrar = vi.mocked(storesApi.deleteStore).mock.invocationCallOrder[0];
    expect(ordenDesactivar).toBeLessThan(ordenBorrar);
  });

  it("si la desactivación falla, el paso 2 NO corre y el error es amigable", async () => {
    vi.mocked(storesApi.fetchStore).mockResolvedValue({ row: T1, error: null });
    vi.mocked(storesApi.fetchStoreGeo).mockResolvedValue({ geo: GEO1, error: null });
    vi.mocked(storesApi.deactivateStore).mockResolvedValue({ error: ERROR_RLS });
    const user = userEvent.setup();
    renderRutas("/stores/1", "admin");

    await user.click(await screen.findByRole("button", { name: "Eliminar tienda" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(storesApi.deleteStore).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Tiendas" })).not.toBeInTheDocument();
  });

  it("distribuidor en /stores/new: denegado ANTES de montar — cero llamadas (idea:114 ✘)", async () => {
    renderRutas("/stores/new", "distribuidor");

    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(storesApi.fetchStoreTypes).not.toHaveBeenCalled();
    expect(storesApi.fetchStore).not.toHaveBeenCalled();
    expect(storesApi.createStore).not.toHaveBeenCalled();
  });
});
