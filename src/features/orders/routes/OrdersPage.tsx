import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { Badge, Box, Status, inputClass, type BadgeTone } from "../../../shared/ui/Box";
import { ORDER_STATUS_LABELS, fetchOrders, type OrderStatus } from "../api";

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
  const orders = useLoad(() => fetchOrders(status), [status]);

  return (
    <section>
      <h1 className="text-xl font-semibold">
        {role === "distribuidor" ? "Mis pedidos" : "Pedidos"}
      </h1>
      {(role === "admin" || role === "operador") && (
        <p className="mt-2">
          <Link className="underline" to="/pedidos/nuevo">
            + Nuevo pedido
          </Link>
        </p>
      )}
      <Box title="Listado">
        <label className="text-sm">
          Estado{" "}
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
        </label>
        <Status loading={orders.loading} error={orders.error} />
        {orders.data?.length === 0 && <p>No hay pedidos.</p>}
        <div className="overflow-x-auto">
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr>
              <th>#</th>
              <th>Estado</th>
              <th>Tienda</th>
              <th>Distribuidor</th>
              <th>Fecha prometida</th>
            </tr>
          </thead>
          <tbody>
            {orders.data?.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link className="underline" to={`/pedidos/${o.id}`}>
                    #{o.id}
                  </Link>
                </td>
                <td><Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge></td>
                <td>{o.store_name}</td>
                <td>{o.distributor_name || "—"}</td>
                <td>{o.expected_at ? new Date(o.expected_at).toLocaleDateString("es-CO") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Box>
    </section>
  );
}
