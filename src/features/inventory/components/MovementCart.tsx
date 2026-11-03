import { useMemo, useState, type KeyboardEvent } from "react";

import { formatCOP, formatQty } from "../../../shared/lib/format";
import { Status, inputClass, secondaryButtonClass } from "../../../shared/ui/Box";
import { QuantityStepper } from "../../../shared/ui";
import { BarcodeScanner } from "../../products/components/BarcodeScanner";
import type { MovementProductOption } from "../api";

/** Línea del ticket: los precios se escriben como texto y se validan al enviar. */
export interface CartLine {
  productId: number;
  name: string;
  brand: string | null;
  quantity: string;
  /** Precio unitario de lista; el descuento se aplica al total del ticket. */
  unitPrice: string;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** Precio unitario neto de una línea (redondeo a 2 decimales como numeric(12,2)). */
export function netUnitPrice(price: string, discount: string): number | null {
  const base = Number(price);
  if (!(base > 0)) return null;
  const pct = Number(discount);
  const safe = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  return Math.round(base * (1 - safe / 100) * 100) / 100;
}

export function cartSubtotal(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => {
    const price = Number(line.unitPrice);
    const quantity = Number(line.quantity);
    if (!(price > 0) || !(quantity > 0)) return sum;
    return sum + price * quantity;
  }, 0);
}

export function cartTotal(lines: readonly CartLine[], discount: string): number {
  return lines.reduce((sum, line) => {
    const net = netUnitPrice(line.unitPrice, discount);
    const quantity = Number(line.quantity);
    if (net === null || !(quantity > 0)) return sum;
    return sum + net * quantity;
  }, 0);
}

/**
 * Ticket de movimientos compartido por la tienda y el distribuidor: buscador,
 * escáner de código de barras, líneas con cantidad/precio y total con descuento.
 */
