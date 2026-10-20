import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as storesApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { RequireRole } from "../../../app/guards/RequireRole";
import { StoreFormPage } from "./StoreFormPage";

// ESCAPE HATCH del mapa (progressive enhancement): si el chunk de Leaflet
// FALLA al cargar, el ErrorBoundary de MapLocationField renderiza los inputs
// numéricos legacy con su warning — el form NUNCA queda sin salida. Acá se
// mockea el MÓDULO DEL PICKER con un factory que tira (simula el chunk
// rechazado); MapLocationField y el form corren REALES.
vi.mock("../../../shared/ui/LocationPicker/LocationPicker", () => {
  throw new Error("map chunk failed to load");
});
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
vi.mock("../../../shared/lib/geo/nominatim", () => ({
  reverseGeocode: vi.fn(),
}));

function renderForm(rol: RoleName) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: rol, premium: false });
  return render(
    <MemoryRouter initialEntries={["/stores/new"]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/stores/new"
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

describe("StoreFormPage · escape hatch numérico (chunk de Leaflet caído)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // El catch del ErrorBoundary loguea por React en console.error: se silencia
    // para que la salida del suite quede limpia.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(storesApi.fetchStores).mockResolvedValue({ rows: [], count: 0, error: null });
    vi.mocked(storesApi.fetchStoreTypes).mockResolvedValue({
      rows: [{ id: 1, name: "Minimercado" }],
      error: null,
    });
    vi.mocked(storesApi.createStore).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("el mapa no carga: warning + inputs numéricos LEGACY visibles", async () => {
    renderForm("admin");

    expect(
      await screen.findByText("No se pudo cargar el mapa. Ingresá las coordenadas manualmente."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Latitud (-90 a 90)")).toBeInTheDocument();
    expect(screen.getByLabelText("Longitud (-180 a 180)")).toBeInTheDocument();
  });

  it("una alta VÁLIDA por los inputs del escape hatch llega a la capa api", async () => {
    const user = userEvent.setup();
    renderForm("admin");

    await screen.findByText("No se pudo cargar el mapa. Ingresá las coordenadas manualmente.");
    await user.type(screen.getByLabelText("Nombre"), "Tienda Centro");
    await user.selectOptions(screen.getByLabelText("Tipo de tienda"), "1");
    await user.type(screen.getByLabelText("Latitud (-90 a 90)"), "4.6097");
    await user.type(screen.getByLabelText("Longitud (-180 a 180)"), "-74.0631");
    await user.click(screen.getByRole("button", { name: "Crear tienda" }));

    expect(storesApi.createStore).toHaveBeenCalledTimes(1);
    const [values] = vi.mocked(storesApi.createStore).mock.calls[0];
    expect(values).toEqual({
      name: "Tienda Centro",
      store_type_id: "1",
      address: "",
      city: "",
      phone: "",
      lat: "4.6097",
      lng: "-74.0631",
    });
  });

  it("latitud fuera de rango (120) en el escape hatch: error inline y CERO requests (Zod −90..90)", async () => {
    const user = userEvent.setup();
    renderForm("admin");

    await screen.findByText("No se pudo cargar el mapa. Ingresá las coordenadas manualmente.");
    await user.type(screen.getByLabelText("Nombre"), "Tienda Centro");
    await user.selectOptions(screen.getByLabelText("Tipo de tienda"), "1");
    await user.type(screen.getByLabelText("Latitud (-90 a 90)"), "120");
    await user.type(screen.getByLabelText("Longitud (-180 a 180)"), "-74.0631");
    await user.click(screen.getByRole("button", { name: "Crear tienda" }));

    expect(await screen.findByText("Ingresá una latitud válida entre -90 y 90")).toBeInTheDocument();
    expect(storesApi.createStore).not.toHaveBeenCalled();
  });
});
