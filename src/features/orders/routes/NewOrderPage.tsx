import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { formatCOP, formatQty } from "../../../shared/lib/format";import { mapError } from "../../../shared/lib/errors/mapError";
import {
  Box,
  Field,
  Status,
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from "../../../shared/ui/Box";
import { fetchShortageProducts } from "../../products/api";
import type { ShortageRow } from "../../products/types";
import { QuantityStepper } from "../../../shared/ui";
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

const MAX_RESULTS = 12;

function idParam(value: string | null): string {
  return value !== null && /^\d+$/.test(value) && Number(value) > 0 ? value : "";
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** /pedidos/nuevo — tienda → distribuidor → buscador de productos → create_order. */
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
  const productById = useMemo(
    () => new Map((products.data ?? []).map((product) => [product.id, product])),
    [products.data],
  );
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  const [showFilters, setShowFilters] = useState(false);
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
    setLines([]);
  }, [admin, distributorId, distributors.data]);

  // Un solo buscador: el término y el filtro de stock viven en la pantalla,
  // no en cada línea. Los resultados se filtran en cliente (el catálogo de la
  // tienda ya viene acotado por la API).
  const allMatches = useMemo(() => {
    const term = normalizeText(search.trim());
    if (term === "") return [];
    const min = minQuantity.trim() === "" ? null : Number(minQuantity);
    return (products.data ?? []).filter((product) => {
      const matchesText =
        normalizeText(product.name).includes(term) ||
        normalizeText(product.brand ?? "").includes(term);
      const matchesQuantity =
        min === null ||
        (!Number.isNaN(min) &&
          product.quantity !== null &&
          product.quantity >= min);
      return matchesText && matchesQuantity;
    });
  }, [products.data, search, minQuantity]);
  const searchResults = allMatches.slice(0, MAX_RESULTS);
  const addedIds = useMemo(() => new Set(lines.map((line) => line.productId)), [lines]);

  function changeStore(value: string) {
    setStoreId(value);
    setDistributorId("");
    setLines([]);
  }

  function changeDistributor(value: string) {
    setDistributorId(value);
    setLines([]);
  }

  function updateQuantity(index: number, quantity: string): void {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, quantity } : line)),
    );
  }

  function removeLine(index: number): void {
    setLines((current) => current.filter((_, i) => i !== index));
  }

  // Un solo camino de alta: buscador, faltantes y /faltantes agregan acá.
  function addProduct(productId: number): void {
    const id = String(productId);
    setLines((current) =>
      current.some((line) => line.productId === id)
        ? current
        : [...current, { productId: id, quantity: "1" }],
    );
    setSearch("");
  }

  function addAllShortages(): void {
    const ids = storeShortages
      .map((row) => row.product_id)
      .filter((id) => requestableIds.has(id));
    setLines((current) => {
      const existing = new Set(current.map((line) => line.productId));
      const additions = ids
        .filter((id) => !existing.has(String(id)))
        .map((id) => ({ productId: String(id), quantity: "1" }));
      if (additions.length === 0) return current;
      return [...current, ...additions];
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const items = lines.map((line) => ({
      product_id: Number(line.productId),
      quantity: Number(line.quantity),
    }));
    const ids = items.map((item) => item.product_id);
    if (storeId === "" || distributorId === "") return setError("Elegí tienda y distribuidor.");
    if (items.length === 0) return setError("Agregá al menos un producto.");
    if (items.some((item) => !(item.quantity > 0)))
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

  function productMeta(product: ProductOption | undefined): string {
    if (product === undefined) return "Producto del catálogo";
    const parts: string[] = [];
    if (product.brand !== null && product.brand !== "") parts.push(product.brand);
    parts.push(
      product.quantity === null
        ? "Stock: —"
        : `Stock: ${formatQty(product.quantity)}`,
    );
    if (product.price === null) parts.push("sin precio");
    else if (product.price !== undefined) parts.push(formatCOP(product.price));
    return parts.join(" · ");
  }

  const emptySearchMessage =
    products.loading
      ? "Cargando productos…"
      : storeId === ""
        ? "Elegí una tienda para buscar productos."
        : distributors.data !== null && !admin && distributorId === ""
          ? "Elegí un distribuidor para buscar productos."
          : minQuantity.trim() !== ""
            ? "Ningún producto coincide con la búsqueda y el stock mínimo."
            : "Ningún producto coincide con la búsqueda.";

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
              {lines.length} {lines.length === 1 ? "producto" : "productos"}
            </span>
          </div>
          {shortageIds.length > 0 && (
            <p className="mt-2 text-sm text-gray-600">
              Vienen preseleccionados los faltantes de la tienda: ajustá las cantidades.
            </p>
          )}

          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs font-semibold tracking-wide text-gray-600">
                Buscar producto
              </span>
              <input
                className={inputClass}
                type="search"
                placeholder="Nombre o marca…"
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button
              className={secondaryButtonClass}
              type="button"
              aria-expanded={showFilters}
              onClick={() => setShowFilters((open) => !open)}
            >
              Filtros
              {minQuantity.trim() !== "" ? ` · stock ≥ ${minQuantity}` : ""}
            </button>
          </div>

          {showFilters && (
            <div className="mt-2 flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs font-semibold tracking-wide text-gray-600">
                  Stock mínimo
                </span>
                <input
                  className={`${inputClass} max-w-32`}
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="0"
                  value={minQuantity}
                  onChange={(event) => setMinQuantity(event.target.value)}
                />
              </label>
              <button
                className={secondaryButtonClass}
                type="button"
                onClick={() => setMinQuantity("")}
              >
                Limpiar filtro
              </button>
            </div>
          )}

          {search.trim() !== "" && (
            <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-gray-100">
              {searchResults.length > 0 && (
                <ul className="divide-y divide-gray-100">
                  {searchResults.map((product) => {
                    const added = addedIds.has(String(product.id));
                    return (
                      <li
                        key={product.id}
                        onClick={() => {
                          if (!added) addProduct(product.id);
                        }}
                        className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${
                          added ? "" : "cursor-pointer transition-colors hover:bg-gray-50"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {product.name}
                          </p>
                          <p className="truncate text-xs text-gray-500">{productMeta(product)}</p>
                        </div>
                        <button
                          className={`${secondaryButtonClass} whitespace-normal px-2.5 py-1.5 text-center text-xs leading-tight`}
                          type="button"
                          aria-label={`Agregar ${product.name}`}
                          disabled={added}
                          onClick={(event) => {
                            event.stopPropagation();
                            addProduct(product.id);
                          }}
                        >
                          {added ? "Agregado" : "Agregar"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {searchResults.length === 0 && (
                <p className="px-3 py-3 text-sm text-gray-500">{emptySearchMessage}</p>
              )}
              {allMatches.length > searchResults.length && (
                <p className="px-3 py-2 text-xs text-gray-500">
                  Mostrando {searchResults.length} de {allMatches.length}. Afiná la búsqueda.
                </p>
              )}
            </div>
          )}

          <div className="mt-5">
            <h3 className="text-sm font-semibold text-gray-900">Productos solicitados</h3>
            {lines.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500">
                Buscá un producto arriba o agregá un faltante para empezar la solicitud.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {lines.map((line, index) => {
                  const product = productById.get(Number(line.productId));
                  const name = product?.name ?? `Producto #${line.productId}`;
                  return (
                    <li
                      key={line.productId}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white p-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{name}</p>
                        <p className="truncate text-xs text-gray-500">{productMeta(product)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <QuantityStepper
                          label={name}
                          value={line.quantity}
                          onChange={(value) => updateQuantity(index, value)}
                        />
                        <button
                          className={`${secondaryButtonClass} px-2.5 py-1.5 text-xs`}
                          type="button"
                          aria-label={`Quitar ${name}`}
                          onClick={() => removeLine(index)}
                        >
                          Quitar
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

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
                  className={`${secondaryButtonClass} whitespace-normal text-center leading-tight`}
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
                  const added = addedIds.has(String(row.product_id));
                  return (
                    <li
                      key={row.product_id}
                      onClick={() => {
                        if (requestable && !added) addProduct(row.product_id);
                      }}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-2 text-sm ${
                        requestable && !added
                          ? "cursor-pointer transition-colors hover:bg-amber-50/60"
                          : ""
                      }`}
                    >
                      <ShortageLabel row={row} />
                      <span className="flex flex-wrap items-center gap-2">
                        {!requestable && (
                          <span className="whitespace-normal text-xs text-gray-500">
                            No está en el catálogo del distribuidor
                          </span>
                        )}
                        <button
                          className={`${secondaryButtonClass} whitespace-normal px-2.5 py-1.5 text-center text-xs leading-tight`}
                          type="button"
                          aria-label={`Agregar faltante ${row.name}`}
                          disabled={!requestable || added}
                          onClick={(event) => {
                            event.stopPropagation();
                            addProduct(row.product_id);
                          }}
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

function ShortageLabel({ row }: { row: ShortageRow }) {
  return (
    <span className="min-w-0">
      <span className="font-medium text-gray-900">{row.name}</span>
      {row.brand !== null && <span className="text-gray-500"> · {row.brand}</span>}
      <span className="ml-2 text-xs text-gray-500">Stock: {formatQty(row.quantity)}</span>
    </span>
  );
}
