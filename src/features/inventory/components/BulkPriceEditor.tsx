import { useMemo, useState, type ClipboardEvent } from "react";

import { Status, buttonClass, inputClass, secondaryButtonClass } from "../../../shared/ui/Box";

// 0043 — carga masiva de precios de una tienda. Una tabla editable con compra y
// venta: lo que el usuario cambia se manda en UNA RPC transaccional. El filtro
// «solo sin precio» usa el valor INICIAL de la fila para que la fila no
// desaparezca mientras se escribe.

export interface BulkPriceProduct {
  id: number;
  name: string;
  brand: string | null;
}

export interface BulkPriceLine {
  productId: number;
  /** Precio final; solo se aplica si `writePurchase` es true. */
  purchasePrice: number | null;
  /** Precio final; solo se aplica si `writeSale` es true. */
  salePrice: number | null;
  /** Solo se escribe la columna que el usuario tocó. */
  writePurchase: boolean;
  writeSale: boolean;
}

type PriceColumn = "purchase" | "sale";

interface EditableRow {
  id: number;
  name: string;
  brand: string | null;
  purchase: string;
  sale: string;
  initialPurchase: string;
  initialSale: string;
}

// Solo dígitos con hasta dos decimales. "2.500" (punto de miles colombiano)
// queda fuera a propósito: Number("2.500") sería 2.5 y guardaríamos un precio
// 1000 veces menor sin que nadie lo note.
const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

const NO_OVERRIDES: ReadonlyMap<number, number> = new Map();

export const INVALID_PRICE_HINT =
  "Escribí solo números con hasta dos decimales (2500 o 2500.50); sin puntos de miles.";

