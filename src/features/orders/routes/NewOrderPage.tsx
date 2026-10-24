import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { mapError } from "../../../shared/lib/errors/mapError";
import { Box, Field, Status, buttonClass, inputClass } from "../../../shared/ui/Box";
import {
  createOrder,
  fetchDistributorOptions,
  fetchStoreOptions,
  fetchStoreProducts,
} from "../api";

interface Line {
  productId: string;
  quantity: string;
}

/** /pedidos/nuevo — tienda → distribuidor → líneas → create_order. */
export function NewOrderPage() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const stores = useLoad(() => fetchStoreOptions(role === "admin"), [role]);
  const distributors = useLoad(() => fetchDistributorOptions(), []);
  const [storeId, setStoreId] = useState("");
  const products = useLoad(
    () => (storeId === "" ? Promise.resolve({ data: [], error: null }) : fetchStoreProducts(Number(storeId))),
    [storeId],
  );
  const [distributorId, setDistributorId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: "" }]);
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  return (
    <section>
      <h1 className="text-xl font-semibold">Nuevo pedido</h1>
      <Status error={error ?? stores.error ?? distributors.error ?? products.error} />
      <Box title="Datos del pedido">
        <form onSubmit={(e) => void onSubmit(e)}>
          <Field label="Tienda">
            <select className={inputClass} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
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
              onChange={(e) => setDistributorId(e.target.value)}
            >
              <option value="">— elegir —</option>
              {distributors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-sm font-medium">Productos (solo los asignados a la tienda)</p>
          {lines.map((line, index) => (
            <div key={index} className="mb-2 flex gap-2">
              <select
                aria-label={`Producto ${index + 1}`}
                className={inputClass}
                value={line.productId}
                onChange={(e) => updateLine(index, { productId: e.target.value })}
              >
                <option value="">— producto —</option>
                {products.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
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
