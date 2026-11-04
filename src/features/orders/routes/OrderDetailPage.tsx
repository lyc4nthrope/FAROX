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
  fetchOrderQuotes,
  fetchDistributorSalePrices,
  setOrderExpectedAt,
  setOrderPrices,
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
  const { role, premium } = useAuth();
  const order = useLoad(() => fetchOrder(orderId), [orderId]);
  const items = useLoad(() => fetchOrderItems(orderId), [orderId]);
  // 0024: la cotización viaja por su propia RPC; get_order_items sigue sin
  // exponer el precio privado de la tienda (D40/D41).
  const quoteRows = useLoad(() => fetchOrderQuotes(orderId), [orderId]);
  // 0030: el Premium estima la cotización con SU precio de venta configurado
  // en el catálogo; luego puede ajustarlo en cada línea.
  const distributorSalePrices = useLoad(
    () =>
      role === "distribuidor" && premium
        ? fetchDistributorSalePrices((items.data ?? []).map((item) => item.product_id))
        : Promise.resolve({ data: new Map<number, number>(), error: null }),
    [role, premium, items.data],
  );
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });
  const [received, setReceived] = useState<Record<number, string>>({});
  const [quoteDrafts, setQuoteDrafts] = useState<Record<number, string>>({});
  const [expectedAtDraft, setExpectedAtDraft] = useState("");
  const [dueDate, setDueDate] = useState("");

  // Por defecto, recibido = pedido; la cotización arranca con lo ya guardado.
  useEffect(() => {
    if (items.data) {
      setReceived(Object.fromEntries(items.data.map((i) => [i.product_id, String(i.quantity)])));
    }
  }, [items.data]);

  // 0025: la fecha prometida es comunicación distribuidor ↔ operador.
  useEffect(() => {
    if (order.data) {
      setExpectedAtDraft(order.data.expected_at ? order.data.expected_at.slice(0, 10) : "");
    }
  }, [order.data]);

  // Al cambiar de pedido se descartan los borradores del anterior.
  useEffect(() => {
    setQuoteDrafts({});
  }, [orderId]);

  async function act(action: () => Promise<{ error: { message: string } | null }>, ok: string) {
    const error = await runAction(action);
    setMsg({ error, ok: error === null ? ok : null });
    if (error === null) {
      order.reload();
      items.reload();
      quoteRows.reload();
    }
  }

  const o = order.data;
  const open = o !== null && (o.status === "pending" || o.status === "in_route");
  const showPrice = items.data?.some((i) => i.unit_price !== null) ?? false;

  async function onConfirm() {
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
    // 0029: si el distribuidor ajustó la cotización, se persiste antes de
    // entregar para que el movimiento de salida registre ese precio de venta.
    if (canQuote) {
      const priced = (items.data ?? [])
        .map((item) => ({
          productId: item.product_id,
          raw: quoteValue(item.product_id).trim(),
        }))
        .filter((entry) => entry.raw !== "");
      if (
        priced.some(
          (entry) => !Number.isFinite(Number(entry.raw)) || Number(entry.raw) <= 0,
        )
      ) {
        setMsg({ error: "Cada precio cotizado debe ser mayor a 0.", ok: null });
        return;
      }
      if (priced.length > 0) {
        const priceError = await runAction(() =>
          setOrderPrices(
            orderId,
            priced.map((entry) => ({
              product_id: entry.productId,
              distributor_price: Number(entry.raw),
            })),
          ),
        );
        if (priceError !== null) {
          setMsg({ error: priceError, ok: null });
          return;
        }
      }
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

  // 0025: el ciclo operativo (ruta/entrega/fecha) es del distribuidor; el
  // admin conserva el override.
  const canDispatch = o !== null && (role === "admin" || role === "distribuidor");

  function onSaveExpectedAt() {
    // Mediodía UTC: la fecha se ve igual en la zona horaria de Colombia
    // (UTC-5); a medianoche UTC el resumen mostraba el día anterior.
    const value = expectedAtDraft === "" ? null : `${expectedAtDraft}T12:00:00Z`;
    void act(() => setOrderExpectedAt(orderId, value), "Fecha prometida actualizada.");
  }

  // 0024: el distribuidor cotiza lo que le cobra a la tienda mientras el
  // pedido sigue pendiente. El admin puede corregir la cotización.
  const canQuote =
    o !== null &&
    (o.status === "pending" || o.status === "in_route") &&
    (role === "admin" || role === "distribuidor");

  // La cotización guardada es el valor por defecto; el borrador local gana
  // mientras el usuario edita (no hay carrera con el fetch).
  const savedQuotes = new Map(
    (quoteRows.data ?? []).map((row) => [row.product_id, row.distributor_price]),
  );
  const quoteValue = (productId: number): string => {
    const draft = quoteDrafts[productId];
    if (draft !== undefined) return draft;
    const saved = savedQuotes.get(productId);
    if (saved !== null && saved !== undefined) return String(saved);
    // 0030: primero el precio de venta propio del distribuidor (su catálogo).
    if (premium) {
      const own = distributorSalePrices.data?.get(productId);
      if (own !== undefined) return String(own);
    }
    // 0028: si no configuró precio, el precio registrado de la tienda sigue
    // siendo una sugerencia editable para Premium.
    const registered = premium
      ? (items.data ?? []).find((item) => item.product_id === productId)?.unit_price ?? null
      : null;
    return registered === null ? "" : String(registered);
  };

  function onQuote() {
    const priced = (items.data ?? [])
      .map((item) => ({ productId: item.product_id, value: quoteValue(item.product_id) }))
      .filter((entry) => entry.value.trim() !== "");
    if (priced.length === 0) {
      setMsg({ error: "Ingresá al menos un precio para cotizar.", ok: null });
      return;
    }
    const payload = priced.map((entry) => ({
      product_id: entry.productId,
      distributor_price: Number(entry.value),
    }));
    if (
      payload.some((p) => !Number.isFinite(p.distributor_price) || p.distributor_price <= 0)
    ) {
      setMsg({ error: "Cada precio cotizado debe ser mayor a 0.", ok: null });
      return;
    }
    void act(() => setOrderPrices(orderId, payload), "Cotización guardada.");
  }

  const quotedTotal = (items.data ?? []).reduce((total, item) => {
    const value = Number(quoteValue(item.product_id));
    return Number.isFinite(value) && value > 0 ? total + value * item.quantity : total;
  }, 0);

  // Lectura para quien no cotiza (operador Premium): muestra lo ya cotizado
  // sin ofrecer el formulario. get_order_quotes devuelve cero filas si no
  // tiene permiso (no-premium).
  const savedQuoteTotal = (items.data ?? []).reduce((total, item) => {
    const saved = savedQuotes.get(item.product_id);
    return saved == null ? total : total + saved * item.quantity;
  }, 0);
  const showQuoteReadOnly =
    !canQuote && (quoteRows.data ?? []).some((row) => row.distributor_price !== null);

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

      {o && open && canDispatch && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
          <span className="mr-1 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
            Acciones
          </span>
          {o.status === "pending" && (
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
          {o.status === "in_route" && canDispatch && (
            <button
              className={secondaryButtonClass}
              type="button"
              onClick={() =>
                void act(
                  () => updateOrderStatus(orderId, "pending", null),
                  "Pedido devuelto a pendiente.",
                )
              }
            >
              Volver a pendiente
            </button>
          )}
          <button className={buttonClass} type="button" onClick={onConfirm}>
            Confirmar entrega
          </button>
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
      )}

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
                {showQuoteReadOnly && <th>Cotización</th>}
                {open && canDispatch && <th>Recibir</th>}
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
                  {showQuoteReadOnly && (
                    <td>
                      {savedQuotes.get(i.product_id) == null
                        ? "—"
                        : formatCOP(savedQuotes.get(i.product_id) as number)}
                    </td>
                  )}
                  {open && canDispatch && (
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
        {showQuoteReadOnly && (
          <p className="mt-3 text-sm text-gray-600">
            Total cotizado por el distribuidor:{" "}
            <span className="font-semibold tabular-nums text-gray-900">
              {formatCOP(savedQuoteTotal)}
            </span>
          </p>
        )}
      </Box>

      {o && open && role === "operador" && (
        <p className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          El distribuidor marca el pedido en ruta y confirma la entrega. Vos seguís el estado acá.
        </p>
      )}

      {canQuote && (
        <Box title="Cotización del distribuidor">
          <p className="text-sm text-gray-600">
            Definí cuánto le cobrás a la tienda por cada producto. Podés ajustarlo mientras el
            pedido siga abierto (pendiente o en ruta); el precio queda congelado en el movimiento
            de la entrega.
          </p>
          <div className="mt-3 space-y-2">
            {items.data?.map((item) => (
              <div
                key={item.product_id}
                className="grid gap-2 rounded-xl border border-gray-100 bg-gray-50/50 p-2 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-end"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{item.product_name}</p>
                  <p className="text-xs text-gray-500">
                    Cantidad pedida: <span className="tabular-nums">{item.quantity}</span>
                  </p>
                </div>
                <Field label={`Precio de ${item.product_name}`}>
                  <input
                    className={inputClass}
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="Sin precio"
                    value={quoteValue(item.product_id)}
                    onChange={(event) =>
                      setQuoteDrafts({ ...quoteDrafts, [item.product_id]: event.target.value })
                    }
                  />
                </Field>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              Total cotizado:{" "}
              <span className="font-semibold tabular-nums text-gray-900">
                {formatCOP(quotedTotal)}
              </span>
            </p>
            <button className={buttonClass} type="button" onClick={onQuote}>
              Guardar cotización
            </button>
          </div>
        </Box>
      )}

      {o && open && canDispatch && (
        <Box title="Entrega y comunicación">
          <p className="text-sm text-gray-600">
            La fecha prometida es opcional y el operador la ve en el resumen. La alerta de pedido
            atrasado se activa al pasar esta fecha: para plazos largos, elegí una fecha lejana; sin
            fecha no se genera alerta.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Fecha prometida (opcional)">
              <input
                className={inputClass}
                type="date"
                value={expectedAtDraft}
                onChange={(event) => setExpectedAtDraft(event.target.value)}
              />
            </Field>
            <button className={buttonClass} type="button" onClick={onSaveExpectedAt}>
              Guardar fecha
            </button>
            {o.expected_at !== null && (
              <button
                className={secondaryButtonClass}
                type="button"
                onClick={() => {
                  setExpectedAtDraft("");
                  void act(() => setOrderExpectedAt(orderId, null), "Fecha prometida quitada.");
                }}
              >
                Quitar fecha
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
