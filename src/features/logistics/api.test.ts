import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../shared/lib/supabase/client";
import {
  googleMapsUrl,
  markStop,
  createRoute,
  updateRouteStops,
  updateRouteStatus,
  fetchStoresWithRequests,
  fetchRouteOpenOrders,
  fetchTodayRoutes,
} from "./api";

vi.mock("../../shared/lib/supabase/client", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const from = supabase.from as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: 1, error: null });
});

describe("logistics api", () => {
  it("create_route y update_route_stops envían sus parámetros", async () => {
    const stops = [
      { store_id: 5, stop_order: 1, estimated_time: "09:00" },
      { store_id: 6, stop_order: 2, estimated_time: null },
    ];
    await createRoute(2, "2026-10-26", stops);
    expect(rpc).toHaveBeenCalledWith("create_route", {
      p_distributor: 2,
      p_route_date: "2026-10-26",
      p_stops: stops,
    });
    await updateRouteStops(9, stops);
    expect(rpc).toHaveBeenCalledWith("update_route_stops", { p_route: 9, p_stops: stops });
  });

  it("mark_stop y update_route_status con sus parámetros", async () => {
    await markStop(8, "arrived");
    expect(rpc).toHaveBeenCalledWith("mark_stop", { p_stop: 8, p_status: "arrived" });
    await updateRouteStatus(4, "completed");
    expect(rpc).toHaveBeenCalledWith("update_route_status", { p_route: 4, p_status: "completed" });
  });
});

describe("fetchStoresWithRequests", () => {
  it("agrupa pedidos por tienda, toma la próxima entrega y une coordenadas", async () => {
    const orders = {
      select: vi.fn(),
      in: vi.fn(),
      limit: vi.fn().mockResolvedValue({
        data: [
          {
            store_id: 1,
            expected_at: "2026-10-30T12:00:00Z",
            store: { id: 1, name: "Tienda Centro", address: "Calle 1", city: "Bogotá" },
          },
          {
            store_id: 1,
            expected_at: "2026-10-29T12:00:00Z",
            store: { id: 1, name: "Tienda Centro", address: "Calle 1", city: "Bogotá" },
          },
          {
            store_id: 2,
            expected_at: null,
            store: { id: 2, name: "Tienda Sin Geo", address: null, city: "Bogotá" },
          },
        ],
        error: null,
      }),
    };
    orders.select.mockReturnValue(orders);
    orders.in.mockReturnValue(orders);

    const geo = {
      select: vi.fn(),
      in: vi.fn().mockResolvedValue({
        data: [{ id: 1, lat: 4.6, lng: -74.1 }],
        error: null,
      }),
    };
    geo.select.mockReturnValue(geo);
    from.mockReturnValueOnce(orders).mockReturnValueOnce(geo);

    const result = await fetchStoresWithRequests();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        id: 1,
        name: "Tienda Centro",
        address: "Calle 1",
        city: "Bogotá",
        lat: 4.6,
        lng: -74.1,
        orderCount: 2,
        nextExpectedAt: "2026-10-29T12:00:00Z",
      },
    ]);
    expect(orders.in).toHaveBeenCalledWith("status", ["pending", "in_route"]);
    expect(geo.in).toHaveBeenCalledWith("id", [1, 2]);
  });
});

describe("fetchRouteOpenOrders", () => {
  it("agrupa los pedidos abiertos por tienda y filtra por distribuidor", async () => {
    const orders = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      order: vi.fn(),
      range: vi.fn().mockResolvedValue({
        data: [
          { id: 10, store_id: 1, status: "pending" },
          { id: 11, store_id: 1, status: "in_route" },
          { id: 12, store_id: 2, status: "pending" },
        ],
        error: null,
      }),
    };
    orders.select.mockReturnValue(orders);
    orders.eq.mockReturnValue(orders);
    orders.in.mockReturnValue(orders);
    orders.order.mockReturnValue(orders);
    from.mockReturnValue(orders);

    const result = await fetchRouteOpenOrders(7);

    expect(from).toHaveBeenCalledWith("orders");
    expect(orders.eq).toHaveBeenCalledWith("distributor_id", 7);
    expect(orders.in).toHaveBeenCalledWith("status", ["pending", "in_route"]);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      1: [
        { id: 10, store_id: 1, status: "pending" },
        { id: 11, store_id: 1, status: "in_route" },
      ],
      2: [{ id: 12, store_id: 2, status: "pending" }],
    });
  });
});

describe("fetchTodayRoutes", () => {
  it("devuelve todas las rutas del día, ordena paradas y une coordenadas", async () => {
    const routes = {
      select: vi.fn(),
      eq: vi.fn(),
      neq: vi.fn(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            id: 2,
            route_date: "2026-11-17",
            status: "planned",
            distributor_id: 7,
            distributor: { name: "Distribuidora Andes" },
            route_stops: [
              {
                id: 20,
                stop_order: 2,
                status: "pending",
                estimated_time: null,
                arrived_at: null,
                store_id: 6,
                store: { name: "Tienda Norte" },
              },
              {
                id: 10,
                stop_order: 1,
                status: "arrived",
                estimated_time: "09:00",
                arrived_at: null,
                store_id: 5,
                store: { name: "Tienda Centro" },
              },
            ],
          },
          {
            id: 1,
            route_date: "2026-11-17",
            status: "completed",
            distributor_id: 7,
            distributor: { name: "Distribuidora Andes" },
            route_stops: [],
          },
        ],
        error: null,
      }),
    };
    routes.select.mockReturnValue(routes);
    routes.eq.mockReturnValue(routes);
    routes.neq.mockReturnValue(routes);
    const geo = {
      select: vi.fn(),
      in: vi.fn().mockResolvedValue({
        data: [
          { id: 5, lat: 4.6, lng: -74.1 },
          { id: 6, lat: 4.7, lng: -74.05 },
        ],
        error: null,
      }),
    };
    geo.select.mockReturnValue(geo);
    from.mockReturnValueOnce(routes).mockReturnValueOnce(geo);

    const result = await fetchTodayRoutes("2026-11-17");

    expect(from).toHaveBeenCalledWith("routes");
    expect(routes.eq).toHaveBeenCalledWith("route_date", "2026-11-17");
    expect(routes.neq).toHaveBeenCalledWith("status", "cancelled");
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]?.stops.map((stop) => stop.store_id)).toEqual([5, 6]);
    expect(result.data?.[0]?.stops[0]?.lat).toBe(4.6);
    expect(result.data?.[0]?.stops[1]?.lat).toBe(4.7);
  });
});

describe("googleMapsUrl", () => {
  it("arma origen, waypoints intermedios y destino en orden (lat,lng)", () => {
    const url = googleMapsUrl([
      { lat: 4.53, lng: -75.68 },
      { lat: 4.54, lng: -75.69 },
      { lat: 4.55, lng: -75.7 },
    ]);
    const params = new URL(url ?? "").searchParams;
    expect(params.get("origin")).toBe("4.53,-75.68");
    expect(params.get("waypoints")).toBe("4.54,-75.69");
    expect(params.get("destination")).toBe("4.55,-75.7");
  });

  it("una sola parada: solo destino; sin coordenadas: null", () => {
    const url = googleMapsUrl([{ lat: 4.5, lng: -75.6 }]);
    expect(new URL(url ?? "").searchParams.get("origin")).toBeNull();
    expect(googleMapsUrl([{ lat: null, lng: null }])).toBeNull();
  });
});
