import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { EmptyState } from "../../../shared/ui";
import {
  Badge,
  Box,
  Field,
  Status,
  buttonClass,
  inputClass,
  runAction,
  secondaryButtonClass,
} from "../../../shared/ui/Box";
import { StoreRouteMap } from "../components/StoreRouteMap";
import {
  ROUTE_LABELS,
  STOP_LABELS,
  fetchDistributors,
  fetchGeoStores,
  fetchRouteDetail,
  fetchRoutes,
  fetchStoresWithRequests,
  googleMapsUrl,
  markStop,
  saveRoute,
  updateRouteStatus,
  type RouteDetail,
} from "../api";

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
}

function formatRouteDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatExpectedDate(value: string | null): string {
  if (value === null) return "sin fecha";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
}

/** Vista de una ruta: paradas en orden, enlace a Google Maps y acciones. */
function RouteView({ route, onChanged }: { route: RouteDetail; onChanged: () => void }) {
  const { role } = useAuth();
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });
  const mapsUrl = googleMapsUrl(route.stops);

  async function act(action: () => Promise<{ error: { message: string } | null }>, ok: string) {
    const error = await runAction(action);
    setMsg({ error, ok: error === null ? ok : null });
    if (error === null) onChanged();
  }

  return (
    <Box title={`Ruta del ${formatRouteDate(route.route_date)} · ${route.distributor_name}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge
          tone={
            route.status === "completed"
              ? "green"
              : route.status === "cancelled"
                ? "gray"
                : route.status === "active"
                  ? "blue"
                  : "amber"
          }
        >
          {ROUTE_LABELS[route.status]}
        </Badge>
        {mapsUrl && (
          <a className={buttonClass} href={mapsUrl} target="_blank" rel="noopener noreferrer">
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M12 21s6-4.6 6-10a6 6 0 1 0-12 0c0 5.4 6 10 6 10Z" />
              <circle cx="12" cy="11" r="2" />
            </svg>
            Abrir recorrido en Google Maps
          </a>
        )}
      </div>
      <Status error={msg.error} ok={msg.ok} />

      <ol className="mt-4 space-y-2">
        {route.stops.map((s, index) => (
          <li key={s.id} className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{s.store_name}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {s.estimated_time
                      ? `Hora estimada ${s.estimated_time.slice(0, 5)}`
                      : "Sin hora estimada"}
                    {s.lat !== null && s.lng !== null
                      ? ` · ${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`
                      : ""}
                  </p>
                </div>
              </div>
              <Badge
                tone={
                  s.status === "completed"
                    ? "green"
                    : s.status === "skipped"
                      ? "gray"
                      : s.status === "arrived"
                        ? "blue"
                        : "amber"
                }
              >
                {STOP_LABELS[s.status]}
              </Badge>
            </div>
            {role === "distribuidor" && (s.status === "pending" || s.status === "arrived") && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.status === "pending" && (
                  <button
                    className={`${secondaryButtonClass} px-2.5 py-1 text-xs`}
                    type="button"
                    onClick={() => void act(() => markStop(s.id, "arrived"), "Llegada registrada.")}
                  >
                    Llegué
                  </button>
                )}
                <button
                  className={`${secondaryButtonClass} px-2.5 py-1 text-xs`}
                  type="button"
                  onClick={() => void act(() => markStop(s.id, "completed"), "Parada completada.")}
                >
                  Completada
                </button>
                <button
                  className={`${secondaryButtonClass} px-2.5 py-1 text-xs`}
                  type="button"
                  onClick={() => void act(() => markStop(s.id, "skipped"), "Parada omitida.")}
                >
                  Omitir
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {role === "admin" && route.status === "planned" && (
          <button
            className={buttonClass}
            type="button"
            onClick={() => void act(() => updateRouteStatus(route.id, "active"), "Ruta iniciada.")}
          >
            Iniciar ruta
          </button>
        )}
        {role === "distribuidor" && route.status === "planned" && (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
            El administrador debe iniciar la ruta para poder terminarla.
          </p>
        )}
        {((role === "admin" && (route.status === "planned" || route.status === "active")) ||
          (role === "distribuidor" && route.status === "active")) && (
          <button
            className={buttonClass}
            type="button"
            onClick={() =>
              void act(() => updateRouteStatus(route.id, "completed"), "Ruta completada.")
            }
          >
            Terminar ruta
          </button>
        )}
        {role === "admin" && route.status !== "completed" && route.status !== "cancelled" && (
          <button
            className={`${secondaryButtonClass} border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800`}
            type="button"
            onClick={() =>
              void act(() => updateRouteStatus(route.id, "cancelled"), "Ruta cancelada.")
            }
          >
            Cancelar ruta
          </button>
        )}
      </div>
    </Box>
  );
}

/** /mi-ruta — mapa + selector de tiendas con solicitudes y ruta asignada. */
export function MyRoutePage() {
  const today = todayIso();
  const route = useLoad(() => fetchRouteDetail(null, today), [today]);
  const requests = useLoad(fetchStoresWithRequests, []);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const initialized = useRef(false);

  // Arrancan todas marcadas: el mapa se ve poblado y desmarcar es un clic.
  useEffect(() => {
    if (initialized.current || requests.data === null) return;
    initialized.current = true;
    setSelectedIds(new Set(requests.data.map((store) => store.id)));
  }, [requests.data]);

  const stores = useMemo(() => requests.data ?? [], [requests.data]);
  const selectedStores = useMemo(
    () => stores.filter((store) => selectedIds.has(store.id)),
    [stores, selectedIds],
  );
  const selectedOrders = selectedStores.reduce((total, store) => total + store.orderCount, 0);
  const mapsUrl = googleMapsUrl(selectedStores);
  const orderIndex = new Map(selectedStores.map((store, index) => [store.id, index + 1]));

  function toggle(storeId: number): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      return next;
    });
  }

  function selectAll(): void {
    setSelectedIds(new Set(stores.map((store) => store.id)));
  }

  function clearAll(): void {
    setSelectedIds(new Set());
  }

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Logística
      </p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ruta del día</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Marcá las tiendas con solicitudes, ubicalas en el mapa y abrí el recorrido en Google
            Maps. La ruta se arma en tu navegador, no guardamos el recorrido.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
            {formatRouteDate(today)}
          </span>
          <span className="border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
            {selectedStores.length} de {stores.length} tiendas
          </span>
        </div>
      </div>

      <Status loading={requests.loading} error={requests.error} />

      <div className="mt-5 grid border border-gray-300 bg-white lg:grid-cols-[minmax(0,1.55fr)_minmax(20rem,1fr)]">
        <section
          aria-label="Mapa de tiendas"
          className="min-w-0 border-b border-gray-300 lg:border-b-0 lg:border-r"
        >
          <header className="flex items-center justify-between border-b border-gray-300 px-4 py-2.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-700">
              Mapa
            </h2>
            <span className="text-[11px] text-gray-500">Solo tiendas marcadas</span>
          </header>
          <div className="h-[24rem] lg:h-[34rem]">
            <StoreRouteMap stores={selectedStores} />
          </div>
        </section>

        <section className="min-w-0" aria-label="Tiendas con solicitudes">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-300 px-4 py-2.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-700">
              Tiendas con solicitudes
            </h2>
            <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
              <button
                type="button"
                className="underline underline-offset-4 hover:text-gray-900"
                onClick={selectAll}
              >
                Marcar todas
              </button>
              <button
                type="button"
                className="underline underline-offset-4 hover:text-gray-900"
                onClick={clearAll}
              >
                Limpiar
              </button>
            </div>
          </header>

          {stores.length === 0 && !requests.loading ? (
            <div className="px-4 py-10">
              <EmptyState
                title="No hay tiendas con solicitudes abiertas"
                hint="Cuando tengas pedidos pendientes o en ruta, sus tiendas van a aparecer acá."
              />
            </div>
          ) : (
            <ul className="max-h-[24rem] divide-y divide-gray-200 overflow-y-auto lg:max-h-[34rem]">
              {stores.map((store) => {
                const selected = selectedIds.has(store.id);
                const index = orderIndex.get(store.id);
                return (
                  <li key={store.id}>
                    <label
                      className={`flex cursor-pointer items-start gap-3 border-l-4 px-3 py-3 transition-colors ${
                        selected
                          ? "border-gray-900 bg-gray-50"
                          : "border-transparent hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 accent-gray-900"
                        checked={selected}
                        onChange={() => toggle(store.id)}
                        aria-label={`Incluir ${store.name}`}
                      />
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border text-xs font-semibold tabular-nums ${
                          selected
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-300 text-gray-400"
                        }`}
                      >
                        {selected ? index : "—"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                          <span className="break-words text-sm font-medium text-gray-900">
                            {store.name}
                          </span>
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                            {store.orderCount}{" "}
                            {store.orderCount === 1 ? "solicitud" : "solicitudes"}
                          </span>
                        </span>
                        <span className="mt-0.5 block break-words text-xs text-gray-500">
                          {[store.address, store.city].filter(Boolean).join(" · ") ||
                            "Sin dirección"}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-gray-500">
                          Próxima entrega: {formatExpectedDate(store.nextExpectedAt)}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-x border-b border-gray-300 bg-white px-4 py-3">
        <p className="text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{selectedStores.length}</span>{" "}
          {selectedStores.length === 1 ? "tienda" : "tiendas"} ·{" "}
          <span className="font-semibold text-gray-900">{selectedOrders}</span>{" "}
          {selectedOrders === 1 ? "solicitud" : "solicitudes"}
        </p>
        {mapsUrl !== null ? (
          <a
            className="inline-flex items-center gap-2 border border-gray-900 bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M12 21s6-4.6 6-10a6 6 0 1 0-12 0c0 5.4 6 10 6 10Z" />
              <circle cx="12" cy="11" r="2" />
            </svg>
            Abrir en Google Maps
          </a>
        ) : (
          <span className="border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-400">
            Marcá al menos una tienda
          </span>
        )}
      </div>

      <div className="mt-8">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
          Ruta asignada de hoy
        </h2>
        <div className="mt-2">
          <Status loading={route.loading} error={route.error} />
          {!route.loading && route.data === null && !route.error && (
            <EmptyState
              title="No tenés ruta asignada para hoy"
              hint="Cuando el administrador planifique una ruta, vas a ver tus paradas acá."
            />
          )}
          {route.data && <RouteView route={route.data} onChanged={route.reload} />}
        </div>
      </div>
    </section>
  );
}

/** /rutas/:routeId — detalle (admin). */
export function RouteDetailPage() {
  const routeId = Number(useParams().routeId);
  const route = useLoad(() => fetchRouteDetail(routeId, todayIso()), [routeId]);
  return (
    <section>
      <Link
        to="/rutas"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 transition hover:text-gray-900"
      >
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Rutas
      </Link>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Logística
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Detalle de ruta</h1>
      <Status loading={route.loading} error={route.error} />
      {route.data && <RouteView route={route.data} onChanged={route.reload} />}
    </section>
  );
}

/** /rutas — listado y planificación (admin). */
export function RoutesPage() {
  const routes = useLoad(() => fetchRoutes(), []);
  const distributors = useLoad(() => fetchDistributors(), []);
  const stores = useLoad(() => fetchGeoStores(), []);
  const [distributorId, setDistributorId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [stops, setStops] = useState<{ storeId: string; time: string }[]>([
    { storeId: "", time: "" },
  ]);
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= stops.length) return;
    const next = [...stops];
    const [item] = next.splice(index, 1);
    if (item) next.splice(target, 0, item);
    setStops(next);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const chosen = stops.filter((s) => s.storeId !== "");
    if (distributorId === "" || chosen.length === 0) {
      setMsg({ error: "Elegí distribuidor y al menos una tienda.", ok: null });
      return;
    }
    const payload = chosen.map((s, i) => ({
      store_id: Number(s.storeId),
      stop_order: i + 1,
      estimated_time: s.time === "" ? null : s.time,
    }));
    const error = await runAction(() => saveRoute(Number(distributorId), date, payload));
    setMsg({ error, ok: error === null ? "Ruta guardada." : null });
    if (error === null) {
      routes.reload();
      setStops([{ storeId: "", time: "" }]);
    }
  }

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Logística
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Rutas</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Planificá el recorrido de cada distribuidor, ordená las paradas y seguí su avance.
      </p>

      <Box title="Planificar ruta">
        <Status error={msg.error ?? distributors.error ?? stores.error} ok={msg.ok} />
        <form onSubmit={(e) => void onSubmit(e)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Distribuidor">
              <select
                className={inputClass}
                value={distributorId}
                onChange={(e) => setDistributorId(e.target.value)}
              >
                <option value="">— elegir —</option>
                {distributors.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fecha">
              <input
                className={inputClass}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-gray-700">Paradas (en orden)</p>
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-500">
              {stops.length} {stops.length === 1 ? "parada" : "paradas"}
            </span>
          </div>
          <div className="mt-2 space-y-2">
            {stops.map((s, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-xl border border-gray-100 bg-gray-50/50 p-2 sm:grid-cols-[auto_minmax(0,1fr)_8rem_auto] sm:items-center"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white">
                  {index + 1}
                </span>
                <select
                  aria-label={`Tienda de la parada ${index + 1}`}
                  className={inputClass}
                  value={s.storeId}
                  onChange={(e) =>
                    setStops(
                      stops.map((x, i) => (i === index ? { ...x, storeId: e.target.value } : x)),
                    )
                  }
                >
                  <option value="">— tienda —</option>
                  {stores.data?.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`Hora estimada de la parada ${index + 1}`}
                  className={inputClass}
                  type="time"
                  value={s.time}
                  onChange={(e) =>
                    setStops(
                      stops.map((x, i) => (i === index ? { ...x, time: e.target.value } : x)),
                    )
                  }
                />
                <div className="flex flex-wrap gap-1">
                  <button
                    aria-label={`Subir parada ${index + 1}`}
                    className={`${secondaryButtonClass} px-2 py-1 text-xs`}
                    type="button"
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Bajar parada ${index + 1}`}
                    className={`${secondaryButtonClass} px-2 py-1 text-xs`}
                    type="button"
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    className={`${secondaryButtonClass} px-2.5 py-1 text-xs`}
                    type="button"
                    onClick={() => setStops(stops.filter((_, i) => i !== index))}
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={secondaryButtonClass}
              type="button"
              onClick={() => setStops([...stops, { storeId: "", time: "" }])}
            >
              + Agregar parada
            </button>
            <button className={buttonClass} type="submit">
              Guardar ruta
            </button>
          </div>
        </form>
      </Box>

      <Box title="Rutas recientes">
        <Status loading={routes.loading} error={routes.error} />
        {routes.data?.length === 0 && !routes.loading && (
          <EmptyState
            title="No hay rutas planificadas"
            hint="Planificá la primera ruta arriba para verla en esta lista."
          />
        )}
        <ul className="grid gap-2">
          {routes.data?.map((r) => (
            <li key={r.id}>
              <Link
                to={`/rutas/${r.id}`}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 text-sm shadow-sm transition hover:border-gray-300 hover:shadow-md"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
                    <path d="M9 4v14M15 6v14" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-gray-900">
                    {formatRouteDate(r.route_date)}
                  </span>
                  <span className="block text-xs text-gray-500">{r.distributor_name}</span>
                </span>
                <Badge
                  tone={
                    r.status === "completed"
                      ? "green"
                      : r.status === "cancelled"
                        ? "gray"
                        : r.status === "active"
                          ? "blue"
                          : "amber"
                  }
                >
                  {ROUTE_LABELS[r.status]}
                </Badge>
                <svg
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-gray-300"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      </Box>
    </section>
  );
}
