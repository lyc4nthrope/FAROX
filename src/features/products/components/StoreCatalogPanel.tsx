import { useEffect, useState } from "react";

import { useList } from "../../../shared/hooks/useList";
import { useLoad } from "../../../shared/hooks/useLoad";
import { formatQty } from "../../../shared/lib/format";
import { PAGE_SIZE } from "../../../shared/lib/list";
import { DataTable, QuantityStepper, type DataTableColumn } from "../../../shared/ui";
import { Badge, Status, buttonClass, inputClass, runAction, secondaryButtonClass } from "../../../shared/ui/Box";
import { Modal } from "../../../shared/ui/Modal";
import { Pager } from "../../../shared/ui/Pager";
import {
  fetchProductCategories,
  fetchStoreCatalog,
  removeStoreProduct,
  setStoreProductShortage,
  updateStoreProduct,
} from "../api";
import type { CatalogEntry, CatalogQuery, CatalogRef } from "../types";
import { AddProductsPanel } from "./AddProductsPanel";

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

type RowAction = "shortage" | "remove";

// 0026: acciones con tonos suaves, distintos entre sí y coherentes con el
// tema. Quitar es rojo; faltante ámbar (marcar) / esmeralda (resolver);
// editar es el único azul.
const ACTION_BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-normal rounded-lg border bg-white px-2.5 py-1 text-center text-xs font-medium leading-tight shadow-sm transition";
const ACTION_EDIT = `${ACTION_BASE} border-sky-200 text-sky-700 hover:bg-sky-50`;
const ACTION_SHORTAGE_ON = `${ACTION_BASE} border-amber-200 text-amber-800 hover:bg-amber-50`;
const ACTION_SHORTAGE_OFF = `${ACTION_BASE} border-emerald-200 text-emerald-700 hover:bg-emerald-50`;
const ACTION_REMOVE = `${ACTION_BASE} border-red-200 text-red-700 hover:bg-red-50`;

function StockBadge({ row }: { row: CatalogEntry }) {
  if (row.quantity === null || row.quantity === 0) return <Badge tone="red">Agotado</Badge>;
  if (row.threshold != null && row.quantity <= row.threshold) {
    return <Badge tone="amber">Bajo</Badge>;
  }
  return <Badge tone="green">OK</Badge>;
}

/**
 * Catálogo + asignación de UNA tienda (S2). Es la pestaña «Productos» del
 * inventario unificado: reemplaza la antigua vista /products del operador.
 *
 * 0026: la cantidad y el umbral se editan en un MODAL y se guardan con una
 * sola RPC (`update_store_product`). La tabla ya no tiene un «Guardar» por
 * celda ni dispara requests por cada cambio.
 */
