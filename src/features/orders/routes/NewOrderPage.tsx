import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { formatQty } from "../../../shared/lib/format";
import { mapError } from "../../../shared/lib/errors/mapError";
import {
  Box,
  Field,
  Status,
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from "../../../shared/ui/Box";
import { ProductPicker, type ProductPickerOption } from "../../../shared/ui";
import { fetchShortageProducts } from "../../products/api";
import {
  fetchStoreDistributorProducts,
  fetchLinkedDistributorOptions,
} from "../../store-links/api";
import {
  createOrder,
  fetchDistributorOptions,
  fetchStoreOptions,
  fetchStoreProducts,
  type Option,
} from "../api";

interface Line {
  productId: string;
  quantity: string;
}

type ProductOption = Option & {
  brand: string | null;
  quantity: number | null;
  price?: number | null;
};

function idParam(value: string | null): string {
  return value !== null && /^\d+$/.test(value) && Number(value) > 0 ? value : "";
}

/** /pedidos/nuevo — tienda → distribuidor → líneas → create_order. */
export function NewOrderPage() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const admin = role === "admin";
  const [storeId, setStoreId] = useState(() => idParam(params.get("storeId")));
  const [distributorId, setDistributorId] = useState(() => idParam(params.get("distributorId")));
  const stores = useLoad(() => fetchStoreOptions(admin), [admin]);
  // El operador solo puede pedirle a un distribuidor vinculado a la tienda;
  // el admin conserva la lista global.
  const distributors = useLoad(
    () =>
      admin
        ? fetchDistributorOptions()
        : storeId === ""
          ? Promise.resolve({ data: [], error: null })
          : fetchLinkedDistributorOptions(Number(storeId)),
    [admin, storeId],
  );
  // El operador pide la intersección stock × distribuidor; el admin mantiene
  // el comportamiento previo (productos de la tienda).
  const products = useLoad<ProductOption[]>(() => {
    if (storeId === "") return Promise.resolve({ data: [], error: null });
    if (admin) return fetchStoreProducts(Number(storeId));
    if (distributorId === "") return Promise.resolve({ data: [], error: null });
    return fetchStoreDistributorProducts(Number(storeId), Number(distributorId));
  }, [admin, storeId, distributorId]);
  // S9: faltantes de la tienda para agregarlos rápido. La RPC ya acota el
  // alcance (operador: sus tiendas; admin: todas).
  const shortages = useLoad(fetchShortageProducts, []);
  const storeShortages = useMemo(
    () => (shortages.data ?? []).filter((row) => row.store_id === Number(storeId)),
    [shortages.data, storeId],
  );
  // Operador: products.data ES la intersección stock × distribuidor. Admin:
  // conserva a propósito el flujo global (solo stock), igual que create_order
  // (0024/S5); por eso el panel puede ofrecer un faltante fuera del catálogo
  // del distribuidor solo cuando quien pide es admin.
  const requestableIds = useMemo(
    () => new Set((products.data ?? []).map((product) => product.id)),
    [products.data],
  );
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: "" }]);
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // S3: /faltantes envía los productos ya elegidos. Se precargan UNA vez los
  // que existen en la intersección; si el operador cambia de distribuidor, las
  // líneas se reinician y no se vuelven a pisar. 0024: el precio ya no es
  // requisito para solicitar.
  const shortageIds = useMemo(
    () =>
      (params.get("faltantes") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => /^\d+$/.test(value)),
    [params],
  );
  const prefilled = useRef(false);

  useEffect(() => {
    if (prefilled.current || shortageIds.length === 0) return;
    if (storeId === "" || distributorId === "" || products.data === null) return;
    const requestable = new Set(products.data.map((product) => String(product.id)));
    const wanted = shortageIds.filter((id) => requestable.has(id));
    if (wanted.length === 0) return;
    prefilled.current = true;
    setLines(wanted.map((id) => ({ productId: id, quantity: "1" })));
  }, [distributorId, products.data, shortageIds, storeId]);

  // Un distribuidor que no está vinculado (p. ej. link viejo) no puede quedar
  // seleccionado: se limpia la selección y las líneas.
  useEffect(() => {
    if (admin || distributors.data === null || distributorId === "") return;
    if (distributors.data.some((d) => String(d.id) === distributorId)) return;
    setDistributorId("");
    setLines([{ productId: "", quantity: "" }]);
  }, [admin, distributorId, distributors.data]);

  function changeStore(value: string) {
    setStoreId(value);
    setDistributorId("");
    setLines([{ productId: "", quantity: "" }]);
  }

  function changeDistributor(value: string) {
    setDistributorId(value);
    setLines([{ productId: "", quantity: "" }]);
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  // S9: agrega un faltante sin duplicar la línea ni pisar las cantidades ya
  // escritas. Descarta las líneas vacías (no se envían igual).
  function addShortage(productId: number): void {
    const id = String(productId);
    setLines((current) => {
      if (current.some((line) => line.productId === id)) return current;
      return [
        ...current.filter((line) => line.productId !== ""),
        { productId: id, quantity: "1" },
      ];
    });
  }

  function addAllShortages(): void {
    const ids = storeShortages
      .map((row) => row.product_id)
      .filter((id) => requestableIds.has(id));
    setLines((current) => {
      const existing = new Set(
        current.map((line) => line.productId).filter((value) => value !== ""),
      );
      const additions = ids
        .filter((id) => !existing.has(String(id)))
        .map((id) => ({ productId: String(id), quantity: "1" }));
      if (additions.length === 0) return current;
      return [...current.filter((line) => line.productId !== ""), ...additions];
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const items = lines
      .filter((l) => l.productId !== "")
      .map((l) => ({ product_id: Number(l.productId), quantity: Number(l.quantity) }));
    const ids = items.map((i) => i.product_id);
    if (storeId === "" || distributorId === "") return setError("Elegí tienda y distribuidor.");
    if (items.length === 0) return setError("Agregá al menos un producto.");
    if (items.some((i) => !(i.quantity > 0)))
      return setError("Las cantidades deben ser mayores que 0.");
    if (new Set(ids).size !== ids.length) return setError("Hay un producto repetido en la lista.");
    setSaving(true);
    try {
      const result = await createOrder({
        storeId: Number(storeId),
        distributorId: Number(distributorId),
        items,
        expectedAt: expectedAt === "" ? null : `${expectedAt}T12:00:00Z`,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      if (result.error) {
        setError(mapError(result.error));
        return;
      }
      navigate(result.data ? `/pedidos/${result.data}` : "/pedidos");
    } catch (thrown) {
      setError(mapError(thrown));
    } finally {
      setSaving(false);
    }
  }

  const pickerOptions = useMemo<ProductPickerOption[]>(
    () =>
      (products.data ?? []).map((product) => ({
        id: product.id,
        name: product.name,
        brand: product.brand,
        quantity: product.quantity,
        price: product.price,
      })),
    [products.data],
  );

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">Pedidos</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Nuevo pedido</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        {admin
          ? "Elegí la tienda, el distribuidor y los productos. Al confirmar, el pedido queda listo para su entrega."
          : "Elegí la tienda, el distribuidor vinculado y los productos. No hace falta precio: el distribuidor recibe la solicitud y la cotiza."}
      </p>
      <Status
        error={error ?? stores.error ?? distributors.error ?? products.error ?? shortages.error}
      />
      <form onSubmit={(e) => void onSubmit(e)}>
        <Box title="Origen y destino">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tienda">
              <select
                className={inputClass}
                value={storeId}
                onChange={(e) => changeStore(e.target.value)}
              >
                <option value="">— elegir —</option>
                {stores.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Distribuidor">
              <select
                className={inputClass}
                value={distributorId}
                onChange={(e) => changeDistributor(e.target.value)}
              >
                <option value="">— elegir —</option>
                {distributors.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {!admin && storeId !== "" && distributors.data?.length === 0 && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Esta tienda no tiene distribuidores vinculados. Vinculá uno desde “Distribuidores”.
            </p>
          )}
        </Box>

        <Box title="Productos">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-700">
              {admin
                ? "Productos (solo los asignados a la tienda)"
                : "Productos (en la tienda y en el catálogo del distribuidor)"}
            </p>
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-500">
              {lines.length} {lines.length === 1 ? "línea" : "líneas"}
            </span>
          </div>
          {shortageIds.length > 0 && (
            <p className="mt-2 text-sm text-gray-600">
              Vienen preseleccionados los faltantes de la tienda: ajustá las cantidades.
            </p>
          )}
          <div className="mt-3 space-y-2">
            {lines.map((line, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-xl border border-gray-100 bg-gray-50/50 p-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end"
              >
                <ProductPicker
                  key={`${storeId}:${distributorId}:${index}`}
                  compact
                  label={`Producto ${index + 1}`}
                  searchLabel={`Buscar producto ${index + 1}`}
                  quantityLabel={`Cantidad mínima de producto ${index + 1}`}
                  value={line.productId}
                  onChange={(value) => updateLine(index, { productId: value })}
                  options={pickerOptions}
                  loading={products.loading}
                  showQuantityFilter
                  emptyHint={
                    products.error === null
                      ? "No hay productos disponibles para esta tienda y distribuidor."
                      : undefined
                  }
                />
                <input
                  aria-label={`Cantidad ${index + 1}`}
                  className={inputClass}
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="Cantidad"
                  value={line.quantity}
                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                />
                <button
                  className={`${secondaryButtonClass} h-9 px-2.5 text-xs`}
                  type="button"
                  onClick={() => setLines(lines.filter((_, i) => i !== index))}
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>
          <button
            className={`${secondaryButtonClass} mt-3`}
            type="button"
            onClick={() => setLines([...lines, { productId: "", quantity: "" }])}
          >
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
            Agregar producto
          </button>

          {storeId !== "" && storeShortages.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Faltantes de la tienda</h3>
                  <p className="text-xs text-gray-600">
                    {distributorId === ""
                      ? "Elegí un distribuidor para saber cuáles podés pedir."
                      : "Agregalos a la solicitud con un clic."}
                  </p>
                </div>
                <button
                  className={secondaryButtonClass}
                  type="button"
                  disabled={distributorId === ""}
                  onClick={addAllShortages}
                >
                  Agregar todos
                </button>
              </div>
              <ul className="mt-3 space-y-1.5">
                {storeShortages.map((row) => {
                  const requestable = requestableIds.has(row.product_id);
                  const added = lines.some((line) => line.productId === String(row.product_id));
                  return (
                    <li
                      key={row.product_id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-2 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="font-medium text-gray-900">{row.name}</span>
                        {row.brand !== null && (
                          <span className="text-gray-500"> · {row.brand}</span>
                        )}
                        <span className="ml-2 text-xs text-gray-500">
                          Stock: {formatQty(row.quantity)}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        {!requestable && (
                          <span className="text-xs text-gray-500">
                            No está en el catálogo del distribuidor
                          </span>
                        )}
                        <button
                          className={secondaryButtonClass}
                          type="button"
                          disabled={!requestable || added}
                          onClick={() => addShortage(row.product_id)}
                        >
                          {added ? "Agregado" : "Agregar"}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Box>

        <Box title="Entrega">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha prometida (opcional)">
              <input
                className={inputClass}
                type="date"
                value={expectedAt}
                onChange={(e) => setExpectedAt(e.target.value)}
              />
            </Field>
            <Field label="Notas (opcional)">
              <input
                className={inputClass}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>
          <button className={buttonClass} type="submit" disabled={saving}>
            Crear pedido
          </button>
        </Box>
      </form>
    </section>
  );
}