export function MovementCart({
  options,
  loading = false,
  error = null,
  lines,
  onChange,
  priceKind,
  showPrices = true,
  showDiscount = false,
  discount,
  onDiscountChange,
  emptyHint,
  disabled = false,
  recentProductIds = [],
}: {
  options: readonly MovementProductOption[];
  loading?: boolean;
  error?: string | null;
  lines: readonly CartLine[];
  onChange: (lines: CartLine[]) => void;
  priceKind: "purchase" | "sale";
  showPrices?: boolean;
  showDiscount?: boolean;
  discount: string;
  onDiscountChange: (value: string) => void;
  emptyHint?: string;
  disabled?: boolean;
  /** 0038: ids vendidos recientemente, para los atajos del ticket. */
  recentProductIds?: readonly number[];
}) {
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const priceLabel = priceKind === "purchase" ? "Precio de compra" : "Precio de venta";

  const filtered = useMemo(() => {
    const term = normalize(search.trim());
    const list =
      term === ""
        ? options
        : options.filter((option) =>
            normalize(`${option.name} ${option.brand ?? ""} ${option.barcode ?? ""}`).includes(
              term,
            ),
          );
    return list.slice(0, 12);
  }, [options, search]);

  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);

  function suggestedPrice(option: MovementProductOption): string {
    const value = priceKind === "purchase" ? option.purchasePrice : option.salePrice;
    return value === null || value === undefined ? "" : String(value);
  }

  function addProduct(option: MovementProductOption): void {
    setNotice(null);
    const existing = lines.find((line) => line.productId === option.id);
    if (existing !== undefined) {
      const quantity = Number(existing.quantity);
      const next = Number.isFinite(quantity) ? quantity + 1 : 1;
      onChange(
        lines.map((line) =>
          line.productId === option.id ? { ...line, quantity: String(next) } : line,
        ),
      );
      return;
    }
    onChange([
      ...lines,
      {
        productId: option.id,
        name: option.name,
        brand: option.brand,
        quantity: "1",
        unitPrice: suggestedPrice(option),
      },
    ]);
  }

  function updateLine(productId: number, patch: Partial<CartLine>): void {
    onChange(lines.map((line) => (line.productId === productId ? { ...line, ...patch } : line)));
  }

  function removeLine(productId: number): void {
    onChange(lines.filter((line) => line.productId !== productId));
  }

  function onScanned(raw: string): void {
    const code = raw.trim();
    const match = options.find(
      (option) => option.barcode !== null && option.barcode === code,
    );
    if (match === undefined) {
      setNotice(`El código ${code} no está en el catálogo de esta tienda.`);
      return;
    }
    addProduct(match);
    setNotice(`${match.name} agregado al ticket.`);
  }

  // 0038 · venta rápida: escribir o escanear y Enter agrega el producto sin
  // tocar la lista. Con un código exacto gana el código; si el filtro deja un
  // solo candidato, ese. El buscador queda limpio y enfocado para el siguiente.
  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const term = search.trim();
    if (term === "") return;
    const byCode = options.find((option) => option.barcode !== null && option.barcode === term);
    const match = byCode ?? (filtered.length === 1 ? filtered[0] : undefined);
    if (match === undefined) {
      setNotice("Ningún producto coincide con la búsqueda.");
      return;
    }
    addProduct(match);
    setSearch("");
    setNotice(`${match.name} agregado al ticket.`);
  }

  const recent = recentProductIds
    .map((id) => byId.get(id))
    .filter((option): option is MovementProductOption => option !== undefined)
    .slice(0, 6);

  const subtotal = cartSubtotal(lines);
  const total = cartTotal(lines, discount);
  const discountAmount = Math.max(0, subtotal - total);
  const discountPct = Number(discount);
  const discountInvalid =
    discount.trim() !== "" && (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100);

  return (
    <div>
      <label className="block">
        <span className="text-xs font-semibold tracking-wide text-gray-600">
          Producto o código de barras
        </span>
        <input
          className={`${inputClass} mt-1.5 w-full`}
          type="search"
          placeholder="Nombre, marca o código…"
          aria-label="Buscar producto o código"
          value={search}
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={onSearchKeyDown}
          autoFocus
        />
        <span className="mt-1 block text-[11px] text-gray-500">
          Escaneá seguido para sumar unidades · Enter agrega el primero
        </span>
      </label>

      {recent.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Últimos vendidos
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {recent.map((option) => {
              const added = lines.some((line) => line.productId === option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-label={`Agregar ${option.name} de últimos vendidos`}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    added
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                  disabled={disabled}
                  onClick={() => addProduct(option)}
                >
                  {option.name}
                  {added && <span aria-hidden="true">+1</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <BarcodeScanner onCode={onScanned} disabled={disabled} continuous />
      {notice !== null && (
        <p role="status" className="mt-2 text-xs text-gray-600">
          {notice}
        </p>
      )}

      <Status loading={loading} error={error} />

      <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-gray-100">
        {filtered.length === 0 ? (
          <p className="px-3 py-3 text-sm text-gray-500">
            {options.length === 0
              ? (emptyHint ?? "No hay productos disponibles.")
              : "Ningún producto coincide con la búsqueda."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((option) => {
              const added = lines.find((line) => line.productId === option.id) !== undefined;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={disabled}
                    onClick={() => addProduct(option)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-gray-900">
                        {option.name}
                      </span>
                      <span className="block truncate text-xs text-gray-500">
                        {option.brand ?? "Sin marca"}
                        {option.quantity === null ? "" : ` · Stock: ${formatQty(option.quantity)}`}
                        {option.barcode === null ? "" : ` · ${option.barcode}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-gray-500">
                      {added ? "Agregado +1" : "Agregar"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-500">
          El ticket está vacío. Buscá, escaneá o tocá un producto para empezar.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {lines.map((line) => {
            const stock = byId.get(line.productId)?.quantity ?? null;
            const quantity = Number(line.quantity);
            const overStock = priceKind === "sale" && stock !== null && quantity > stock;
            return (
              <li key={line.productId} className="rounded-xl border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{line.name}</p>
                    <p className="text-xs text-gray-500">
                      {line.brand ?? "Sin marca"}
                      {stock === null ? "" : ` · Stock: ${formatQty(stock)}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
                    aria-label={`Quitar ${line.name}`}
                    disabled={disabled}
                    onClick={() => removeLine(line.productId)}
                  >
                    Quitar
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <div>
                    <span className="block text-[11px] font-medium text-gray-500">Cantidad</span>
                    <div className="mt-1">
                      <QuantityStepper
                        label={line.name}
                        value={line.quantity}
                        onChange={(quantity) => updateLine(line.productId, { quantity })}
                      />
                    </div>
                  </div>
                  {showPrices && (
                    <label className="block">
                      <span className="block text-[11px] font-medium text-gray-500">
                        {priceLabel}
                      </span>
                      <input
                        className={`${inputClass} mt-1 w-32`}
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="0"
                        aria-label={`${priceLabel} de ${line.name}`}
                        value={line.unitPrice}
                        disabled={disabled}
                        onChange={(event) =>
                          updateLine(line.productId, { unitPrice: event.target.value })
                        }
                      />
                    </label>
                  )}
                  {showPrices && (
                    <p className="ml-auto text-sm font-semibold tabular-nums text-gray-900">
                      {formatCOP((Number(line.unitPrice) || 0) * (Number(line.quantity) || 0))}
                    </p>
                  )}
                </div>
                {overStock && (
                  <p role="alert" className="mt-2 text-xs font-medium text-red-700">
                    La cantidad supera el stock disponible ({formatQty(stock ?? 0)}).
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {lines.length > 0 && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
          {showPrices && (
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatCOP(subtotal)}</span>
            </div>
          )}
          {showDiscount && (
            <label className="mt-2 flex items-center justify-between gap-3 text-sm text-gray-700">
              <span>Descuento (%)</span>
              <input
                className={`${inputClass} w-20 text-right`}
                type="number"
                min="0"
                max="100"
                step="0.01"
                aria-label="Descuento (%)"
                value={discount}
                disabled={disabled}
                onChange={(event) => onDiscountChange(event.target.value)}
              />
            </label>
          )}
          {discountInvalid && (
            <p role="alert" className="mt-1 text-xs font-medium text-red-700">
              El descuento debe estar entre 0 y 100.
            </p>
          )}
          {showPrices && discountAmount > 0 && (
            <div className="mt-2 flex items-center justify-between text-sm text-emerald-700">
              <span>Descuento aplicado</span>
              <span className="tabular-nums">−{formatCOP(discountAmount)}</span>
            </div>
          )}
          {showPrices && (
            <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2 text-base font-semibold text-gray-900">
              <span>Total</span>
              <span className="tabular-nums">{formatCOP(total)}</span>
            </div>
          )}
          {!showPrices && (
            <p className="text-xs text-gray-500">
              {lines.length} {lines.length === 1 ? "producto" : "productos"} en el ticket.
            </p>
          )}
        </div>
      )}

      {lines.length > 0 && (
        <button
          type="button"
          className={`${secondaryButtonClass} mt-3 px-3 py-1.5 text-xs`}
          disabled={disabled}
          onClick={() => {
            onChange([]);
            onDiscountChange("");
            setNotice(null);
          }}
        >
          Vaciar ticket
        </button>
      )}
    </div>
  );
}
