import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { Badge, Box, Field, Status, buttonClass, inputClass, runAction } from "../../../shared/ui/Box";
import {
  ROUTE_LABELS,
  STOP_LABELS,
  fetchDistributors,
  fetchGeoStores,
  fetchRouteDetail,
  fetchRoutes,
  googleMapsUrl,
  markStop,
  saveRoute,
  updateRouteStatus,
  type RouteDetail,
} from "../api";

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
}

/** Vista de una ruta: paradas en orden, enlace a Google Maps y acciones. */
function RouteView({ route, onChanged }: { route: RouteDetail; onChanged: () => void }) {
  const { role } = useAuth();
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({ error: null, ok: null });
  const mapsUrl = googleMapsUrl(route.stops);

  async function act(action: () => Promise<{ error: { message: string } | null }>, ok: string) {
    const error = await runAction(action);
    setMsg({ error, ok: error === null ? ok : null });
    if (error === null) onChanged();
  }

  return (
    <Box title={`Ruta del ${route.route_date} — ${route.distributor_name} (${ROUTE_LABELS[route.status]})`}>
      <Status error={msg.error} ok={msg.ok} />
      {mapsUrl && (
        <p>
          <a className="underline" href={mapsUrl} target="_blank" rel="noopener noreferrer">
            Abrir recorrido en Google Maps
          </a>
        </p>
      )}
      <ol className="mt-2 list-decimal pl-5 text-sm">
        {route.stops.map((s) => (
          <li key={s.id} className="mb-1">
            {s.store_name} {s.estimated_time && `(${s.estimated_time.slice(0, 5)})`}{" "}
            <Badge tone={s.status === "completed" ? "green" : s.status === "skipped" ? "gray" : s.status === "arrived" ? "blue" : "amber"}>
              {STOP_LABELS[s.status]}
            </Badge>
            {s.lat !== null && ` · ${s.lat.toFixed(5)}, ${s.lng?.toFixed(5)}`}
            {role === "distribuidor" && (s.status === "pending" || s.status === "arrived") && (
              <span className="ml-2 inline-flex gap-1">
                {s.status === "pending" && (
                  <button className={buttonClass} type="button" onClick={() => void act(() => markStop(s.id, "arrived"), "Llegada registrada.")}>
                    Llegué
                  </button>
                )}
                <button className={buttonClass} type="button" onClick={() => void act(() => markStop(s.id, "completed"), "Parada completada.")}>
                  Completada
                </button>
                <button className={buttonClass} type="button" onClick={() => void act(() => markStop(s.id, "skipped"), "Parada omitida.")}>
                  Omitir
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-2 flex flex-wrap gap-2">
        {role === "admin" && route.status === "planned" && (
          <button className={buttonClass} type="button" onClick={() => void act(() => updateRouteStatus(route.id, "active"), "Ruta iniciada.")}>
            Iniciar ruta
          </button>
        )}
        {role === "distribuidor" && route.status === "planned" && (
          <p className="text-sm text-gray-600">El administrador debe iniciar la ruta para poder terminarla.</p>
        )}
        {((role === "admin" && (route.status === "planned" || route.status === "active")) ||
          (role === "distribuidor" && route.status === "active")) && (
          <button className={buttonClass} type="button" onClick={() => void act(() => updateRouteStatus(route.id, "completed"), "Ruta completada.")}>
            Terminar ruta
          </button>
        )}
        {role === "admin" && route.status !== "completed" && route.status !== "cancelled" && (
          <button className={buttonClass} type="button" onClick={() => void act(() => updateRouteStatus(route.id, "cancelled"), "Ruta cancelada.")}>
            Cancelar ruta
          </button>
        )}
      </div>
    </Box>
  );
}

/** /mi-ruta — ruta de hoy del distribuidor. */
export function MyRoutePage() {
  const today = todayIso();
  const route = useLoad(() => fetchRouteDetail(null, today), [today]);
  return (
    <section>
      <h1 className="text-xl font-semibold">Mi ruta de hoy</h1>
      <Status loading={route.loading} error={route.error} />
      {!route.loading && route.data === null && !route.error && <p>No tenés ruta para hoy.</p>}
      {route.data && <RouteView route={route.data} onChanged={route.reload} />}
    </section>
  );
}

/** /rutas/:routeId — detalle (admin). */
export function RouteDetailPage() {
  const routeId = Number(useParams().routeId);
  const route = useLoad(() => fetchRouteDetail(routeId, todayIso()), [routeId]);
  return (
    <section>
      <p>
        <Link className="underline" to="/rutas">
          ← Rutas
        </Link>
      </p>
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
  const [stops, setStops] = useState<{ storeId: string; time: string }[]>([{ storeId: "", time: "" }]);
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({ error: null, ok: null });

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
      <h1 className="text-xl font-semibold">Rutas</h1>
      <Box title="Planificar ruta">
        <Status error={msg.error ?? distributors.error ?? stores.error} ok={msg.ok} />
        <form onSubmit={(e) => void onSubmit(e)}>
          <Field label="Distribuidor">
            <select className={inputClass} value={distributorId} onChange={(e) => setDistributorId(e.target.value)}>
              <option value="">— elegir —</option>
              {distributors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fecha">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <p className="text-sm font-medium">Paradas (en orden)</p>
          {stops.map((s, index) => (
            <div key={index} className="mb-2 flex flex-wrap gap-2">
              <span className="self-center text-sm">{index + 1}.</span>
              <select
                aria-label={`Tienda de la parada ${index + 1}`}
                className={inputClass}
                value={s.storeId}
                onChange={(e) => setStops(stops.map((x, i) => (i === index ? { ...x, storeId: e.target.value } : x)))}
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
                onChange={(e) => setStops(stops.map((x, i) => (i === index ? { ...x, time: e.target.value } : x)))}
              />
              <button className={buttonClass} type="button" onClick={() => move(index, -1)}>
                ↑
              </button>
              <button className={buttonClass} type="button" onClick={() => move(index, 1)}>
                ↓
              </button>
              <button className={buttonClass} type="button" onClick={() => setStops(stops.filter((_, i) => i !== index))}>
                Quitar
              </button>
            </div>
          ))}
          <button className={buttonClass} type="button" onClick={() => setStops([...stops, { storeId: "", time: "" }])}>
            + Agregar parada
          </button>{" "}
          <button className={buttonClass} type="submit">
            Guardar ruta
          </button>
        </form>
      </Box>
      <Box title="Rutas recientes">
        <Status loading={routes.loading} error={routes.error} />
        <ul className="list-disc pl-5 text-sm">
          {routes.data?.map((r) => (
            <li key={r.id}>
              <Link className="underline" to={`/rutas/${r.id}`}>
                {r.route_date} — {r.distributor_name}
              </Link>{" "}
              <Badge tone={r.status === "completed" ? "green" : r.status === "cancelled" ? "gray" : r.status === "active" ? "blue" : "amber"}>
                {ROUTE_LABELS[r.status]}
              </Badge>
            </li>
          ))}
        </ul>
      </Box>
    </section>
  );
}
