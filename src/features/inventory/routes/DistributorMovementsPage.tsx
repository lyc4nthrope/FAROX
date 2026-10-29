import { useState, type FormEvent } from "react";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import {
  EmptyState,
  ProductPicker,
  QuantityStepper,
  type ProductPickerOption,
} from "../../../shared/ui";
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
import {
  fetchDistributorMovements,
  fetchDistributorStores,
  registerDistributorSale,
} from "../api";
import { fetchDistributorCatalog } from "../../products/api";

type TypeFilter = "all" | "entry" | "exit";

const FILTERS: readonly { id: TypeFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "entry", label: "Entradas" },
  { id: "exit", label: "Salidas" },
];

/**
 * /movimientos del distribuidor: el mismo lenguaje visual que la pestaña de
 * movimientos del operador (MovementList), con la tienda de cada movimiento.
 * Para el distribuidor una entrega/venta se ve como SALIDA; el stock de la
 * tienda recibe la entrada. Premium puede registrar una venta directa.
 */
export function DistributorMovementsPage() {
  const { premium } = useAuth();
  const movements = useLoad(fetchDistributorMovements, []);
  const stores = useLoad(fetchDistributorStores, []);
  const products = useLoad<ProductPickerOption[]>(async () => {
    // Solo Premium abre el modal de venta directa: sin Premium no se pide el
    // catálogo completo (500 filas) para una acción que no puede usar.
    if (!premium) return { data: [], error: null };
    const result = await fetchDistributorCatalog({
      page: 0,
      pageSize: 500,
      q: "",
      categoryId: null,
      onlyShortage: false,
    });
    return {
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        brand: row.brand?.name ?? null,
      })),
      error: result.error,
    };
  }, [premium]);
  const [type, setType] = useState<TypeFilter>("all");
  const [saleOpen, setSaleOpen] = useState(false);
  const [sale, setSale] = useState({
    storeId: "",
    productId: "",
    quantity: "1",
    price: "",
    expiry: "",
  });
  const [saving, setSaving] = useState(false);
  const [saleMsg, setSaleMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });
  const rows = (movements.data ?? []).filter(
    (movement) => type === "all" || (movement.direction ?? movement.type) === type,
  );
  const empty = (movements.data ?? []).length === 0;
  const selectedProduct = products.data?.find(
    (product) => String(product.id) === sale.productId,
  );

  async function onSale(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (sale.storeId === "" || sale.productId === "") {
      setSaleMsg({ error: "Elegí tienda y producto.", ok: null });
      return;
    }
    const quantity = Number(sale.quantity);
    const price = Number(sale.price);
    if (!(quantity > 0)) {
      setSaleMsg({ error: "La cantidad debe ser mayor a 0.", ok: null });
      return;
    }
    if (!(price > 0)) {
      setSaleMsg({ error: "El precio de venta debe ser mayor a 0.", ok: null });
      return;
    }
    setSaving(true);
    const error = await runAction(() =>
      registerDistributorSale({
        storeId: Number(sale.storeId),
        productId: Number(sale.productId),
        quantity,
        unitPrice: price,
        expiryDate: sale.expiry === "" ? null : sale.expiry,
      }),
    );
    setSaving(false);
    if (error !== null) {
      setSaleMsg({ error, ok: null });
      return;
    }
    setSaleMsg({ error: null, ok: null });
    setSale({
      storeId: "",
      productId: "",
      quantity: "1",
      price: "",
      expiry: "",
    });
    setSaleOpen(false);
    movements.reload();
  }

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Movimientos
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Movimientos</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Tus entregas y ventas directas a las tiendas. Para vos son salidas; el stock de la tienda
        recibe la entrada con el precio de venta.
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
              <button
                className={`${buttonClass} px-3 py-1.5 text-xs`}
                type="button"
                onClick={() => {
                  setSaleMsg({ error: null, ok: null });
                  setSaleOpen(true);
                }}
              >
                Registrar venta
              </button>
            ) : (
              <span className="text-xs text-gray-500">
                Registrar venta es una función Premium.
              </span>
            )}
          </div>
        </div>

        <Status loading={movements.loading} error={movements.error} />
        {rows.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title={empty ? "Todavía no hay movimientos" : "No hay movimientos de este tipo"}
              hint={
                empty
                  ? "Las entregas que confirmes y tus ventas directas van a aparecer acá."
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
              onClick={() => movements.reload()}
            >
              Actualizar
            </button>
          </div>
        )}
      </div>

      {saleOpen && (
        <Modal
          title="Registrar venta a una tienda"
          onClose={() => setSaleOpen(false)}
        >
          <Status error={saleMsg.error} />
          <form onSubmit={(event) => void onSale(event)}>
            <Status loading={stores.loading} error={stores.error} />
            <Field label="Tienda vinculada">
              <select
                className={inputClass}
                value={sale.storeId}
                onChange={(event) => setSale({ ...sale, storeId: event.target.value })}
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

            <ProductPicker
              label="Producto de mi catálogo"
              value={sale.productId}
              onChange={(value) => setSale({ ...sale, productId: value })}
              options={products.data ?? []}
              loading={products.loading}
              error={products.error}
              required
              autoFocusSearch
              emptyHint="Tu catálogo está vacío: agregá productos primero."
            />

            <div className="mb-4">
              <span className="block text-xs font-semibold tracking-wide text-gray-600">
                Cantidad
              </span>
              <div className="mt-1.5">
                <QuantityStepper
                  label={selectedProduct?.name ?? "venta"}
                  value={sale.quantity}
                  onChange={(quantity) => setSale({ ...sale, quantity })}
                />
              </div>
            </div>

            <Field label="Precio de venta (COP)">
              <input
                className={inputClass}
                type="number"
                min="0.01"
                step="0.01"
                value={sale.price}
                onChange={(event) => setSale({ ...sale, price: event.target.value })}
                required
              />
            </Field>
            <Field label="Vencimiento (opcional)">
              <input
                className={inputClass}
                type="date"
                value={sale.expiry}
                onChange={(event) => setSale({ ...sale, expiry: event.target.value })}
              />
            </Field>
            <button className={buttonClass} type="submit" disabled={saving}>
              {saving ? "Registrando…" : "Registrar venta"}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
