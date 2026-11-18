import type { LoadResult } from "../../shared/hooks/useLoad";
import { supabase } from "../../shared/lib/supabase/client";
import { fetchAllRows } from "../../shared/lib/supabase/fetchAllRows";

// DIST-03 rutas: save_route (admin), mark_stop y update_route_status
// (distribuidor sobre su ruta). Coordenadas desde la vista stores_geo.

type Err = { message: string } | null;

export type RouteStatus = "planned" | "active" | "completed" | "cancelled";
export type StopStatus = "pending" | "arrived" | "completed" | "skipped";

export const ROUTE_LABELS: Record<RouteStatus, string> = {
  planned: "Planificada",
  active: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
};
export const STOP_LABELS: Record<StopStatus, string> = {
  pending: "Pendiente",
  arrived: "Llegó",
  completed: "Completada",
  skipped: "Omitida",
};

export interface RouteRow {
  id: number;
  route_date: string;
  status: RouteStatus;
  distributor_id: number;
  distributor_name: string;
}
export interface StopRow {
  id: number;
  stop_order: number;
  status: StopStatus;
  estimated_time: string | null;
  arrived_at: string | null;
  store_id: number;
  store_name: string;
  lat: number | null;
  lng: number | null;
}
export interface RouteDetail extends RouteRow {
  stops: StopRow[];
}
export interface GeoStore {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

/** 0028: tienda con pedidos abiertos del distribuidor, para armar el recorrido. */
export interface RequestStore {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  orderCount: number;
  nextExpectedAt: string | null;
}

function relName(value: unknown): string {
  if (value !== null && typeof value === "object" && "name" in value) {
    const name = (value as { name: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

export async function fetchRoutes(): Promise<LoadResult<RouteRow[]>> {
  const { data, error } = await supabase
    .from("routes")
    .select("id,route_date,status,distributor_id,distributor:distributors(name)")
    .order("route_date", { ascending: false })
    .limit(50);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    route_date: String(r.route_date),
    status: r.status as RouteStatus,
    distributor_id: Number(r.distributor_id),
    distributor_name: relName(r.distributor),
  }));
  return { data: rows, error };
}

/** 0056: tiendas vinculadas al distribuidor; save_route solo acepta esas paradas. */
export async function fetchLinkedStoreIds(distributorId: number): Promise<LoadResult<number[]>> {
  const { data, error } = await fetchAllRows((from, to) =>
    supabase
      .from("store_distributors")
      .select("store_id")
      .eq("distributor_id", distributorId)
      .order("store_id")
      .range(from, to),
  );
  if (error !== null) return { data: null, error };
  return { data: ((data ?? []) as { store_id: number }[]).map((r) => Number(r.store_id)), error };
}

/** 0056: estado de la ruta vigente del distribuidor en esa fecha (null = no hay). */
export async function fetchGeoStores(): Promise<LoadResult<GeoStore[]>> {
  const { data, error } = await supabase
    .from("stores_geo")
    .select("id,name,lat,lng")
    .eq("is_active", true)
    .order("name")
    .limit(500);
  return { data: (data ?? []) as GeoStore[], error };
}

/** 0028: id de la distribuidora del usuario (para guardar SU ruta). */
export async function fetchMyDistributorId(): Promise<LoadResult<number>> {
  const { data, error } = await supabase.rpc("my_distributor_id");
  return { data: data == null ? null : Number(data), error };
}

export async function fetchDistributors(): Promise<LoadResult<{ id: number; name: string }[]>> {
  const { data, error } = await supabase
    .from("distributors")
    .select("id,name")
    .eq("is_active", true)
    .order("name")
    .limit(200);
  return { data: (data ?? []) as { id: number; name: string }[], error };
}

/**
 * 0028: tiendas con pedidos ABIERTOS (pending/in_route) visibles para el
 * usuario, agrupadas por tienda. La RLS de orders acota al distribuidor a los
 * suyos; las coordenadas salen de stores_geo (nunca ST_X/ST_Y en el cliente).
 */
export async function fetchStoresWithRequests(): Promise<LoadResult<RequestStore[]>> {
  const { data, error } = await supabase
    .from("orders")
    .select("store_id,expected_at,store:stores(id,name,address,city)")
    .in("status", ["pending", "in_route"])
    .limit(500);
  if (error !== null) return { data: null, error };

  const grouped = new Map<
    number,
    {
      name: string;
      address: string | null;
      city: string | null;
      orderCount: number;
      nextExpectedAt: string | null;
    }
  >();
  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const store = raw.store as Record<string, unknown> | null;
    if (store === null) continue;
    const id = Number(store.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const current = grouped.get(id) ?? {
      name: typeof store.name === "string" ? store.name : "",
      address: typeof store.address === "string" ? store.address : null,
      city: typeof store.city === "string" ? store.city : null,
      orderCount: 0,
      nextExpectedAt: null,
    };
    current.orderCount += 1;
    const expected = typeof raw.expected_at === "string" ? raw.expected_at : null;
    if (
      expected !== null &&
      (current.nextExpectedAt === null || expected < current.nextExpectedAt)
    ) {
      current.nextExpectedAt = expected;
    }
    grouped.set(id, current);
  }
  if (grouped.size === 0) return { data: [], error: null };

  const geo = await supabase
    .from("stores_geo")
    .select("id,lat,lng")
    .in("id", [...grouped.keys()]);
  if (geo.error !== null) return { data: null, error: geo.error };
  const coords = new Map(
    ((geo.data ?? []) as Record<string, unknown>[]).map((row) => [
      Number(row.id),
      { lat: Number(row.lat), lng: Number(row.lng) },
    ]),
  );

  const rows: RequestStore[] = [];
  for (const [id, value] of grouped) {
    const point = coords.get(id);
    if (point === undefined || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
      continue;
    }
    rows.push({ id, ...value, ...point });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { data: rows, error: null };
}

/** Pedido abierto de una parada; solo lo mínimo para las acciones de Mi ruta. */
export interface RouteOrder {
  id: number;
  store_id: number;
  status: "pending" | "in_route";
}

/**
 * Pedidos abiertos del distribuidor agrupados por tienda, para las paradas de
 * Mi ruta. La RLS ya acota por rol; el filtro por distributor_id evita mezclar
 * pedidos de otra distribuidora si el usuario tuviera acceso a más de una.
 */
export async function fetchRouteOpenOrders(
  distributorId: number,
): Promise<LoadResult<Record<number, RouteOrder[]>>> {
  const { data, error } = await fetchAllRows((from, to) =>
    supabase
      .from("orders")
      .select("id,store_id,status")
      .eq("distributor_id", distributorId)
      .in("status", ["pending", "in_route"])
      .order("id")
      .range(from, to),
  );
  if (error !== null) return { data: null, error };
  const grouped: Record<number, RouteOrder[]> = {};
  for (const row of (data ?? []) as { id: number; store_id: number; status: string }[]) {
    const storeId = Number(row.store_id);
    (grouped[storeId] ??= []).push({
      id: Number(row.id),
      store_id: storeId,
      status: row.status as RouteOrder["status"],
    });
  }
  return { data: grouped, error: null };
}

const ROUTE_COLUMNS =
  "id,route_date,status,distributor_id,distributor:distributors(name),route_stops(id,stop_order,status,estimated_time,arrived_at,store_id,store:stores(name))";

function mapRouteDetail(raw: Record<string, unknown>): RouteDetail {
  const stops = ((raw.route_stops ?? []) as Record<string, unknown>[])
    .map((s) => ({
      id: Number(s.id),
      stop_order: Number(s.stop_order),
      status: s.status as StopStatus,
      estimated_time: (s.estimated_time as string | null) ?? null,
      arrived_at: (s.arrived_at as string | null) ?? null,
      store_id: Number(s.store_id),
      store_name: relName(s.store),
      lat: null as number | null,
      lng: null as number | null,
    }))
    .sort((a, b) => a.stop_order - b.stop_order);
  return {
    id: Number(raw.id),
    route_date: String(raw.route_date),
    status: raw.status as RouteStatus,
    distributor_id: Number(raw.distributor_id),
    distributor_name: relName(raw.distributor),
    stops,
  };
}

async function attachRouteGeo(routes: RouteDetail[]): Promise<void> {
  const ids = [...new Set(routes.flatMap((route) => route.stops.map((stop) => stop.store_id)))];
  if (ids.length === 0) return;
  const geo = await supabase.from("stores_geo").select("id,lat,lng").in("id", ids);
  if (geo.error !== null) return;
  const coords = new Map(
    ((geo.data ?? []) as { id: number; lat: number; lng: number }[]).map((row) => [
      Number(row.id),
      row,
    ]),
  );
  for (const route of routes) {
    for (const stop of route.stops) {
      const point = coords.get(stop.store_id);
      if (point !== undefined) {
        stop.lat = Number(point.lat);
        stop.lng = Number(point.lng);
      }
    }
  }
}

/** Ruta por id; con id null devuelve la más reciente de hoy (compatibilidad). */
export async function fetchRouteDetail(
  routeId: number | null,
  today: string,
): Promise<LoadResult<RouteDetail>> {
  let query = supabase.from("routes").select(ROUTE_COLUMNS);
  query =
    routeId === null
      ? query.eq("route_date", today).neq("status", "cancelled").order("id", { ascending: false })
      : query.eq("id", routeId);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error || !data) return { data: null, error };
  const route = mapRouteDetail(data as Record<string, unknown>);
  await attachRouteGeo([route]);
  return { data: route, error: null };
}

/** Todas las rutas no canceladas de una fecha, en orden de creación. */
export async function fetchTodayRoutes(today: string): Promise<LoadResult<RouteDetail[]>> {
  const { data, error } = await supabase
    .from("routes")
    .select(ROUTE_COLUMNS)
    .eq("route_date", today)
    .neq("status", "cancelled")
    .order("id");
  if (error !== null) return { data: null, error };
  const routes = ((data ?? []) as Record<string, unknown>[]).map(mapRouteDetail);
  await attachRouteGeo(routes);
  return { data: routes, error: null };
}

/** URL de Google Maps con las paradas en orden (sin API key). */
export function googleMapsUrl(stops: { lat: number | null; lng: number | null }[]): string | null {
  const points = stops
    .filter((s) => s.lat !== null && s.lng !== null)
    .map((s) => `${s.lat},${s.lng}`);
  if (points.length === 0) return null;
  const destination = points[points.length - 1] ?? "";
  const params = new URLSearchParams({ api: "1", destination });
  if (points.length > 1) {
    params.set("origin", points[0] ?? "");
    const middle = points.slice(1, -1);
    if (middle.length > 0) params.set("waypoints", middle.join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export interface NewStop {
  store_id: number;
  stop_order: number;
  estimated_time: string | null;
}

/** 0057: crear una ruta nueva para el distribuidor y fecha. */
export async function createRoute(
  distributorId: number,
  date: string,
  stops: NewStop[],
): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("create_route", {
    p_distributor: distributorId,
    p_route_date: date,
    p_stops: stops,
  });
  return { error };
}

/** 0057: reemplazar las paradas de una ruta planificada. */
export async function updateRouteStops(routeId: number, stops: NewStop[]): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("update_route_stops", {
    p_route: routeId,
    p_stops: stops,
  });
  return { error };
}

export async function markStop(stopId: number, status: StopStatus): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("mark_stop", { p_stop: stopId, p_status: status });
  return { error };
}

export async function updateRouteStatus(
  routeId: number,
  status: RouteStatus,
): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("update_route_status", {
    p_route: routeId,
    p_status: status,
  });
  return { error };
}
