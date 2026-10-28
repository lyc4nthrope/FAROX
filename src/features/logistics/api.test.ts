import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../shared/lib/supabase/client";
import { googleMapsUrl, markStop, saveRoute, updateRouteStatus, fetchStoresWithRequests } from "./api";

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
  it("save_route envía las paradas con stop_order desde 1", async () => {
    await saveRoute(2, "2026-10-26", [
      { store_id: 5, stop_order: 1, estimated_time: "09:00" },
      { store_id: 6, stop_order: 2, estimated_time: null },
    ]);
    expect(rpc).toHaveBeenCalledWith("save_route", {
      p_distributor: 2,
      p_route_date: "2026-10-26",
      p_stops: [
        { store_id: 5, stop_order: 1, estimated_time: "09:00" },
        { store_id: 6, stop_order: 2, estimated_time: null },
      ],
    });
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
