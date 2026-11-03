import { useState, type FormEvent } from "react";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { EmptyState } from "../../../shared/ui";
import {
  Field,
  Status,
  buttonClass,
  inputClass,
  runAction,
  secondaryButtonClass,
} from "../../../shared/ui/Box";
import { Modal } from "../../../shared/ui/Modal";
import { MovementList } from "../components/MovementList";
import { MovementCart, netUnitPrice, type CartLine } from "../components/MovementCart";
import {
  fetchDistributorMovementOptions,
  fetchDistributorMovements,
  fetchDistributorPurchases,
  fetchDistributorStores,
  registerDistributorPurchasesBulk,
  registerDistributorSalesBulk,
  type MovementLineInput,
} from "../api";

type TypeFilter = "all" | "entry" | "exit";
type Mode = "sale" | "purchase";

const FILTERS: readonly { id: TypeFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "entry", label: "Entradas" },
  { id: "exit", label: "Salidas" },
];

// 0037: el color sigue el tono de MovementList (entrada/compra verde,
// salida/venta azul).
function actionClass(tone: "entry" | "exit"): string {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-white shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
  return tone === "entry"
    ? `${base} bg-emerald-600 hover:bg-emerald-700 focus-visible:outline-emerald-600`
    : `${base} bg-sky-600 hover:bg-sky-700 focus-visible:outline-sky-600`;
}

/**
 * /movimientos del distribuidor: el mismo lenguaje visual que la pestaña de
 * movimientos del operador (MovementList), con la tienda de cada movimiento.
 * Para el distribuidor una entrega/venta se ve como SALIDA; el stock de la
 * tienda recibe la entrada. Premium registra ventas y compras por ticket.
 */
