import { useMemo } from "react";

import { useLoad } from "../../../shared/hooks/useLoad";
import { formatQty } from "../../../shared/lib/format";
import { EmptyState, ErrorBanner } from "../../../shared/ui";
import { Badge } from "../../../shared/ui/Box";
import { fetchShortageProducts } from "../api";
import type { ShortageRow } from "../types";

interface StoreGroup {
  storeId: number;
  storeName: string;
  rows: ShortageRow[];
}

function groupByStore(rows: ShortageRow[]): StoreGroup[] {
  const groups = new Map<number, StoreGroup>();
  for (const row of rows) {
    const current = groups.get(row.store_id);
    if (current === undefined) {
      groups.set(row.store_id, { storeId: row.store_id, storeName: row.store_name, rows: [row] });
    } else {
      current.rows.push(row);
    }
  }
  return [...groups.values()].sort((a, b) => a.storeName.localeCompare(b.storeName));
}

// /faltantes (§S7): lo que las tiendas marcaron como faltante, agrupado por
// tienda para armar el pedido. La RPC list_shortage_products() (0022) resuelve
// el alcance: el distribuidor ve SOLO las tiendas vinculadas (su RLS de stock
// no le deja leerlas directo), el operador las suyas y el admin todas. El
// cliente no filtra nada por su cuenta.
export function ShortagePage() {
  const { data, error, loading } = useLoad(fetchShortageProducts, []);
  const groups = useMemo(() => groupByStore(data ?? []), [data]);

  return (
    <section>
      <h1 className="text-xl font-semibold">Faltantes</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">
        Productos que las tiendas marcaron como faltantes. Agrupados por tienda para preparar el
        pedido.
      </p>

      <div className="mt-4 space-y-4">
        {loading && <p role="status" className="text-sm text-gray-500">Cargando…</p>}
        {error !== null && <ErrorBanner message={error} />}
        {!loading && error === null && groups.length === 0 && (
          <EmptyState
            title="No hay faltantes marcados"
            hint="Cuando una tienda marque un producto como faltante, va a aparecer acá."
          />
        )}

        {groups.map((group) => (
          <section
            key={group.storeId}
            className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
          >
            <h2 className="mb-3 border-b border-gray-100 pb-2 text-base font-semibold text-gray-900">
              {group.storeName}
            </h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-gray-500">
                  <th className="pb-2">Producto</th>
                  <th className="pb-2">Marca</th>
                  <th className="pb-2">Categoría</th>
                  <th className="pb-2">Unidad</th>
                  <th className="pb-2">Stock</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={`${row.store_id}:${row.product_id}`} className="border-t border-gray-100">
                    <td className="py-2 text-gray-900">{row.name}</td>
                    <td className="py-2 text-gray-700">{row.brand ?? "—"}</td>
                    <td className="py-2 text-gray-700">{row.category ?? "—"}</td>
                    <td className="py-2 text-gray-700">{row.unit ?? "—"}</td>
                    <td className="py-2 text-gray-700">
                      <div className="flex items-center gap-2">
                        <span>
                          {formatQty(row.quantity)} / {formatQty(row.base_quantity)}
                        </span>
                        {row.quantity === 0 ? (
                          <Badge tone="red">Sin stock</Badge>
                        ) : (
                          <Badge tone="amber">Reponer</Badge>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </section>
  );
}
