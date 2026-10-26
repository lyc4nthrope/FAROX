import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { mapError } from "../../../shared/lib/errors/mapError";
import { formatCOP } from "../../../shared/lib/format";
import { Box, Field, Status, buttonClass, inputClass } from "../../../shared/ui/Box";
import { fetchStoreDistributorProducts, fetchLinkedDistributorOptions } from "../../store-links/api";
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

type ProductOption = Option & { price?: number | null };

function productLabel(product: ProductOption): string {
  if (product.price === null) return `${product.name} (sin precio)`;
  if (product.price === undefined) return product.name;
  return `${product.name} — ${formatCOP(product.price)}`;
}

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
  const products = useLoad<ProductOption[]>(
    () => {
      if (storeId === "") return Promise.resolve({ data: [], error: null });
      if (admin) return fetchStoreProducts(Number(storeId));
      if (distributorId === "") return Promise.resolve({ data: [], error: null });
      return fetchStoreDistributorProducts(Number(storeId), Number(distributorId));
    },
    [admin, storeId, distributorId],
  );
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: "" }]);
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // S3: /faltantes envía los productos ya elegidos. Se precargan UNA vez, solo
  // los que existen en la intersección y tienen precio; si el operador cambia
  // de distribuidor, las líneas se reinician y no se vuelven a pisar.
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
    const requestable = new Set(
      products.data.filter((product) => product.price !== null).map((product) => String(product.id)),
    );
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

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const items = lines
      .filter((l) => l.productId !== "")
      .map((l) => ({ product_id: Number(l.productId), quantity: Number(l.quantity) }));
    const ids = items.map((i) => i.product_id);
    if (storeId === "" || distributorId === "") return setError("Elegí tienda y distribuidor.");
    if (items.length === 0) return setError("Agregá al menos un producto.");
    if (items.some((i) => !(i.quantity > 0))) return setError("Las cantidades deben ser mayores que 0.");
    if (new Set(ids).size !== ids.length) return setError("Hay un producto repetido en la lista.");
    setSaving(true);
    try {
      const result = await createOrder({
        storeId: Number(storeId),
        distributorId: Number(distributorId),
        items,
        expectedAt: expectedAt === "" ? null : new Date(expectedAt).toISOString(),
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

  // create_order exige precio activo en la tienda (D40): sin este conteo el
  // selector solo muestra opciones deshabilitadas y no explica por qué.
  const unpricedCount = products.data?.filter((p) => p.price === null).length ?? 0;

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">Nuevo pedido</h1>
      <Status error={error ?? stores.error ?? distributors.error ?? products.error} />
      <Box title="Datos del pedido">
        <form onSubmit={(e) => void onSubmit(e)}>
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
          {!admin && storeId !== "" && distributors.data?.length === 0 && (
            <p className="text-sm">
              Esta tienda no tiene distribuidores vinculados. Vinculá uno desde “Distribuidores”.
            </p>
          )}
          <p className="text-sm font-medium">
            {admin
              ? "Productos (solo los asignados a la tienda)"
              : "Productos (en la tienda y en el catálogo del distribuidor)"}
          </p>
          {unpricedCount > 0 && (
            <p className="text-sm">
              {unpricedCount === 1
                ? "1 producto no tiene precio en esta tienda y no se puede pedir."
                : `${unpricedCount} productos no tienen precio en esta tienda y no se pueden pedir.`}{" "}
              <Link className="underline" to={`/inventario/${storeId}`}>
                Publicá su precio en Inventario
              </Link>
            </p>
          )}
          {shortageIds.length > 0 && (
            <p className="text-sm text-gray-600">
              Vienen preseleccionados los faltantes de la tienda: ajustá las cantidades.
            </p>
          )}
          {lines.map((line, index) => (
            <div key={index} className="mb-2 flex flex-wrap items-end gap-2">
              <select
                aria-label={`Producto ${index + 1}`}
                className={inputClass}
                value={line.productId}
                onChange={(e) => updateLine(index, { productId: e.target.value })}
              >
                <option value="">— producto —</option>
                {products.data?.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.price === null}>
                    {productLabel(p)}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Cantidad ${index + 1}`}
                className={inputClass}
                type="number"
                min="0"
                step="0.001"
                value={line.quantity}
                onChange={(e) => updateLine(index, { quantity: e.target.value })}
              />
              <button
                className={buttonClass}
                type="button"
                onClick={() => setLines(lines.filter((_, i) => i !== index))}
              >
                Quitar
              </button>
            </div>
          ))}
          <button
            className={buttonClass}
            type="button"
            onClick={() => setLines([...lines, { productId: "", quantity: "" }])}
          >
            + Agregar producto
          </button>
          <Field label="Fecha prometida (opcional)">
            <input
              className={inputClass}
              type="date"
              value={expectedAt}
              onChange={(e) => setExpectedAt(e.target.value)}
            />
          </Field>
          <Field label="Notas (opcional)">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <button className={buttonClass} type="submit" disabled={saving}>
            Crear pedido
          </button>
        </form>
      </Box>
    </section>
  );
}