export function DistributorMovementsPage() {
  const { premium } = useAuth();
  const movements = useLoad(fetchDistributorMovements, []);
  const purchases = useLoad(fetchDistributorPurchases, []);
  const stores = useLoad(fetchDistributorStores, []);
  // Solo Premium abre los tickets: sin plan no se pide el catálogo completo.
  const products = useLoad(async () => {
    if (!premium) return { data: [], error: null };
    return fetchDistributorMovementOptions();
  }, [premium]);

  const [type, setType] = useState<TypeFilter>("all");
  const [mode, setMode] = useState<Mode | null>(null);
  const [storeId, setStoreId] = useState("");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState("");
  const [expiry, setExpiry] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });

  const rows = [...(movements.data ?? []), ...(purchases.data ?? [])]
    .filter((movement) => type === "all" || (movement.direction ?? movement.type) === type)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const empty = (movements.data ?? []).length === 0 && (purchases.data ?? []).length === 0;

  function openMode(next: Mode): void {
    setMsg({ error: null, ok: null });
    setStoreId("");
    setLines([]);
    setDiscount("");
    setExpiry("");
    setMode(next);
  }

  function closeMode(): void {
    setMode(null);
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (mode === null) return;
    if (mode === "sale" && storeId === "") {
      setMsg({ error: "Elegí la tienda a la que le vendés.", ok: null });
      return;
    }
    if (lines.length === 0) {
      setMsg({ error: "Agregá al menos un producto al ticket.", ok: null });
      return;
    }
    if (lines.some((line) => !(Number(line.quantity) > 0))) {
      setMsg({ error: "La cantidad debe ser mayor a 0 en cada línea.", ok: null });
      return;
    }
    const discountValue = discount.trim() === "" ? null : Number(discount);
    if (
      discountValue !== null &&
      (!Number.isFinite(discountValue) || discountValue < 0 || discountValue > 100)
    ) {
      setMsg({ error: "El descuento debe estar entre 0 y 100.", ok: null });
      return;
    }
    const discountInput = mode === "sale" ? (discountValue?.toString() ?? "") : "";
    const payload: MovementLineInput[] = lines.map((line) => ({
      productId: line.productId,
      quantity: Number(line.quantity),
      unitPrice: netUnitPrice(line.unitPrice, discountInput),
      expiryDate: expiry === "" ? null : expiry,
    }));
    if (payload.some((line) => line.unitPrice === null)) {
      setMsg({ error: "Cada producto necesita un precio mayor a 0.", ok: null });
      return;
    }
    setSaving(true);
    const error = await runAction(() =>
      mode === "sale"
        ? registerDistributorSalesBulk({
            storeId: Number(storeId),
            lines: payload,
            discountPct: discountValue,
          })
        : registerDistributorPurchasesBulk({ lines: payload }),
    );
    setSaving(false);
    if (error !== null) {
      setMsg({ error, ok: null });
      return;
    }
    setMsg({
      error: null,
      ok: `${mode === "sale" ? "Venta" : "Compra"} registrada (${payload.length} ${
        payload.length === 1 ? "producto" : "productos"
      }).`,
    });
    setMode(null);
    setLines([]);
    setDiscount("");
    setExpiry("");
    setStoreId("");
    movements.reload();
    purchases.reload();
    products.reload();
  }

  const cart = (
    <MovementCart
      options={products.data ?? []}
      loading={products.loading}
      error={products.error}
      lines={lines}
      onChange={setLines}
      priceKind={mode === "purchase" ? "purchase" : "sale"}
      showPrices={premium}
      showDiscount={mode === "sale"}
      discount={discount}
      onDiscountChange={setDiscount}
      emptyHint="Tu catálogo está vacío: agregá productos primero."
    />
  );

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Movimientos
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Movimientos</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Tus ventas a tiendas y tus compras a proveedor en un solo historial. Para vos una venta es
        una salida; el stock de la tienda recibe la entrada con el precio de venta.
      </p>

      <div className="mt-5 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="group"
            aria-label="Tipo de movimiento"
            className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1"
          >
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                aria-pressed={type === filter.id}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  type === filter.id
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
                onClick={() => setType(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500">
              {rows.length} {rows.length === 1 ? "movimiento" : "movimientos"}
            </span>
            {premium ? (
              <>
                {type !== "exit" && (
                  <button
                    className={actionClass("entry")}
                    type="button"
                    onClick={() => openMode("purchase")}
                  >
                    Registrar compra
                  </button>
                )}
                {type !== "entry" && (
                  <button
                    className={actionClass("exit")}
                    type="button"
                    onClick={() => openMode("sale")}
                  >
                    Registrar venta
                  </button>
                )}
              </>
            ) : (
              <span className="text-xs text-gray-500">
                Registrar compras y ventas es una función Premium.
              </span>
            )}
          </div>
        </div>

        <Status loading={movements.loading || purchases.loading} error={movements.error} />
        <Status error={purchases.error} />
        <Status ok={msg.ok} />
        {rows.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title={empty ? "Todavía no hay movimientos" : "No hay movimientos de este tipo"}
              hint={
                empty
                  ? "Las entregas que confirmes, tus ventas y tus compras van a aparecer acá."
                  : "Probá con otro filtro."
              }
            />
          </div>
        ) : (
          <MovementList movements={rows} showStore showPrice={premium} />
        )}
        {rows.length > 0 && (
          <div className="mt-4 flex justify-end">
            <button
              className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}
              type="button"
              onClick={() => {
                movements.reload();
                purchases.reload();
              }}
            >
              Actualizar
            </button>
          </div>
        )}
      </div>

      {mode !== null && (
        <Modal
          title={mode === "sale" ? "Registrar venta a una tienda" : "Registrar compra a proveedor"}
          size="lg"
          onClose={closeMode}
        >
          <Status error={msg.error} />
          <form onSubmit={(event) => void onSubmit(event)}>
            {mode === "sale" && (
              <>
                <Status loading={stores.loading} error={stores.error} />
                <Field label="Tienda vinculada">
                  <select
                    className={`${inputClass} w-full`}
                    value={storeId}
                    onChange={(event) => setStoreId(event.target.value)}
                    required
                  >
                    <option value="">— elegir —</option>
                    {stores.data?.map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}

            {cart}

            <div className="mx-auto mt-4 w-full max-w-md">
              <Field label={mode === "sale" ? "Vencimiento (opcional)" : "Vencimiento (opcional)"}>
                <input
                  className={`${inputClass} w-full`}
                  type="date"
                  value={expiry}
                  onChange={(event) => setExpiry(event.target.value)}
                />
              </Field>
              <p className="-mt-2 mb-3 text-xs text-gray-500">
                {mode === "sale"
                  ? "El descuento se aplica al total y queda registrado en cada movimiento."
                  : "Cada compra suma stock a tu catálogo y guarda el costo unitario."}
              </p>
              <button className={`${buttonClass} w-full`} type="submit" disabled={saving}>
                {saving
                  ? "Registrando…"
                  : mode === "sale"
                    ? "Registrar venta"
                    : "Registrar compra"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
