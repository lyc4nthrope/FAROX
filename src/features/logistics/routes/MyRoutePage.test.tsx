import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import * as logisticsApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { MyRoutePage } from "./RoutePages";

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
  fetchRouteDetail: vi.fn(),
  fetchStoresWithRequests: vi.fn(),
  fetchMyDistributorId: vi.fn(),
  saveRoute: vi.fn(),
  googleMapsUrl: (stores: { lat: number; lng: number }[]) => {
    if (stores.length === 0) return null;
    const params = new URLSearchParams({ api: "1" });
    const points = stores.map((store) => `${store.lat},${store.lng}`);
    params.set("destination", points[points.length - 1] ?? "");
    if (points.length > 1) {
      params.set("origin", points[0] ?? "");
      if (points.length > 2) params.set("waypoints", points.slice(1, -1).join("|"));
    }
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  },
  markStop: vi.fn(),
  updateRouteStatus: vi.fn(),
}));
vi.mock("../components/StoreRouteMap", () => ({
  StoreRouteMap: ({ stores }: { stores: unknown[] }) => (
    <p data-testid="map-count">{stores.length} en mapa</p>
  ),
}));
vi.mock("../../store-links", () => ({
  ContactButton: () => <span>Contacto</span>,
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const STORES: logisticsApi.RequestStore[] = [
  {
    id: 1,
    name: "Tienda Centro",
    address: "Calle 1 #2-3",
    city: "Bogotá",
    lat: 4.6,
    lng: -74.1,
    orderCount: 2,
    nextExpectedAt: "2026-10-30T12:00:00Z",
  },
  {
    id: 2,
    name: "Tienda Norte",
    address: null,
    city: "Bogotá",
    lat: 4.7,
    lng: -74.05,
    orderCount: 1,
    nextExpectedAt: null,
  },
];

function renderPage() {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "distribuidor", premium: false });
  return render(
    <MemoryRouter>
      <AuthProvider>
        <MyRoutePage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  vi.mocked(logisticsApi.fetchRouteDetail).mockResolvedValue({ data: null, error: null });
  vi.mocked(logisticsApi.fetchStoresWithRequests).mockResolvedValue({
    data: STORES,
    error: null,
  });
  vi.mocked(logisticsApi.fetchMyDistributorId).mockResolvedValue({ data: 7, error: null });
  vi.mocked(logisticsApi.saveRoute).mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
});

describe("MyRoutePage · mapa de tiendas con solicitudes (S14)", () => {
  it("muestra las tiendas, todas marcadas, y el mapa con la selección", async () => {
    renderPage();

    expect(await screen.findByText("Tienda Centro")).toBeInTheDocument();
    expect(screen.getByText("Tienda Norte")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("Incluir Tienda Centro")).toBeChecked();
      expect(screen.getByLabelText("Incluir Tienda Norte")).toBeChecked();
      expect(screen.getByTestId("map-count")).toHaveTextContent("2 en mapa");
    });
    const summary = screen.getByText((_, element) => {
      if (element?.tagName !== "P") return false;
      const text = element.textContent ?? "";
      return text.startsWith("2 tiendas") && text.includes("3 solicitudes");
    });
    expect(summary).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /Abrir en Google Maps/ });
    const url = new URL(link.getAttribute("href") ?? "");
    expect(url.searchParams.get("origin")).toBe("4.6,-74.1");
    expect(url.searchParams.get("destination")).toBe("4.7,-74.05");
  });

  it("desmarcar una tienda la saca del mapa y del recorrido", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText("Incluir Tienda Centro"));

    expect(screen.getByTestId("map-count")).toHaveTextContent("1 en mapa");
    expect(screen.getByLabelText("Incluir Tienda Centro")).not.toBeChecked();
    const link = screen.getByRole("link", { name: /Abrir en Google Maps/ });
    const url = new URL(link.getAttribute("href") ?? "");
    expect(url.searchParams.get("origin")).toBeNull();
    expect(url.searchParams.get("destination")).toBe("4.7,-74.05");
    const summary = screen.getByText((_, element) => {
      if (element?.tagName !== "P") return false;
      const text = element.textContent ?? "";
      return text.startsWith("1 tienda") && text.includes("1 solicitud");
    });
    expect(summary).toBeInTheDocument();
  });

  it("Limpiar deshabilita el botón y Marcar todas vuelve a seleccionar", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Limpiar" }));
    expect(screen.getByTestId("map-count")).toHaveTextContent("0 en mapa");
    expect(screen.getByText("Marcá al menos una tienda")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Abrir en Google Maps/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Marcar todas" }));
    expect(screen.getByTestId("map-count")).toHaveTextContent("2 en mapa");
  });

  it("guarda la ruta de hoy con las tiendas marcadas", async () => {
    renderPage();
    const user = userEvent.setup();

    await screen.findByText("Tienda Centro");
    await user.click(screen.getByRole("button", { name: "Guardar ruta" }));

    const today = new Date().toLocaleDateString("en-CA");
    await waitFor(() =>
      expect(logisticsApi.saveRoute).toHaveBeenCalledWith(7, today, [
        { store_id: 1, stop_order: 1, estimated_time: null },
        { store_id: 2, stop_order: 2, estimated_time: null },
      ]),
    );
    expect(await screen.findByText("Ruta de hoy guardada.")).toBeInTheDocument();
  });

  it("no guarda si no hay tiendas marcadas", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Limpiar" }));
    await user.click(screen.getByRole("button", { name: "Guardar ruta" }));

    expect(logisticsApi.saveRoute).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Marcá al menos una tienda para guardar la ruta."),
    ).toBeInTheDocument();
  });

  it("el resumen 'Tu día' refleja los pedidos y las paradas de la ruta de hoy", async () => {
    vi.mocked(logisticsApi.fetchRouteDetail).mockResolvedValue({
      data: {
        id: 9,
        route_date: "2026-10-28",
        status: "active",
        distributor_name: "Distribuidora Andes",
        stops: [
          {
            id: 1,
            stop_order: 1,
            status: "completed",
            estimated_time: null,
            arrived_at: null,
            store_id: 1,
            store_name: "Tienda Centro",
            lat: 4.6,
            lng: -74.1,
          },
          {
            id: 2,
            stop_order: 2,
            status: "pending",
            estimated_time: null,
            arrived_at: null,
            store_id: 2,
            store_name: "Tienda Norte",
            lat: 4.7,
            lng: -74.05,
          },
        ],
      },
      error: null,
    });
    renderPage();

    expect(await screen.findByText("Tu día")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Pedidos").nextElementSibling).toHaveTextContent("3");
      expect(screen.getByText("Paradas").nextElementSibling).toHaveTextContent("2");
    });
    expect(screen.getByText("1 pendiente")).toBeInTheDocument();
  });

  it("sin solicitudes abiertas muestra el estado vacío", async () => {
    vi.mocked(logisticsApi.fetchStoresWithRequests).mockResolvedValue({ data: [], error: null });
    renderPage();

    expect(
      await screen.findByText("No hay tiendas con solicitudes abiertas"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("No tenés ruta asignada para hoy"),
    ).toBeInTheDocument();
  });

  it("muestra la ruta asignada cuando existe", async () => {
    vi.mocked(logisticsApi.fetchRouteDetail).mockResolvedValue({
      data: {
        id: 7,
        route_date: "2026-10-28",
        status: "planned",
        distributor_name: "Distribuidora Andes",
        stops: [
          {
            id: 1,
            stop_order: 1,
            status: "pending",
            estimated_time: "09:00",
            arrived_at: null,
            store_id: 1,
            store_name: "Tienda Centro",
            lat: 4.6,
            lng: -74.1,
          },
        ],
      },
      error: null,
    });
    renderPage();

    expect(await screen.findByText(/Ruta del/)).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Tu día")).toBeInTheDocument();
    expect(screen.getByText("Paradas").nextElementSibling).toHaveTextContent("1");
  });
});
