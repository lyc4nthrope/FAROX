import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { Badge, Box, Field, Status, buttonClass, inputClass, runAction } from "../../../shared/ui/Box";
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
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({ error: null, ok: null });
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
    if (payload.some((p, idx) => p.received_quantity < 0 || p.received_quantity > (items.data?.[idx]?.quantity ?? 0))) {
      setMsg({ error: "Cada cantidad recibida debe estar entre 0 y la pedida.", ok: null });
      return;
    }
    void act(() => confirmDelivery(orderId, payload), "Entrega confirmada. El stock de la tienda se actualizó.");
  }

  return (
    <section>
      <p>
        <Link className="underline" to="/pedidos">
          ← Pedidos
        </Link>
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Pedido #{orderId}</h1>
      <Status loading={order.loading} error={order.error ?? msg.error} ok={msg.ok} />
      {o && (
        <Box title="Resumen">
          <p>
            Estado:{" "}
            <Badge tone={o.status === "delivered" ? "green" : o.status === "cancelled" ? "gray" : o.status === "in_route" ? "blue" : "amber"}>
              {ORDER_STATUS_LABELS[o.status]}
            </Badge>
          </p>
          <p>Tienda: {o.store_name}</p>
          <p>Distribuidor: {o.distributor_name || (role === "distribuidor" ? "Tu distribuidora" : "—")}</p>
          <p>Fecha prometida: {o.expected_at ? new Date(o.expected_at).toLocaleDateString("es-CO") : "—"}</p>
          {o.delivered_at && <p>Entregado: {new Date(o.delivered_at).toLocaleString("es-CO")}</p>}
          {o.notes && <p>Notas: {o.notes}</p>}
          {o.cancelled_reason && <p>Motivo de cancelación: {o.cancelled_reason}</p>}
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
                <td>{i.product_name}</td>
                <td>{i.quantity}</td>
                <td>{i.received_quantity ?? "—"}</td>
                <td>{LINE_LABELS[i.status] ?? i.status}</td>
                {showPrice && <td>{i.unit_price === null ? "—" : formatCOP(i.unit_price)}</td>}
                {open && role !== "admin" && (
                  <td>
                    <input
                      aria-label={`Recibido de ${i.product_name}`}
                      className={inputClass}
                      type="number"
                      min="0"
                      max={i.quantity}
                      step="0.001"
                      value={received[i.product_id] ?? ""}
                      onChange={(e) => setReceived({ ...received, [i.product_id]: e.target.value })}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Box>

      {o && open && (
        <Box title="Acciones">
          <div className="flex flex-wrap gap-2">
            {o.status === "pending" && (role === "admin" || role === "operador") && (
              <button
                className={buttonClass}
                type="button"
                onClick={() => void act(() => updateOrderStatus(orderId, "in_route", null), "Pedido en ruta.")}
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
                className={buttonClass}
                type="button"
                onClick={() => {
                  const reason = window.prompt("Motivo de la cancelación");
                  if (reason) void act(() => updateOrderStatus(orderId, "cancelled", reason), "Pedido cancelado.");
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
          <Field label="Vencimiento del fiado (opcional)">
            <input className={inputClass} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <button
            className={buttonClass}
            type="button"
            onClick={() => void act(() => createCredit(orderId, dueDate === "" ? null : dueDate), "Crédito creado.")}
          >
            Crear crédito para este pedido
          </button>
          <p className="mt-2 text-sm">
            <Link className="underline" to="/fiado">
              Ver cartera
            </Link>
          </p>
        </Box>
      )}
    </section>
  );
}
