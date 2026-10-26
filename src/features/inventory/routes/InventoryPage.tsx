import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import {
  Badge,
  Box,
  Field,
  Status,
  TwoColumns,
  buttonClass,
  inputClass,
  runAction,
  secondaryButtonClass,
} from "../../../shared/ui/Box";
import { EmptyState, PremiumLock } from "../../../shared/ui";
import { formatCOP, formatQty } from "../../../shared/lib/format";
import {
  assignProduct,
  fetchActiveProducts,
  fetchMotives,
  fetchMovements,
  fetchMyStores,
  fetchPrices,
  fetchStock,
  fetchStoreName,
  registerMovement,
  reverseMovement,
  setPrice,
} from "../api";

/** /inventario — elegir tienda. */
export function InventoryStoresPage() {
  const { role } = useAuth();
  const stores = useLoad(() => fetchMyStores(role === "admin"), [role]);
  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Inventario
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Inventario</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Elegí una tienda para ver su stock, registrar movimientos y ajustar precios.
      </p>
      <Box title="Elegí una tienda">
        <Status loading={stores.loading} error={stores.error} />
        {stores.data?.length === 0 && (
          <EmptyState
            title="No tenés tiendas en tu alcance"
            hint="Cuando tengas una tienda asignada, va a aparecer acá."
          />
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {stores.data?.map((s) => (
            <li key={s.id}>
              <Link
                className="group flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 text-sm shadow-sm transition hover:border-gray-300 hover:shadow-md"
                to={`/inventario/${s.id}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition group-hover:bg-gray-900 group-hover:text-white">
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9Z" />
                    <path d="m3 9 1.6-4.4A1 1 0 0 1 5.5 4h13a1 1 0 0 1 .9.6L21 9M9 20v-5h6v5" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1 font-medium text-gray-900">{s.name}</span>
                <svg
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-gray-900"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                >
                  <path d="M5 12h14m-6-6 6 6-6 6" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      </Box>
    </section>
  );
}

function StockBadge({ quantity, threshold }: { quantity: number; threshold: number | null }) {
  if (quantity === 0) return <Badge tone="red">Agotado</Badge>;
  if (threshold !== null && quantity <= threshold) return <Badge tone="amber">Bajo</Badge>;
  return <Badge tone="green">OK</Badge>;
}

/** /inventario/:storeId — stock, movimientos y precios de una tienda. */
export function InventoryPage() {
  const storeId = Number(useParams().storeId);
  const { role, premium } = useAuth();
  const isAdmin = role === "admin";

  const storeName = useLoad(() => fetchStoreName(storeId), [storeId]);
  const stock = useLoad(() => fetchStock(storeId), [storeId]);
  const movements = useLoad(() => fetchMovements(storeId), [storeId]);
  const prices = useLoad(() => fetchPrices(storeId), [storeId]);
  const products = useLoad(() => fetchActiveProducts(), []);
  const motives = useLoad(() => fetchMotives(), []);

  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });

  const reloadAll = () => {
    stock.reload();
    movements.reload();
    prices.reload();
  };

  async function act(action: () => Promise<{ error: { message: string } | null }>, ok: string) {
    const error = await runAction(action);
    setMsg({ error, ok: error === null ? ok : null });
    if (error === null) reloadAll();
  }

  // --- asignar producto
  const [assign, setAssign] = useState({ productId: "", threshold: "" });
  function onAssign(event: FormEvent) {
    event.preventDefault();
    if (assign.productId === "") return;
    void act(
      () =>
        assignProduct(
          storeId,
          Number(assign.productId),
          assign.threshold === "" ? null : Number(assign.threshold),
        ),
      "Producto asignado.",
    );
  }

  // --- movimiento
  const [mov, setMov] = useState({
    type: "entry" as "entry" | "exit",
    productId: "",
    quantity: "",
    motiveId: "",
    expiry: "",
  });
  function onMovement(event: FormEvent) {
    event.preventDefault();
    if (mov.productId === "" || mov.motiveId === "" || Number(mov.quantity) <= 0) {
      setMsg({ error: "Completá producto, cantidad (> 0) y motivo.", ok: null });
      return;
    }
    void act(
      () =>
        registerMovement({
          type: mov.type,
          storeId,
          productId: Number(mov.productId),
          quantity: Number(mov.quantity),
          motiveId: Number(mov.motiveId),
          expiryDate: mov.type === "entry" && mov.expiry !== "" ? mov.expiry : null,
        }),
      "Movimiento registrado.",
    );
  }

  // --- precio
  const [price, setPriceForm] = useState({ productId: "", price: "" });
  function onPrice(event: FormEvent) {
    event.preventDefault();
    if (price.productId === "" || Number(price.price) <= 0) return;
    void act(
      () => setPrice(storeId, Number(price.productId), Number(price.price)),
      "Precio guardado.",
    );
  }

  // Movimientos que ya tienen reverso: no se pueden revertir de nuevo.
  const reversed = new Set(
    (movements.data ?? []).map((m) => m.reverso_of_id).filter((id) => id !== null),
  );

  const motiveOptions =
    motives.data?.filter((m) => m.suggested_type === null || m.suggested_type === mov.type) ?? [];

  const movementForm = (
    <>
      <form onSubmit={onMovement}>
        <Field label="Tipo">
          <select
            className={inputClass}
            value={mov.type}
            onChange={(e) =>
              setMov({ ...mov, type: e.target.value as "entry" | "exit", motiveId: "" })
            }
          >
            <option value="entry">Entrada</option>
            <option value="exit">Salida</option>
          </select>
        </Field>
        <Field label="Producto">
          <select
            className={inputClass}
            value={mov.productId}
            onChange={(e) => setMov({ ...mov, productId: e.target.value })}
          >
            <option value="">— elegir —</option>
            {stock.data?.map((r) => (
              <option key={r.product_id} value={r.product_id}>
                {r.product_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cantidad">
          <input
            className={inputClass}
            type="number"
            min="0"
            step="0.001"
            value={mov.quantity}
            onChange={(e) => setMov({ ...mov, quantity: e.target.value })}
          />
        </Field>
        <Field label="Motivo">
          <select
            className={inputClass}
            value={mov.motiveId}
            onChange={(e) => setMov({ ...mov, motiveId: e.target.value })}
          >
            <option value="">— elegir —</option>
            {motiveOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        {mov.type === "entry" && (
          <Field label="Fecha de vencimiento (opcional)">
            <input
              className={inputClass}
              type="date"
              value={mov.expiry}
              onChange={(e) => setMov({ ...mov, expiry: e.target.value })}
            />
          </Field>
        )}
        <button className={buttonClass} type="submit" disabled={!premium}>
          Registrar
        </button>
      </form>
    </>
  );

  return (
    <section>
      <Link
        to="/inventario"
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
        Tiendas
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
            Inventario
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {storeName.data ?? `Tienda #${storeId}`}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Stock, movimientos y precios de la tienda en un solo lugar.
          </p>
        </div>
        <Link className={secondaryButtonClass} to={`/tiendas/${storeId}/qr`}>
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
            <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
            <path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" />
          </svg>
          QR de vínculo
        </Link>
      </div>
      <Status error={msg.error} ok={msg.ok} />

      <Box title="Stock">
        <Status loading={stock.loading} error={stock.error} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Umbral</th>
                <th>Vence</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {stock.data?.map((r) => (
                <tr key={r.product_id}>
                  <td>{r.product_name}</td>
                  <td>{formatQty(r.quantity)}</td>
                  <td>{r.threshold === null ? "—" : formatQty(r.threshold)}</td>
                  <td>{r.expiry_date ?? "—"}</td>
                  <td>
                    <StockBadge quantity={r.quantity} threshold={r.threshold} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {stock.data?.length === 0 && <p>La tienda no tiene productos asignados.</p>}
      </Box>

      <TwoColumns>
        <Box title="Asignar producto a la tienda">
          <form onSubmit={onAssign}>
            <Field label="Producto">
              <select
                className={inputClass}
                value={assign.productId}
                onChange={(e) => setAssign({ ...assign, productId: e.target.value })}
              >
                <option value="">— elegir —</option>
                {products.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Umbral de alerta (opcional)">
              <input
                className={inputClass}
                type="number"
                min="0"
                step="0.001"
                value={assign.threshold}
                onChange={(e) => setAssign({ ...assign, threshold: e.target.value })}
              />
            </Field>
            <button className={buttonClass} type="submit">
              Asignar / actualizar umbral
            </button>
          </form>
        </Box>

        {premium ? (
          <Box title="Registrar entrada o salida">{movementForm}</Box>
        ) : (
          <PremiumLock
            title="Registrar entrada o salida"
            benefits={[
              "Registrar entradas y salidas manuales, con motivo y vencimiento.",
              "Dashboard analítico con totales y valores del rango que elijas.",
              "Precios por producto en los pedidos y QR de vínculo masivo.",
            ]}
          >
            {movementForm}
          </PremiumLock>
        )}
      </TwoColumns>

      <Box title="Últimos movimientos">
        <Status loading={movements.loading} error={movements.error} />
        {movements.data?.length === 0 ? (
          <EmptyState
            title="Todavía no hay movimientos en esta tienda"
            hint="Las entradas y salidas que registres van a aparecer acá."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Motivo</th>
                  {isAdmin && <th>Acción</th>}
                </tr>
              </thead>
              <tbody>
                {movements.data?.map((m) => (
                  <tr key={m.id}>
                    <td>{new Date(m.created_at).toLocaleString("es-CO")}</td>
                    <td>
                      {m.type === "entry" ? (
                        <Badge tone="green">Entrada</Badge>
                      ) : (
                        <Badge tone="blue">Salida</Badge>
                      )}
                    </td>
                    <td>{m.product_name}</td>
                    <td>{m.quantity}</td>
                    <td>
                      {m.reverso_of_id === null ? m.motive_name : `reverso de #${m.reverso_of_id}`}
                    </td>
                    {isAdmin && (
                      <td>
                        {m.reverso_of_id === null && !reversed.has(m.id) && (
                          <button
                            className={buttonClass}
                            type="button"
                            onClick={() => {
                              const reason = window.prompt("Motivo del reverso");
                              if (reason)
                                void act(
                                  () => reverseMovement(m.id, reason),
                                  "Movimiento revertido.",
                                );
                            }}
                          >
                            Revertir
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>

      <Box title="Precios de la tienda">
        <Status loading={prices.loading} error={prices.error} />
        <ul className="list-disc pl-5 text-sm">
          {prices.data?.map((p) => (
            <li key={p.product_id}>
              {p.product_name}: {formatCOP(p.price)}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <form className="mt-2" onSubmit={onPrice}>
            <Field label="Producto">
              <select
                className={inputClass}
                value={price.productId}
                onChange={(e) => setPriceForm({ ...price, productId: e.target.value })}
              >
                <option value="">— elegir —</option>
                {stock.data?.map((r) => (
                  <option key={r.product_id} value={r.product_id}>
                    {r.product_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Precio (COP)">
              <input
                className={inputClass}
                type="number"
                min="0"
                step="0.01"
                value={price.price}
                onChange={(e) => setPriceForm({ ...price, price: e.target.value })}
              />
            </Field>
            <button className={buttonClass} type="submit">
              Guardar precio
            </button>
          </form>
        )}
      </Box>
    </section>
  );
}
