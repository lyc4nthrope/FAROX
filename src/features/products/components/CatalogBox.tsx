import { useEffect, useState } from "react";

import { useList } from "../../../shared/hooks/useList";
import { PAGE_SIZE } from "../../../shared/lib/list";
import { formatQty } from "../../../shared/lib/format";
import {
  Box,
  Status,
  buttonClass,
  inputClass,
  runAction,
} from "../../../shared/ui/Box";
import { Pager } from "../../../shared/ui/Pager";
import {
  fetchDistributorCatalog,
  fetchStoreCatalog,
  removeDistributorCatalogProduct,
  removeStoreProduct,
  setStoreProductQuantity,
  setStoreProductShortage,
} from "../api";
import type { CatalogEntry, CatalogQuery, CatalogRef, CatalogTarget } from "../types";
import { ProductList } from "./ProductList";
import { QuantityEditor } from "./QuantityEditor";

interface Msg {
  error: string | null;
  ok: string | null;
}

const NO_MSG: Msg = { error: null, ok: null };

const INITIAL_QUERY: CatalogQuery = {
  page: 0,
  pageSize: PAGE_SIZE,
  q: "",
  categoryId: null,
  onlyShortage: false,
};

/**
 * Catálogo de UNA entidad, paginado y filtrado en el servidor (S3/S8).
 * Incluye los productos inactivos que ya estaban asignados: si no aparecieran,
 * quedarían sin forma de quitarlos.
 *
 * `reloadToken` lo sube la pantalla cuando el panel de alta agrega un producto:
 * refetchea SIN remontar, así no se pierden búsqueda/filtros/página.
 */
