import { useMemo, useState } from "react";

import { useLoad } from "../../../shared/hooks/useLoad";
import { Field, Status, buttonClass, inputClass } from "../../../shared/ui/Box";
import { Modal } from "../../../shared/ui/Modal";
import { fetchCatalogContext, fetchProductCategories } from "../api";
import { AddProductsPanel } from "../components/AddProductsPanel";
import { CatalogBox } from "../components/CatalogBox";
import { type CatalogRef, type CatalogTarget, targetKey } from "../types";

// /products para quien NO es admin (S2-S9). La visibilidad sale de las
// entidades reales del usuario —sus tiendas (my_store_ids) y su distribuidora
// (my_distributor_id)—, NO del nombre del rol:
// · "Mi catálogo" lista SOLO los productos relacionados a esa tienda/distribuidora.
// · "Agregar producto" (header) abre el registro global para sumar, con alta
//   rápida incluida.
// Si el usuario tuviera tienda y distribuidora a la vez, el selector permite
// cambiar de catálogo sin ambigüedad.
export function MyCatalogPage() {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Sube tras cada alta para que el catálogo se vuelva a pedir (cero realtime).
  // NO remonta la caja: la búsqueda y los filtros del operador se conservan.
  const [version, setVersion] = useState(0);

  const context = useLoad(fetchCatalogContext, []);
  // Una sola request de categorías, compartida por los dos filtros. La api
  // devuelve { rows, error }; useLoad espera { data, error }.
  const categories = useLoad<CatalogRef[]>(async () => {
    const result = await fetchProductCategories();
    return { data: result.rows, error: result.error };
  }, []);

  const targets = useMemo<CatalogTarget[]>(() => {
    const data = context.data;
    if (data === null) return [];
    const list: CatalogTarget[] = data.stores.map((store) => ({
      kind: "store",
      id: store.id,
      name: store.name,
    }));
    if (data.distributorId !== null) {
      list.push({ kind: "distribuidor", id: data.distributorId, name: "Mi distribuidora" });
    }
    return list;
  }, [context.data]);

  const target =
    targets.find((candidate) => targetKey(candidate) === selectedKey) ?? targets[0] ?? null;

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Productos</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Elegí del registro general los productos que manejás. Tu catálogo muestra solo los
            productos relacionados a tu tienda o distribuidora.
          </p>
        </div>
        {target !== null && (
          <button
            className={buttonClass}
            type="button"
            onClick={() => setAdding(true)}
          >
            Agregar producto
          </button>
        )}
      </div>

      <Status loading={context.loading} error={context.error} />
      {context.error === null && !context.loading && targets.length === 0 && (
        <p className="mt-4 text-sm text-gray-600">
          No tenés una tienda ni una distribuidora asociada.
        </p>
      )}

      {targets.length > 1 && (
        <div className="mt-4 max-w-md">
          <Field label="Catálogo">
            <select
              className={inputClass}
              value={target === null ? "" : targetKey(target)}
              onChange={(event) => setSelectedKey(event.target.value)}
            >
              {targets.map((candidate) => (
                <option key={targetKey(candidate)} value={targetKey(candidate)}>
                  {candidate.kind === "store" ? `Tienda: ${candidate.name}` : candidate.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {target !== null && (
        <>
          <div className="mt-4">
            <CatalogBox
              target={target}
              categories={categories.data ?? []}
              reloadToken={version}
            />
          </div>
          {adding && (
            <Modal title="Agregar productos a mi catálogo" onClose={() => setAdding(false)}>
              <AddProductsPanel
                target={target}
                categories={categories.data ?? []}
                onAdded={() => setVersion((value) => value + 1)}
              />
            </Modal>
          )}
        </>
      )}
    </section>
  );
}
