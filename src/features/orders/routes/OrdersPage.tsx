import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { EmptyState } from "../../../shared/ui";
import { ShortagePanel } from "../../products";
import {
  Badge,
  Box,
  Field,
  Status,
  buttonClass,
  inputClass,
  runAction,
  secondaryButtonClass,
  type BadgeTone,
} from "../../../shared/ui/Box";
import {
  ORDER_STATUS_LABELS,
  confirmFullDelivery,
  fetchOrders,
  updateOrderStatus,
  type OrderStatus,
} from "../api";

const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  pending: "amber",
  in_route: "blue",
  delivered: "green",
  cancelled: "gray",
};

/** /pedidos — lista por estado (la RLS limita lo visible por rol). */
export function OrdersPage() {
  const { role } = useAuth();
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [view, setView] = useState<"orders" | "shortages">("orders");
  const orders = useLoad(() => fetchOrders(status), [status]);
  const canCreate = role === "admin" || role === "operador";
  const canSeeShortages = role === "admin" || role === "operador";
  const distributor = role === "distribuidor";
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });

  async function act(
    orderId: number,
    action: () => Promise<{ error: { message: string } | null }>,
    ok: string,
  ): Promise<void> {
    setBusyId(orderId);
    const error = await runAction(action);
    setMsg({ error, ok: error === null ? ok : null });
    if (error === null) orders.reload();
    setBusyId(null);
  }

  function deliver(orderId: number): void {
    if (
      !window.confirm(
        `¿Entregar todo el pedido #${orderId} y sumar las cantidades al stock?`,
      )
    ) {
      return;
    }
    void act(orderId, () => confirmFullDelivery(orderId), "Pedido entregado.");
  }

  return (
    <section>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
        Operación
      </p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {role === "distribuidor" ? "Mis pedidos" : "Pedidos"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Pedidos a distribuidores, estado de la entrega y lo que llega a cada tienda.
          </p>
        </div>
        {canCreate && view === "orders" && (
          <Link className={buttonClass} to="/pedidos/nuevo">
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              viewBox="0 0 24 24"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nuevo pedido
          </Link>
        )}
      </div>

      {canSeeShortages && (
        <div
          role="tablist"
          aria-label="Pedidos y faltantes"
          className="mt-4 inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "orders"}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
              view === "orders"
                ? "bg-gray-900 text-white shadow-sm"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
            onClick={() => setView("orders")}
          >
            Pedidos
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "shortages"}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
              view === "shortages"
                ? "bg-gray-900 text-white shadow-sm"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
            onClick={() => setView("shortages")}
          >
            Faltantes
          </button>
        </div>
      )}

      {view === "orders" ? (
        <Box title="Listado">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-48">
            <Field label="Estado">
              <select
                className={inputClass}
                value={status}
                onChange={(e) => setStatus(e.target.value as OrderStatus | "all")}
              >
                <option value="all">Todos</option>
                {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {orders.data !== null && (
            <span className="mb-3 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-500">
              {orders.data.length} {orders.data.length === 1 ? "pedido" : "pedidos"}
            </span>
          )}
        </div>
        <Status loading={orders.loading} error={orders.error} />
        <Status error={msg.error} ok={msg.ok} />
        {orders.data?.length === 0 && !orders.loading && (
          <EmptyState
            title="No hay pedidos"
            hint="Cuando se cree un pedido o cambie el filtro, la lista se actualiza acá."
          />
        )}
        {orders.data !== null && orders.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Estado</th>
                  <th>Tienda</th>
                  <th>Distribuidor</th>
                  <th>Fecha prometida</th>
                  {distributor && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {orders.data.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link
                        className="font-medium text-gray-900 underline-offset-4 hover:underline"
                        to={`/pedidos/${o.id}`}
                      >
                        #{o.id}
                      </Link>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                    </td>
                    <td>{o.store_name}</td>
                    <td>{o.distributor_name || "—"}</td>
                    <td className="whitespace-nowrap">
                      {o.expected_at ? new Date(o.expected_at).toLocaleDateString("es-CO") : "—"}
                    </td>
                    {distributor && (
                      <td>
                        <span className="flex flex-wrap gap-1.5">
                          {o.status === "pending" && (
                            <button
                              className={`${secondaryButtonClass} px-2.5 py-1 text-xs`}
                              type="button"
                              disabled={busyId === o.id}
                              onClick={() =>
                                void act(
                                  o.id,
                                  () => updateOrderStatus(o.id, "in_route", null),
                                  "Pedido en ruta.",
                                )
                              }
                            >
                              En ruta
                            </button>
                          )}
                          {o.status === "in_route" && (
                            <>
                              <button
                                className={`${secondaryButtonClass} px-2.5 py-1 text-xs`}
                                type="button"
                                disabled={busyId === o.id}
                                onClick={() =>
                                  void act(
                                    o.id,
                                    () => updateOrderStatus(o.id, "pending", null),
                                    "Pedido devuelto a pendiente.",
                                  )
                                }
                              >
                                Devolver a pendiente
                              </button>
                              <button
                                className={`${buttonClass} px-2.5 py-1 text-xs`}
                                type="button"
                                disabled={busyId === o.id}
                                onClick={() => deliver(o.id)}
                              >
                                Entregar todo
                              </button>
                            </>
                          )}
                          {o.status !== "pending" && o.status !== "in_route" && (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>
      ) : (
        <div className="mt-4">
          <ShortagePanel />
        </div>
      )}
    </section>
  );
}