export function CatalogBox({
  target,
  categories,
  reloadToken,
}: {
  target: CatalogTarget;
  categories: CatalogRef[];
  reloadToken: number;
}) {
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<{ id: number; action: "qty" | "remove" | "shortage" } | null>(
    null,
  );
  const [msg, setMsg] = useState<Msg>(NO_MSG);

  const list = useList<CatalogEntry, CatalogQuery>(
    (query) =>
      target.kind === "store"
        ? fetchStoreCatalog(target.id, query)
        : fetchDistributorCatalog(query),
    INITIAL_QUERY,
  );

  // Búsqueda con debounce: una request por tecla satura la red sin aportar.
  // Se compara con el query vigente para no re-disparar al montar.
  const activeSearch = list.query.q;
  const setQuery = list.setQuery;
  useEffect(() => {
    if (search === activeSearch) return;
    const timer = setTimeout(() => setQuery({ q: search }), 300);
    return () => clearTimeout(timer);
  }, [search, activeSearch, setQuery]);

  const refetch = list.refetch;
  useEffect(() => {
    if (reloadToken > 0) refetch();
  }, [reloadToken, refetch]);

  async function guardarCantidad(entry: CatalogEntry, quantity: number): Promise<void> {
    setBusy({ id: entry.id, action: "qty" });
    const error = await runAction(() => setStoreProductQuantity(target.id, entry.id, quantity));
    setMsg({
      error,
      ok: error === null ? `Cantidad de "${entry.name}" actualizada.` : null,
    });
    if (error === null) list.refetch();
    setBusy(null);
  }

  async function alternarFaltante(entry: CatalogEntry): Promise<void> {
    const shortage = !entry.is_shortage;
    setBusy({ id: entry.id, action: "shortage" });
    const error = await runAction(() => setStoreProductShortage(target.id, entry.id, shortage));
    setMsg({
      error,
      ok:
        error === null
          ? shortage
            ? `"${entry.name}" marcado como faltante.`
            : `"${entry.name}" ya no está marcado como faltante.`
          : null,
    });
    if (error === null) list.refetch();
    setBusy(null);
  }

  async function quitar(entry: CatalogEntry): Promise<void> {
    if (target.kind === "distribuidor") {
      setBusy({ id: entry.id, action: "remove" });
      const error = await runAction(() => removeDistributorCatalogProduct(entry.id));
      setMsg({ error, ok: error === null ? "Producto quitado del catálogo." : null });
      if (error === null) list.refetch();
      setBusy(null);
      return;
    }

    // S5 — con existencias, doble confirmación explícita: la baja descarta
    // stock real y la DB exige p_confirm_stock para permitirlo.
    const stock = entry.quantity ?? 0;
    if (stock > 0) {
      const first = window.confirm(
        `"${entry.name}" tiene ${formatQty(stock)} en stock. ¿Quitarlo del catálogo?`,
      );
      if (!first) return;
      const second = window.confirm(
        `Se van a descartar ${formatQty(stock)} de "${entry.name}". Esta acción no se puede deshacer. ¿Confirmás?`,
      );
      if (!second) return;
    } else {
      const confirmed = window.confirm(`¿Quitar "${entry.name}" del catálogo?`);
      if (!confirmed) return;
    }

    setBusy({ id: entry.id, action: "remove" });
    const error = await runAction(() => removeStoreProduct(target.id, entry.id, stock > 0));
    setMsg({ error, ok: error === null ? "Producto quitado del catálogo." : null });
    if (error === null) list.refetch();
    setBusy(null);
  }

  const filtersDisabled = target.kind === "distribuidor";

  return (
    <Box
      title={target.kind === "store" ? `Catálogo de ${target.name}` : "Catálogo de mi distribuidora"}
    >
      <Status error={msg.error} ok={msg.ok} />

      {!filtersDisabled && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="catalog-search" className="block text-sm font-medium text-gray-700">
              Buscar en mi catálogo
            </label>
            <input
              id="catalog-search"
              className={`mt-1 w-full ${inputClass}`}
              type="search"
              placeholder="Nombre del producto…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="catalog-category" className="block text-sm font-medium text-gray-700">
              Categoría
            </label>
            <select
              id="catalog-category"
              className={`mt-1 w-full ${inputClass}`}
              value={list.query.categoryId === null ? "" : String(list.query.categoryId)}
              onChange={(event) =>
                list.setQuery({
                  categoryId: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            >
              <option value="">Todas</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={list.query.onlyShortage}
              onChange={(event) => list.setQuery({ onlyShortage: event.target.checked })}
            />
            Solo faltantes
          </label>
        </div>
      )}

      <ProductList
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        quantity={target.kind === "store"}
        emptyTitle={
          list.query.q !== "" || list.query.categoryId !== null || list.query.onlyShortage
            ? "Ningún producto coincide con el filtro"
            : "Tu catálogo está vacío"
        }
        emptyHint={
          list.query.q !== "" || list.query.categoryId !== null || list.query.onlyShortage
            ? "Probá con otro nombre, otra categoría o quitá el filtro de faltantes."
            : "Usá «Agregar producto» para sumar productos del registro."
        }
        renderQuantity={(row) => (
          <QuantityEditor
            productName={row.name}
            value={row.quantity ?? 0}
            saving={busy?.id === row.id && busy.action === "qty"}
            disabled={row.quantity === null || row.quantity === undefined}
            onSave={(quantity) => void guardarCantidad(row as CatalogEntry, quantity)}
          />
        )}
        renderAction={(row) => {
          if (target.kind === "store") {
            return (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className={buttonClass}
                  type="button"
                  disabled={busy?.id === row.id}
                  onClick={() => void alternarFaltante(row as CatalogEntry)}
                >
                  {row.is_shortage === true ? "Quitar faltante" : "Marcar faltante"}
                </button>
                <button
                  className={buttonClass}
                  type="button"
                  disabled={busy?.id === row.id}
                  onClick={() => void quitar(row as CatalogEntry)}
                >
                  Quitar
                </button>
              </div>
            );
          }
          return (
            <button
              className={buttonClass}
              type="button"
              disabled={busy?.id === row.id}
              onClick={() => void quitar(row as CatalogEntry)}
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
