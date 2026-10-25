import { useMemo, useState } from "react";

import { useList } from "../../../shared/hooks/useList";
import { useLoad } from "../../../shared/hooks/useLoad";
import { formatQty } from "../../../shared/lib/format";
import { Box, Field, Status, buttonClass, inputClass, runAction } from "../../../shared/ui/Box";
import { Pager } from "../../../shared/ui/Pager";
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

interface CatalogTarget {
  kind: "store" | "distribuidor";
  id: number;
  name: string;
}

function targetKey(target: CatalogTarget): string {
  return `${target.kind}:${target.id}`;
}

interface Msg {
  error: string | null;
  ok: string | null;
}

const NO_MSG: Msg = { error: null, ok: null };

// Catálogo de UNA entidad, paginado. Incluye los productos inactivos que ya
// estaban asignados: si no aparecieran, quedarían sin forma de quitarlos
// (la baja de tienda exige quantity = 0, no is_active).
function CatalogBox({ target }: { target: CatalogTarget }) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(NO_MSG);

  const list = useList<CatalogEntry>((query) =>
    target.kind === "store" ? fetchStoreCatalog(target.id, query) : fetchDistributorCatalog(query),
  );

  async function quitar(entry: ProductListRow): Promise<void> {
    setBusyId(entry.id);
    const error = await runAction(() =>
      target.kind === "store"
        ? removeStoreCatalogProduct(target.id, entry.id)
        : removeDistributorCatalogProduct(entry.id),
    );
    setMsg({ error, ok: error === null ? "Producto quitado del catálogo." : null });
    if (error === null) list.refetch();
    setBusyId(null);
  }

  return (
    <Box
      title={
        target.kind === "store" ? `Catálogo de ${target.name}` : "Catálogo de mi distribuidora"
      }
    >
      <Status error={msg.error} ok={msg.ok} />
      <ProductList
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        quantity={target.kind === "store"}
        emptyTitle="Tu catálogo está vacío"
        emptyHint="Agregá productos desde el registro general."
        renderAction={(row) => {
          const qty = row.quantity ?? null;
          // Quitar de una tienda solo es posible sin existencias
          // (unassign_product_from_store exige quantity = 0).
          if (target.kind === "store" && qty !== null && qty > 0) {
            return <span className="text-xs text-amber-700">Con stock ({formatQty(qty)})</span>;
          }
          return (
            <button
              className={buttonClass}
              type="button"
              disabled={busyId === row.id}
              onClick={() => void quitar(row)}
            >
              Quitar
            </button>
          );
        }}
      />
      <Pager list={list} />
    </Box>
  );
}

// Registro global (solo activos) para sumar a la entidad. Paginado: el
// catálogo global no cabe en una página y truncarlo escondería productos que
// la spec exige poder agregar.
function AddProductsPanel({
  target,
  onAdded,
}: {
  target: CatalogTarget;
  onAdded: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(NO_MSG);

  const list = useList<ProductListRow>(fetchActiveProductsForCatalog);

  // Filtro sobre la página cargada: con paginación no hay forma de buscar en
  // TODO el registro sin otra request, así que el campo lo dice explícito.
  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (query === "") return list.rows;
    return list.rows.filter((row) => row.name.toLowerCase().includes(query));
  }, [list.rows, filter]);

  async function agregar(product: ProductListRow): Promise<void> {
    setBusyId(product.id);
    const error = await runAction(() =>
      target.kind === "store"
        ? addStoreCatalogProduct(target.id, product.id)
        : addDistributorCatalogProduct(product.id),
    );
    setMsg({ error, ok: error === null ? "Producto agregado al catálogo." : null });
    if (error === null) onAdded();
    setBusyId(null);
  }

  return (
    <Box title="Agregar productos a mi catálogo">
      <Status error={msg.error} ok={msg.ok} />
      <div className="max-w-md">
        <Field label="Buscar en esta página">
          <input
            className={inputClass}
            type="search"
            placeholder="Nombre del producto…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </Field>
      </div>
      <ProductList
        rows={visible}
        loading={list.loading}
        error={list.error}
        emptyTitle="No hay productos que coincidan con la búsqueda"
        emptyHint="Probá con otro nombre o pasá a la página siguiente."
        renderAction={(row) => (
          <button
            className={buttonClass}
            type="button"
            disabled={busyId === row.id}
            onClick={() => void agregar(row)}
          >
            Agregar
          </button>
        )}
      />
      <Pager list={list} />
    </Box>
  );
}

// /products para quien NO es admin (S2-S6). La visibilidad sale de las
// entidades reales del usuario —sus tiendas (my_store_ids) y su distribuidora
// (my_distributor_id)—, NO del nombre del rol:
// · "Mi catálogo" lista SOLO los productos relacionados a esa tienda/distribuidora.
// · "Agregar productos" lista el registro global y permite sumar.
// Si el usuario tuviera tienda y distribuidora a la vez, el selector permite
// cambiar de catálogo sin ambigüedad.
export function MyCatalogPage() {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Sube tras cada alta para que el catálogo se vuelva a pedir (cero realtime).
  const [version, setVersion] = useState(0);

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
          <CatalogBox key={`${targetKey(target)}:${version}`} target={target} />
          <AddProductsPanel target={target} onAdded={() => setVersion((v) => v + 1)} />
        </>
      )}
    </section>
  );
}
