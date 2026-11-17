import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import * as logisticsApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { RouteDetailPage, RoutesPage } from "./RoutePages";

vi.mock("../api", () => ({
  ROUTE_LABELS: {
    planned: "Planificada",
    active: "En curso",
    completed: "Completada",
    cancelled: "Cancelada",
  },
  STOP_LABELS: {
    pending: "Pendiente",
    arrived: "Llegó",
    completed: "Completada",
    skipped: "Omitida",
  },
  fetchRoutes: vi.fn(),
  fetchDistributors: vi.fn(),
  fetchGeoStores: vi.fn(),
  fetchLinkedStoreIds: vi.fn(),
  fetchRouteStatusFor: vi.fn(),
  fetchRouteDetail: vi.fn(),
  fetchRouteOpenOrders: vi.fn(),
  fetchMyDistributorId: vi.fn(),
  fetchStoresWithRequests: vi.fn(),
  googleMapsUrl: () => null,
  markStop: vi.fn(),
  saveRoute: vi.fn(),
  updateRouteStatus: vi.fn(),
}));
vi.mock("../components/StoreRouteMap", () => ({ StoreRouteMap: () => null }));
vi.mock("../../store-links", () => ({ ContactButton: () => null }));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const TODAY = new Date().toLocaleDateString("en-CA");

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <RoutesPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "admin@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "admin", premium: true });
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(logisticsApi.fetchDistributors).mockResolvedValue({
    data: [{ id: 5, name: "Distribuidora Andes" }],
    error: null,
  });
  vi.mocked(logisticsApi.fetchGeoStores).mockResolvedValue({
    data: [
      { id: 1, name: "Tienda Centro", lat: 4.5, lng: -75.6 },
      { id: 2, name: "Tienda Ajena", lat: 4.6, lng: -75.7 },
    ],
    error: null,
  });
  vi.mocked(logisticsApi.fetchLinkedStoreIds).mockResolvedValue({ data: [1], error: null });
  vi.mocked(logisticsApi.fetchRoutes).mockResolvedValue({ data: [], error: null });
  vi.mocked(logisticsApi.fetchRouteStatusFor).mockResolvedValue({ data: null, error: null });
  vi.mocked(logisticsApi.saveRoute).mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function chooseDistributorAndStore() {
  const user = userEvent.setup();
  renderPage();
  await user.selectOptions(
    await screen.findByLabelText("Distribuidor"),
    await screen.findByRole("option", { name: "Distribuidora Andes" }),
  );
  const storeSelect = screen.getByLabelText("Tienda de la parada 1");
  await within(storeSelect).findByRole("option", { name: "Tienda Centro" });
  return { user, storeSelect };
}

describe("RoutesPage · planificar ruta (0056)", () => {
  it("solo ofrece tiendas vinculadas al distribuidor elegido", async () => {
    const { storeSelect } = await chooseDistributorAndStore();

    expect(logisticsApi.fetchLinkedStoreIds).toHaveBeenCalledWith(5);
    expect(within(storeSelect).queryByRole("option", { name: "Tienda Ajena" })).toBeNull();
  });

  it("pide confirmación antes de reemplazar una ruta en curso", async () => {
    // La ruta no está entre las 50 del listado: el chequeo consulta el servidor.
    vi.mocked(logisticsApi.fetchRouteStatusFor).mockResolvedValue({ data: "active", error: null });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user, storeSelect } = await chooseDistributorAndStore();
    await user.selectOptions(storeSelect, "1");

    await user.click(screen.getByRole("button", { name: "Guardar ruta" }));

    expect(logisticsApi.fetchRouteStatusFor).toHaveBeenCalledWith(5, TODAY);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(logisticsApi.saveRoute).not.toHaveBeenCalled();
  });

  it("no intenta reemplazar una ruta completada", async () => {
    vi.mocked(logisticsApi.fetchRouteStatusFor).mockResolvedValue({
      data: "completed",
      error: null,
    });
    const { user, storeSelect } = await chooseDistributorAndStore();
    await user.selectOptions(storeSelect, "1");

    await user.click(screen.getByRole("button", { name: "Guardar ruta" }));

    expect(await screen.findByText(/ya está completada/i)).toBeInTheDocument();
    expect(logisticsApi.saveRoute).not.toHaveBeenCalled();
  });

  it("cambiar de distribuidor descarta las paradas elegidas", async () => {
    vi.mocked(logisticsApi.fetchDistributors).mockResolvedValue({
      data: [
        { id: 5, name: "Distribuidora Andes" },
        { id: 6, name: "Distribuidora Café" },
      ],
      error: null,
    });
    const { user, storeSelect } = await chooseDistributorAndStore();
    await user.selectOptions(storeSelect, "1");

    // La tienda 1 también está vinculada al otro distribuidor: sin el reinicio
    // la parada seguiría elegida aunque nadie la haya elegido para él.
    await user.selectOptions(screen.getByLabelText("Distribuidor"), "6");

    expect(screen.getByLabelText("Tienda de la parada 1")).toHaveValue("");
  });
});

describe("RouteDetailPage · vista admin", () => {
  it("no consulta ni ofrece las acciones de pedidos de las paradas", async () => {
    vi.mocked(logisticsApi.fetchRouteDetail).mockResolvedValue({
      data: {
        id: 7,
        route_date: TODAY,
        status: "active",
        distributor_id: 5,
        distributor_name: "Distribuidora Andes",
        stops: [
          {
            id: 1,
            stop_order: 1,
            status: "pending",
            estimated_time: null,
            arrived_at: null,
            store_id: 1,
            store_name: "Tienda Centro",
            lat: 4.5,
            lng: -75.6,
          },
        ],
      },
      error: null,
    });

    render(
      <MemoryRouter initialEntries={["/rutas/7"]}>
        <AuthProvider>
          <Routes>
            <Route path="/rutas/:routeId" element={<RouteDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Ruta del/)).toBeInTheDocument();
    expect(logisticsApi.fetchRouteOpenOrders).not.toHaveBeenCalled();
    expect(screen.queryByText("Pedidos de esta parada")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "En ruta" })).not.toBeInTheDocument();
  });
});