export function StoreCatalogPanel({
  storeId,
  storeName,
  reloadToken = 0,
  onChanged,
}: {
  storeId: number;
  storeName: string;
  /** Sube desde la página tras un movimiento/precio para refrescar cantidades. */
  reloadToken?: number;
  onChanged?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CatalogEntry | null>(null);
  const [editDraft, setEditDraft] = useState({ quantity: "", threshold: "" });
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [busy, setBusy] = useState<{ id: number; action: RowAction } | null>(null);
  const [msg, setMsg] = useState<Msg>(NO_MSG);

  const list = useList<CatalogEntry, CatalogQuery>(
    (query) => fetchStoreCatalog(storeId, query),
    INITIAL_QUERY,
  );

  const categories = useLoad<CatalogRef[]>(async () => {
    const result = await fetchProductCategories();
    return { data: result.rows, error: result.error };
  }, []);

  // Búsqueda con debounce: una request por tecla satura la red sin aportar.
  const activeSearch = list.query.q;
  const setQuery = list.setQuery;
  useEffect(() => {
    if (search === activeSearch) return;
    const timer = setTimeout(() => setQuery({ q: search }), 300);
    return () => clearTimeout(timer);
  }, [search, activeSearch, setQuery]);

  const refetch = list.refetch;

  // Un movimiento o un precio cambia la cantidad/estado: la página sube el
  // token y el panel refetchea sin remontar (conserva filtros y página).
  useEffect(() => {
    if (reloadToken > 0) refetch();
  }, [reloadToken, refetch]);

  async function mutate(
    row: CatalogEntry,
    action: RowAction,
    run: () => Promise<{ error: { message: string } | null }>,
    ok: string,
  ): Promise<void> {
    setBusy({ id: row.id, action });
    const error = await runAction(run);
    setMsg({ error, ok: error === null ? ok : null });
    if (error === null) {
      refetch();
      onChanged?.();
    }
    setBusy(null);
  }

  function alternarFaltante(row: CatalogEntry): void {
    const shortage = !row.is_shortage;
    void mutate(
      row,
      "shortage",
      () => setStoreProductShortage(storeId, row.id, shortage),
      shortage
        ? `"${row.name}" marcado como faltante.`
        : `"${row.name}" ya no está marcado como faltante.`,
    );
  }

  function quitar(row: CatalogEntry): void {
    const stock = row.quantity ?? 0;
    if (stock > 0) {
      const first = window.confirm(
        `"${row.name}" tiene ${formatQty(stock)} en stock. ¿Quitarlo del catálogo?`,
      );
      if (!first) return;
      const second = window.confirm(
        `Se van a descartar ${formatQty(stock)} de "${row.name}". Esta acción no se puede deshacer. ¿Confirmás?`,
      );
      if (!second) return;
    } else if (!window.confirm(`¿Quitar "${row.name}" del catálogo?`)) {
      return;
    }
    void mutate(
      row,
      "remove",
      () => removeStoreProduct(storeId, row.id, stock > 0),
      "Producto quitado del catálogo.",
    );
  }

  function openEdit(row: CatalogEntry): void {
    setEditing(row);
    setEditError(null);
    setEditDraft({
      quantity: String(row.quantity ?? 0),
      threshold: row.threshold == null ? "" : String(row.threshold),
    });
  }

  async function saveEdit(): Promise<void> {
    const row = editing;
    if (row === null) return;
    const quantity = Number(editDraft.quantity);
    const threshold = editDraft.threshold.trim() === "" ? null : Number(editDraft.threshold);
    if (!Number.isFinite(quantity) || quantity < 0) {
      setEditError("La cantidad no puede ser negativa.");
      return;
    }
    if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0)) {
      setEditError("El umbral no puede ser negativo.");
      return;
    }
    setSavingEdit(true);
    const error = await runAction(() =>
      updateStoreProduct(storeId, row.id, quantity, threshold, row.is_shortage),
    );
    setSavingEdit(false);
    if (error !== null) {
      setEditError(error);
      return;
    }
    setEditing(null);
    setMsg({ error: null, ok: `"${row.name}" actualizado.` });
    refetch();
    onChanged?.();
  }

  const filtered =
    list.query.q !== "" || list.query.categoryId !== null || list.query.onlyShortage;

  const columns: DataTableColumn<CatalogEntry>[] = [
    {
      key: "product",
      header: "Producto",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-gray-900">{row.name}</p>
          <p className="truncate text-xs text-gray-500">{row.brand?.name ?? "Sin marca"}</p>
        </div>
      ),
    },
    {
      key: "quantity",
      header: "Cantidad",
      render: (row) => (
        <span className="tabular-nums text-gray-900">{formatQty(row.quantity ?? 0)}</span>
      ),
    },
    {
      key: "threshold",
      header: "Umbral",
      render: (row) =>
        row.threshold == null ? (
          <span className="text-gray-400">—</span>
        ) : (
          <span className="tabular-nums text-gray-900">{formatQty(row.threshold)}</span>
        ),
    },
    {
      key: "expiry",
      header: "Vence",
      render: (row) => <span className="whitespace-nowrap">{row.expiry_date ?? "—"}</span>,
    },
    {
      key: "status",
      header: "Estado",
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StockBadge row={row} />
          {!row.is_active && <Badge tone="gray">Inactivo</Badge>}
          {row.is_shortage && <Badge tone="amber">Faltante</Badge>}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Acciones",
      render: (row) => (
        <span className="flex flex-wrap gap-1.5">
          <button className={ACTION_EDIT} type="button" onClick={() => openEdit(row)}>
            Editar
          </button>
          <button
            className={row.is_shortage ? ACTION_SHORTAGE_OFF : ACTION_SHORTAGE_ON}
            type="button"
            disabled={busy?.id === row.id}
            onClick={() => alternarFaltante(row)}
          >
            {row.is_shortage ? "Quitar faltante" : "Marcar faltante"}
          </button>
          <button
            className={ACTION_REMOVE}
            type="button"
            disabled={busy?.id === row.id}
            onClick={() => quitar(row)}
          >
            Quitar
          </button>
        </span>
      ),
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">
            Productos de {storeName}
          </h2>
          <p className="text-xs text-gray-500">
            Asigná productos a la tienda y editá cantidad, umbral y faltantes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500">
            {list.count === null ? "—" : `${list.count} productos`}
          </span>
          <button
            className={`${buttonClass} whitespace-normal text-center leading-tight`}
            type="button"
            onClick={() => setAdding(true)}
          >
            Agregar productos
          </button>
        </div>
      </div>

      <Status error={msg.error} ok={msg.ok} />

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="inventory-search" className="block text-sm font-medium text-gray-700">
            Buscar en la tienda
          </label>
          <input
            id="inventory-search"
            className={`mt-1 w-full ${inputClass}`}
            type="search"
            placeholder="Nombre del producto…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="inventory-category" className="block text-sm font-medium text-gray-700">
            Categoría
          </label>
          <select
            id="inventory-category"
            className={`mt-1 w-full ${inputClass}`}
            value={list.query.categoryId === null ? "" : String(list.query.categoryId)}
            onChange={(event) =>
              setQuery({
                categoryId: event.target.value === "" ? null : Number(event.target.value),
              })
            }
          >
            <option value="">Todas</option>
            {(categories.data ?? []).map((category) => (
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
            onChange={(event) => setQuery({ onlyShortage: event.target.checked })}
          />
          Solo faltantes
        </label>
      </div>

      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(row) => String(row.id)}
        loading={list.loading}
        error={list.error}
        emptyTitle={
          filtered
            ? "Ningún producto coincide con el filtro"
            : "La tienda no tiene productos asignados"
        }
        emptyHint={
          filtered
            ? "Probá con otro nombre, otra categoría o quitá el filtro de faltantes."
            : "Usá «Agregar productos» para sumar el primero al inventario."
        }
        footer={<Pager list={list} />}
      />

      {adding && (
        <Modal title="Agregar productos a la tienda" onClose={() => setAdding(false)}>
          <AddProductsPanel
            target={{ kind: "store", id: storeId, name: storeName }}
            categories={categories.data ?? []}
            onAdded={() => {
              refetch();
              onChanged?.();
            }}
          />
        </Modal>
      )}

      {editing !== null && (
        <Modal title={`Editar ${editing.name}`} onClose={() => setEditing(null)}>
          <Status error={editError} />
          <div className="space-y-4">
            <div>
              <span className="block text-sm font-medium text-gray-700">Cantidad en stock</span>
              <div className="mt-1.5">
                <QuantityStepper
                  label={editing.name}
                  value={editDraft.quantity}
                  onChange={(quantity) => setEditDraft({ ...editDraft, quantity })}
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Se ajusta sin registrar un movimiento.
              </p>
            </div>
            <label className="block text-sm">
              <span className="text-xs font-semibold tracking-wide text-gray-600">
                Umbral de alerta (opcional)
              </span>
              <input
                className={`mt-1 ${inputClass}`}
                type="number"
                min="0"
                step="0.001"
                placeholder="Sin umbral"
                value={editDraft.threshold}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, threshold: event.target.value })
                }
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button className={buttonClass} type="button" disabled={savingEdit} onClick={() => void saveEdit()}>
                {savingEdit ? "Guardando…" : "Guardar cambios"}
              </button>
              <button
                className={secondaryButtonClass}
                type="button"
                disabled={savingEdit}
                onClick={() => setEditing(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