function priceText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/** null = vacío, NaN = inválido, número = precio válido (> 0). */
export function parsePriceInput(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  if (!PRICE_PATTERN.test(text)) return Number.NaN;
  const value = Number(text);
  return value > 0 ? value : Number.NaN;
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function buildRows(
  products: readonly BulkPriceProduct[],
  purchasePrices: ReadonlyMap<number, number>,
  salePrices: ReadonlyMap<number, number>,
): EditableRow[] {
  return [...products]
    .sort((a, b) => a.name.localeCompare(b.name, "es") || a.id - b.id)
    .map((product) => {
      const purchase = priceText(purchasePrices.get(product.id));
      const sale = priceText(salePrices.get(product.id));
      return {
        id: product.id,
        name: product.name,
        brand: product.brand,
        purchase,
        sale,
        initialPurchase: purchase,
        initialSale: sale,
      };
    });
}

function purchaseDirty(row: EditableRow): boolean {
  return row.purchase !== row.initialPurchase;
}

function saleDirty(row: EditableRow): boolean {
  return row.sale !== row.initialSale;
}

function isDirty(row: EditableRow): boolean {
  return purchaseDirty(row) || saleDirty(row);
}

function cellInputClass(value: string, highlight: boolean): string {
  return `${inputClass} w-24 text-right tabular-nums sm:w-28 ${
    highlight && value.trim() === "" ? "border-amber-300 bg-amber-50/40" : ""
  }`;
}

/**
 * Equivalente cliente de `round(cost * (1 + margin/100), 0)` del servidor
 * (mitad hacia arriba). Trabaja en centésimas para no divergir por el error
 * binario: `Math.round(1250 * 1.13)` da 1412 y el servidor publica 1413.
 */
export function suggestedSalePrice(cost: number, margin: number): number | null {
  if (!Number.isFinite(cost) || cost <= 0) return null;
  if (!Number.isFinite(margin) || margin <= 0) return null;
  const costCents = Math.round(cost * 100);
  const marginHundredths = Math.round(margin * 100);
  const numerator = costCents * (10000 + marginHundredths);
  const denominator = 1_000_000;
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function BulkPriceEditor({
  products,
  purchasePrices,
  salePrices,
  marginPct = null,
  marginOverrides = NO_OVERRIDES,
  busy = false,
  onSave,
}: {
  products: readonly BulkPriceProduct[];
  purchasePrices: ReadonlyMap<number, number>;
  salePrices: ReadonlyMap<number, number>;
  /** 0045: margen del usuario sobre el costo; null/0 oculta la acción. */
  marginPct?: number | null;
  /** 0046: excepción de margen por producto (0 = no sugerir). */
  marginOverrides?: ReadonlyMap<number, number>;
  /** Mutación en curso en la página. */
  busy?: boolean;
  /** Devuelve el error ya mapeado, o null si guardó. */
  onSave: (lines: readonly BulkPriceLine[]) => Promise<string | null>;
}) {
  const [rows, setRows] = useState<EditableRow[]>(() =>
    buildRows(products, purchasePrices, salePrices),
  );
  const [search, setSearch] = useState("");
  // Si hay algo sin precio de venta, arranca filtrado: es el caso de uso.
  const [onlyMissing, setOnlyMissing] = useState(() => rows.some((row) => row.initialSale === ""));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const changedRows = rows.filter(isDirty);
  const missingSaleCount = rows.filter((row) => row.initialSale === "").length;
  const margin = marginPct !== null && marginPct > 0 ? marginPct : null;

  const visibleRows = useMemo(() => {
    const term = normalizeText(search.trim());
    return rows.filter((row) => {
      if (onlyMissing && row.initialSale !== "") return false;
      if (term === "") return true;
      return normalizeText(`${row.name} ${row.brand ?? ""}`).includes(term);
    });
  }, [rows, onlyMissing, search]);
  const visibleIds = visibleRows.map((row) => row.id);

  function updateCell(id: number, column: PriceColumn, value: string): void {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row;
        return column === "purchase" ? { ...row, purchase: value } : { ...row, sale: value };
      }),
    );
  }

  // 0046: aplica el margen del usuario a las filas VISIBLES que tienen costo y
  // todavía no tienen precio de venta. Nunca completa una venta ya escrita.
  function applyMargin(): void {
    if (margin === null && marginOverrides.size === 0) return;
    const visibleSet = new Set(visibleIds);
    let filled = 0;
    const next = rows.map((row) => {
      if (!visibleSet.has(row.id) || row.sale.trim() !== "") return row;
      const cost = parsePriceInput(row.purchase);
      if (cost === null || Number.isNaN(cost)) return row;
      // 0046: la excepción del producto manda; 0 desactiva la sugerencia.
      const effective = marginOverrides.get(row.id) ?? margin;
      if (effective === null || effective <= 0) return row;
      const sale = suggestedSalePrice(cost, effective);
      if (sale === null) return row;
      filled += 1;
      return { ...row, sale: String(sale) };
    });
    setRows(next);
    setError(null);
    setNotice(
      filled === 0
        ? "No hay productos visibles con costo y sin precio de venta."
        : `Apliqué el margen a ${filled} ${filled === 1 ? "producto" : "productos"}.`,
    );
  }

  // Pegar una columna desde Excel: se llena hacia abajo desde la fila enfocada,
  // en el mismo orden que se ve en la tabla. El valor único se deja al navegador.
  function onPasteColumn(
    event: ClipboardEvent<HTMLInputElement>,
    rowId: number,
    column: PriceColumn,
  ): void {
    const lines = event.clipboardData.getData("text/plain").split(/\r?\n/);
    // Solo se descartan las líneas vacías del FINAL. Un hueco en medio es una
    // celda vacía de Excel y debe conservar su posición, o los precios caen en
    // el producto equivocado.
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    if (lines.length < 2) return;
    event.preventDefault();

    const start = visibleIds.indexOf(rowId);
    if (start < 0) return;
    const values = lines.map((line) => line.trim());
    const invalid = values.find((value) => value !== "" && Number.isNaN(parsePriceInput(value)));
    if (invalid !== undefined) {
      setError(`No pude leer «${invalid}». ${INVALID_PRICE_HINT}`);
      return;
    }

    const targets = visibleIds.slice(start, start + values.length);
    const next = new Map<number, string>();
    let skipped = 0;
    targets.forEach((id, index) => {
      const value = values[index];
      if (value === undefined || value === "") {
        skipped += 1;
        return;
      }
      next.set(id, value);
    });
    setRows((current) =>
      current.map((row) => {
        const value = next.get(row.id);
        if (value === undefined) return row;
        return column === "purchase" ? { ...row, purchase: value } : { ...row, sale: value };
      }),
    );
    setError(null);
    const extra = values.length - targets.length;
    let message = `Pegué ${next.size} ${
      column === "purchase" ? "precios de compra" : "precios de venta"
    }`;
    if (skipped > 0) {
      message += ` (${skipped} ${skipped === 1 ? "celda vacía se dejó" : "celdas vacías se dejaron"} igual)`;
    }
    if (extra > 0) message += ` (sobraron ${extra})`;
    setNotice(`${message}.`);
  }

  async function save(): Promise<void> {
    setNotice(null);
    if (changedRows.length === 0) {
      setError(null);
      setNotice("No hay cambios para guardar.");
      return;
    }

    const sentById = new Map<
      number,
      { purchase: string; sale: string; writePurchase: boolean; writeSale: boolean }
    >();
    const lines: BulkPriceLine[] = [];
    for (const row of changedRows) {
      const writePurchase = purchaseDirty(row);
      const writeSale = saleDirty(row);
      const purchasePrice = parsePriceInput(row.purchase);
      const salePrice = parsePriceInput(row.sale);
      if (
        (writePurchase && Number.isNaN(purchasePrice)) ||
        (writeSale && Number.isNaN(salePrice))
      ) {
        setError(`Revisá «${row.name}»: ${INVALID_PRICE_HINT}`);
        return;
      }
      sentById.set(row.id, {
        purchase: row.purchase,
        sale: row.sale,
        writePurchase,
        writeSale,
      });
      lines.push({
        productId: row.id,
        purchasePrice: writePurchase ? purchasePrice : null,
        salePrice: writeSale ? salePrice : null,
        writePurchase,
        writeSale,
      });
    }

    setError(null);
    setSaving(true);
    try {
      const failure = await onSave(lines);
      if (failure !== null) {
        setError(failure);
        return;
      }
      setRows((current) =>
        current.map((row) => {
          const sent = sentById.get(row.id);
          if (sent === undefined) return row;
          return {
            ...row,
            initialPurchase: sent.writePurchase ? sent.purchase : row.initialPurchase,
            initialSale: sent.writeSale ? sent.sale : row.initialSale,
          };
        }),
      );
      setNotice(
        `${lines.length} ${lines.length === 1 ? "producto guardado" : "productos guardados"}.`,
      );
    } finally {
      setSaving(false);
    }
  }

  const disabled = busy || saving || changedRows.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          {missingSaleCount} de {rows.length} {rows.length === 1 ? "producto" : "productos"} sin
          precio de venta.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300"
              checked={onlyMissing}
              onChange={(event) => setOnlyMissing(event.target.checked)}
            />
            Solo sin precio
          </label>
          {(margin !== null || marginOverrides.size > 0) && (
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={busy || saving}
              onClick={applyMargin}
            >
              Aplicar margen{margin !== null ? ` (${margin}%)` : ""}
            </button>
          )}
        </div>
      </div>

      <input
        className={`${inputClass} w-full`}
        type="search"
        placeholder="Buscar por nombre o marca…"
        aria-label="Buscar producto para cargar precios"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <Status loading={saving} error={error} ok={notice} />

      <div className="max-h-[55vh] overflow-auto rounded-xl border border-gray-200">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 text-left">
            <tr>
              <th
                scope="col"
                className="px-2 py-2 sm:px-3 text-xs font-semibold tracking-wide text-gray-600"
              >
                Producto
              </th>
              <th
                scope="col"
                className="px-2 py-2 sm:px-3 text-right text-xs font-semibold tracking-wide text-gray-600"
              >
                Compra (COP)
              </th>
              <th
                scope="col"
                className="px-2 py-2 sm:px-3 text-right text-xs font-semibold tracking-wide text-gray-600"
              >
                Venta (COP)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visibleRows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="px-2 py-2 sm:px-3 text-left font-normal">
                  <span className="font-medium text-gray-900">{row.name}</span>
                  {row.brand !== null && row.brand !== "" && (
                    <span className="ml-1.5 text-xs text-gray-500">{row.brand}</span>
                  )}
                </th>
                <td className="px-2 py-2 sm:px-3 text-right">
                  <input
                    className={cellInputClass(row.purchase, false)}
                    type="text"
                    inputMode="decimal"
                    placeholder="—"
                    aria-label={`Precio de compra de ${row.name}`}
                    value={row.purchase}
                    disabled={busy || saving}
                    onChange={(event) => updateCell(row.id, "purchase", event.target.value)}
                    onPaste={(event) => onPasteColumn(event, row.id, "purchase")}
                  />
                </td>
                <td className="px-2 py-2 sm:px-3 text-right">
                  <input
                    className={cellInputClass(row.sale, true)}
                    type="text"
                    inputMode="decimal"
                    placeholder="—"
                    aria-label={`Precio de venta de ${row.name}`}
                    value={row.sale}
                    disabled={busy || saving}
                    onChange={(event) => updateCell(row.id, "sale", event.target.value)}
                    onPaste={(event) => onPasteColumn(event, row.id, "sale")}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleRows.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-gray-500">
            {rows.length === 0
              ? "La tienda no tiene productos asignados."
              : "Ningún producto coincide con el filtro."}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="hidden max-w-md text-xs text-gray-500 sm:block">
          Pegá una columna desde Excel: se llena hacia abajo.
        </p>
        <button
          className={`${buttonClass} w-full sm:w-auto`}
          type="button"
          onClick={() => void save()}
          disabled={disabled}
        >
          {saving ? "Guardando…" : `Guardar cambios (${changedRows.length})`}
        </button>
      </div>
    </div>
  );
}
