import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
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
import { formatCOP } from "../../../shared/lib/format";
import {
  ORDER_STATUS_LABELS,
  confirmDelivery,
  createCredit,
  fetchOrder,
  fetchOrderItems,
  updateOrderStatus,
} from "../api";

const LINE_LABELS: Record<string, string> = {
  pending: "Pendiente",
  received: "Recibido",
  partial: "Parcial",
};

/** /pedidos/:orderId — detalle, cambio de estado, confirmar entrega y fiado. */
export function OrderDetailPage() {
  const orderId = Number(useParams().orderId);
  const { role } = useAuth();
  const order = useLoad(() => fetchOrder(orderId), [orderId]);
  const items = useLoad(() => fetchOrderItems(orderId), [orderId]);
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });
  const [received, setReceived] = useState<Record<number, string>>({});
  const [dueDate, setDueDate] = useState("");

  // Por defecto, recibido = pedido.
  useEffect(() => {
    if (items.data) {
      setReceived(Object.fromEntries(items.data.map((i) => [i.product_id, String(i.quantity)])));
    }
  }, [items.data]);

  async function act(action: () => Promise<{ error: { message: string } | null }>, ok: string) {
    const error = await runAction(action);
    setMsg({ error, ok: error === null ? ok : null });
    if (error === null) {
      order.reload();
      items.reload();
    }
  }

  const o = order.data;
  const open = o !== null && (o.status === "pending" || o.status === "in_route");
  const showPrice = items.data?.some((i) => i.unit_price !== null) ?? false;

  function onConfirm() {
    const payload = (items.data ?? []).map((i) => ({
      product_id: i.product_id,
      received_quantity: Number(received[i.product_id] ?? 0),
    }));
    if (
      payload.some(
        (p, idx) =>
          p.received_quantity < 0 || p.received_quantity > (items.data?.[idx]?.quantity ?? 0),
      )
    ) {
      setMsg({ error: "Cada cantidad recibida debe estar entre 0 y la pedida.", ok: null });
      return;
    }
    void act(
      () => confirmDelivery(orderId, payload),
      "Entrega confirmada. El stock de la tienda se actualizó.",
    );
  }

  const statusTone =
    o?.status === "delivered"
      ? "green"
      : o?.status === "cancelled"
        ? "gray"
        : o?.status === "in_route"
          ? "blue"
          : "amber";

  return (
    <section>
      <Link
        to="/pedidos"
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
        Pedidos
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2.5">
        <h1 className="text-2xl font-semibold tracking-tight">Pedido #{orderId}</h1>
        {o && <Badge tone={statusTone}>{ORDER_STATUS_LABELS[o.status]}</Badge>}
      </div>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Seguimiento de la entrega, cantidades recibidas y su impacto en el stock de la tienda.
      </p>
      <Status loading={order.loading} error={order.error ?? msg.error} ok={msg.ok} />

      {o && (
        <Box title="Resumen">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
              Tienda
            </dt>
            <dd className="text-gray-900">{o.store_name}</dd>
            <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
              Distribuidor
            </dt>
            <dd className="text-gray-900">
              {o.distributor_name || (role === "distribuidor" ? "Tu distribuidora" : "—")}
            </dd>
            <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
              Fecha prometida
            </dt>
            <dd className="text-gray-900">
              {o.expected_at ? new Date(o.expected_at).toLocaleDateString("es-CO") : "—"}
            </dd>
            {o.delivered_at && (
              <>
                <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
                  Entregado
                </dt>
                <dd className="text-gray-900">
                  {new Date(o.delivered_at).toLocaleString("es-CO")}
                </dd>
              </>
            )}
            {o.notes && (
              <>
                <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
                  Notas
                </dt>
                <dd className="text-gray-700">{o.notes}</dd>
              </>
            )}
            {o.cancelled_reason && (
              <>
                <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
                  Motivo de cancelación
                </dt>
                <dd className="text-red-700">{o.cancelled_reason}</dd>
              </>
            )}
          </dl>
        </Box>
      )}

      <Box title="Productos">
        <Status loading={items.loading} error={items.error} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Pedido</th>
                <th>Recibido</th>
                <th>Estado línea</th>
                {showPrice && <th>Precio unitario</th>}
                {open && role !== "admin" && <th>Recibir</th>}
              </tr>
            </thead>
            <tbody>
              {items.data?.map((i) => (
                <tr key={i.id}>
                  <td className="font-medium text-gray-900">{i.product_name}</td>
                  <td>{i.quantity}</td>
                  <td>{i.received_quantity ?? "—"}</td>
                  <td>
                    <Badge
                      tone={
                        i.status === "received"
                          ? "green"
                          : i.status === "partial"
                            ? "amber"
                            : "gray"
                      }
                    >
                      {LINE_LABELS[i.status] ?? i.status}
                    </Badge>
                  </td>
                  {showPrice && <td>{i.unit_price === null ? "—" : formatCOP(i.unit_price)}</td>}
                  {open && role !== "admin" && (
                    <td>
                      <input
                        aria-label={`Recibido de ${i.product_name}`}
                        className={`${inputClass} max-w-28`}
                        type="number"
                        min="0"
                        max={i.quantity}
                        step="0.001"
                        value={received[i.product_id] ?? ""}
                        onChange={(e) =>
                          setReceived({ ...received, [i.product_id]: e.target.value })
                        }
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.data?.length === 0 && !items.loading && (
          <p className="mt-3 text-sm text-gray-500">Este pedido no tiene líneas.</p>
        )}
      </Box>

      {o && open && (
        <Box title="Acciones">
          <div className="flex flex-wrap gap-2">
            {o.status === "pending" && (role === "admin" || role === "operador") && (
              <button
                className={buttonClass}
                type="button"
                onClick={() =>
                  void act(() => updateOrderStatus(orderId, "in_route", null), "Pedido en ruta.")
                }
              >
                Marcar en ruta
              </button>
            )}
            {(role === "operador" || role === "distribuidor") && (
              <button className={buttonClass} type="button" onClick={onConfirm}>
                Confirmar entrega
              </button>
            )}
            {role === "admin" && (
              <button
                className={`${secondaryButtonClass} border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800`}
                type="button"
                onClick={() => {
                  const reason = window.prompt("Motivo de la cancelación");
                  if (reason) {
                    void act(
                      () => updateOrderStatus(orderId, "cancelled", reason),
                      "Pedido cancelado.",
                    );
                  }
                }}
              >
                Cancelar pedido
              </button>
            )}
          </div>
        </Box>
      )}

      {/* 0023: el fiado lo puede crear el admin o el operador de la tienda del
          pedido; la RPC create_credit valida el alcance. */}
      {o && o.status === "delivered" && (role === "admin" || role === "operador") && (
        <Box title="Fiado">
          <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-4">
            <p className="text-sm text-gray-700">
              Convertí este pedido entregado en un crédito y seguí sus pagos desde la cartera.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field label="Vencimiento del fiado (opcional)">
                <input
                  className={inputClass}
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </Field>
              <button
                className={buttonClass}
                type="button"
                onClick={() =>
                  void act(
                    () => createCredit(orderId, dueDate === "" ? null : dueDate),
                    "Crédito creado.",
                  )
                }
              >
                Crear crédito para este pedido
              </button>
            </div>
            <Link
              className="mt-3 inline-flex text-sm font-medium text-gray-700 underline-offset-4 hover:text-gray-900 hover:underline"
              to="/fiado"
            >
              Ver cartera
            </Link>
          </div>
        </Box>
      )}
    </section>
  );
}
