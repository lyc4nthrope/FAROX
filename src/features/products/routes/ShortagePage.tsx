import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { formatQty } from "../../../shared/lib/format";
import { EmptyState, ErrorBanner } from "../../../shared/ui";
import { Badge, Box, Status, buttonClass, inputClass } from "../../../shared/ui/Box";
import { fetchLinkedDistributorOptions } from "../../store-links/api";
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

/**
 * Solicitud al distribuidor (S3): arma el pedido con los faltantes de ESTA
 * tienda ya preseleccionados en /pedidos/nuevo. Solo aplica al operador: el
 * admin no tiene tienda propia y usa el flujo general de pedidos.
 */
function ShortageRequest({ storeId, rows }: { storeId: number; rows: ShortageRow[] }) {
  const distributors = useLoad(() => fetchLinkedDistributorOptions(storeId), [storeId]);
  const [distributorId, setDistributorId] = useState("");

  useEffect(() => {
    if (distributorId !== "") return;
    const first = distributors.data?.[0];
    if (first !== undefined) setDistributorId(String(first.id));
  }, [distributorId, distributors.data]);

  if (distributors.loading) return <Status loading />;
  if (distributors.error !== null) return <Status error={distributors.error} />;
  if (distributors.data !== null && distributors.data.length === 0) {
    return (
      <p className="mt-3 text-sm text-gray-600">
        No tenés distribuidores vinculados a esta tienda.{" "}
        <Link className="underline" to="/distributors">
          Vinculá uno
        </Link>{" "}
        para pedirle los faltantes.
      </p>
    );
  }

  const href = `/pedidos/nuevo?storeId=${storeId}&distributorId=${distributorId}&faltantes=${rows
    .map((row) => row.product_id)
    .join(",")}`;

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <label className="text-sm">
        <span className="block font-medium text-gray-700">Pedirle a</span>
        <select
          className={inputClass}
          value={distributorId}
          onChange={(event) => setDistributorId(event.target.value)}
        >
          {distributors.data?.map((distributor) => (
            <option key={distributor.id} value={distributor.id}>
              {distributor.name}
            </option>
          ))}
        </select>
      </label>
      <Link className={buttonClass} to={href}>
        Solicitar faltantes
      </Link>
    </div>
  );
}

// /faltantes (0023): lo que las tiendas marcaron como faltante. Lo ve SOLO el
// operador de esa tienda (el admin, todas). El distribuidor no tiene vista de
// faltantes: se entera cuando el operador le crea el pedido. La RPC
// list_shortage_products() resuelve el alcance y el cliente no filtra nada.
export function ShortagePage() {
  const { role } = useAuth();
  const { data, error, loading } = useLoad(fetchShortageProducts, []);
  const groups = useMemo(() => groupByStore(data ?? []), [data]);

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Reposición
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Faltantes</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Productos que marcaste como faltantes para reponer. El distribuidor no ve esta lista: le
        llega cuando le hacés el pedido.
      </p>

      <div className="mt-4 space-y-4">
        {loading && (
          <p role="status" className="text-sm text-gray-500">
            Cargando…
          </p>
        )}
        {error !== null && <ErrorBanner message={error} />}
        {!loading && error === null && groups.length === 0 && (
          <EmptyState
            title="No hay faltantes marcados"
            hint="Cuando marques un producto como faltante, va a aparecer acá."
          />
        )}

        {groups.map((group) => (
          <Box key={group.storeId} title={group.storeName}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Marca</th>
                    <th>Categoría</th>
                    <th>Unidad</th>
                    <th>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={`${row.store_id}:${row.product_id}`}>
                      <td className="font-medium text-gray-900">{row.name}</td>
                      <td>{row.brand ?? "—"}</td>
                      <td>{row.category ?? "—"}</td>
                      <td>{row.unit ?? "—"}</td>
                      <td>
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
            </div>
            {role === "operador" && <ShortageRequest storeId={group.storeId} rows={group.rows} />}
          </Box>
        ))}
      </div>
    </section>
  );
}
