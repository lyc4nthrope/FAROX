import { useMemo, useState } from "react";

import { useLoad } from "../../../shared/hooks/useLoad";
import { formatQty } from "../../../shared/lib/format";
import { Box, Field, Status, buttonClass, inputClass, runAction } from "../../../shared/ui/Box";
import {
  addDistributorCatalogProduct,
  addStoreCatalogProduct,
  fetchActiveProductsForCatalog,
  fetchCatalogContext,
  fetchDistributorCatalog,
  fetchStoreCatalog,
  removeDistributorCatalogProduct,
  removeStoreCatalogProduct,
} from "../api";
import { ProductList } from "../components/ProductList";
import type { CatalogEntry, ProductListRow } from "../types";

const EMPTY_CATALOG: CatalogEntry[] = [];

interface CatalogTarget {
  kind: "store" | "distribuidor";
  id: number;
  name: string;
}

function targetKey(target: CatalogTarget): string {
  return `${target.kind}:${target.id}`;
}

// /products para quien NO es admin (S2-S6). La visibilidad sale de las
// entidades reales del usuario —sus tiendas (my_store_ids) y su distribuidora
// (my_distributor_id)—, NO del nombre del rol:
// · "Mi catálogo" lista SOLO los productos relacionados a esa tienda/distribuidora.
// · "Agregar productos" lista el registro global y permite sumar/quitar.
// Si el usuario tuviera tienda y distribuidora a la vez, el selector permite
// cambiar de catálogo sin ambigüedad.
export function MyCatalogPage() {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });

  const context = useLoad(fetchCatalogContext, []);

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

  const catalog = useLoad(
    () => {
      if (target === null) return Promise.resolve({ data: EMPTY_CATALOG, error: null });
      return target.kind === "store"
        ? fetchStoreCatalog(target.id)
        : fetchDistributorCatalog();
    },
    [target?.kind, target?.id],
  );

  const registry = useLoad(fetchActiveProductsForCatalog, []);

  const current = useMemo(
    () => new Map((catalog.data ?? []).map((entry) => [entry.id, entry])),
    [catalog.data],
  );

  const visibleProducts = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const rows = registry.data ?? [];
    return query === "" ? rows : rows.filter((row) => row.name.toLowerCase().includes(query));
  }, [registry.data, filter]);

  async function toggle(product: ProductListRow, inCatalog: boolean): Promise<void> {
    if (target === null) return;
    setBusyId(product.id);
    const error = await runAction(() => {
      if (target.kind === "store") {
        return inCatalog
          ? removeStoreCatalogProduct(target.id, product.id)
          : addStoreCatalogProduct(target.id, product.id);
      }
      return inCatalog
        ? removeDistributorCatalogProduct(product.id)
        : addDistributorCatalogProduct(product.id);
    });
    setMsg({
      error,
      ok:
        error === null
          ? inCatalog
            ? "Producto quitado del catálogo."
            : "Producto agregado al catálogo."
          : null,
    });
    if (error === null) catalog.reload();
    setBusyId(null);
  }

  const isStoreCatalog = target?.kind === "store";

  return (
    <section>
      <h1 className="text-xl font-semibold">Productos</h1>
      <p className="mt-1 text-sm text-gray-600">
        Elegí del registro general los productos que manejás. Tu catálogo muestra solo los
        productos relacionados a tu tienda o distribuidora.
      </p>

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
          <Box title={target.kind === "store" ? `Catálogo de ${target.name}` : "Catálogo de mi distribuidora"}>
            <ProductList
              rows={catalog.data ?? []}
              loading={catalog.loading}
              error={catalog.error}
              quantity={isStoreCatalog}
              emptyTitle="Tu catálogo está vacío"
              emptyHint="Agregá productos desde el registro general."
            />
          </Box>

          <Box title="Agregar productos a mi catálogo">
            <Status error={msg.error} ok={msg.ok} />
            <div className="max-w-md">
              <Field label="Buscar producto">
                <input
                  className={inputClass}
                  type="search"
                  placeholder="Nombre del producto…"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </Field>
            </div>
            <Status loading={registry.loading} error={registry.error} />
            {registry.error === null && !registry.loading && visibleProducts.length === 0 && (
              <p className="text-sm text-gray-600">No hay productos que coincidan con la búsqueda.</p>
            )}
            {registry.error === null && !registry.loading && visibleProducts.length > 0 && (
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-600">
                    <th className="py-2 font-medium">Nombre</th>
                    <th className="py-2 font-medium">Marca</th>
                    <th className="py-2 font-medium">Unidad</th>
                    <th className="py-2 font-medium">Categoría</th>
                    <th className="py-2 font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((product) => {
                    const entry = current.get(product.id);
                    const inCatalog = entry !== undefined;
                    const quantity = entry?.quantity ?? null;
                    // Quitar de una tienda solo es posible sin existencias
                    // (unassign_product_from_store exige quantity = 0).
                    const blocked = inCatalog && isStoreCatalog && quantity !== null && quantity > 0;
                    return (
                      <tr key={product.id} className="border-b border-gray-100">
                        <td className="py-2 text-gray-900">{product.name}</td>
                        <td className="py-2 text-gray-700">{product.brand?.name ?? "—"}</td>
                        <td className="py-2 text-gray-700">{product.unit?.name ?? "—"}</td>
                        <td className="py-2 text-gray-700">{product.category?.name ?? "—"}</td>
                        <td className="py-2">
                          {blocked ? (
                            <span className="text-xs text-amber-700">
                              Con stock ({formatQty(quantity ?? 0)})
                            </span>
                          ) : (
                            <button
                              className={buttonClass}
                              type="button"
                              disabled={busyId === product.id}
                              onClick={() => void toggle(product, inCatalog)}
                            >
                              {inCatalog ? "Quitar" : "Agregar"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Box>
        </>
      )}
    </section>
  );
}
