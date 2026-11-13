import { useId, useState } from "react";

import { formatCOP, formatQty } from "../lib/format";
import { Field, Status, inputClass } from "./Box";

// Selector de producto reutilizable: busca por nombre o marca y, cuando los
// datos traen stock, filtra por cantidad mínima. No reemplaza al <select>
// nativo: lo filtra, para conservar teclado, lector de pantalla y el picker
// nativo en móvil.
//
// `options` debe ser una referencia estable (useMemo): el estado de búsqueda
// vive dentro del componente y no se reinicia al re-renderizar el padre.

export interface ProductPickerOption {
  id: number;
  name: string;
  brand?: string | null;
  quantity?: number | null;
  price?: number | null;
  disabled?: boolean;
  disabledHint?: string;
}

export interface ProductPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly ProductPickerOption[];
  loading?: boolean;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  emptyHint?: string;
  /** Muestra el filtro numérico de stock (solo si las opciones lo traen). */
  showQuantityFilter?: boolean;
  /** Etiqueta visible/accesible del buscador. */
  searchLabel?: string;
  /** Etiqueta visible/accesible del filtro de cantidad. */
  quantityLabel?: string;
  /** Variante compacta para filas de formulario con varias líneas. */
  compact?: boolean;
  autoFocusSearch?: boolean;
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function optionLabel(option: ProductPickerOption): string {
  let label = option.name;
  if (option.brand !== null && option.brand !== undefined && option.brand !== "") {
    label += ` · ${option.brand}`;
  }
  if (option.quantity !== null && option.quantity !== undefined) {
    label += ` · Stock: ${formatQty(option.quantity)}`;
  }
  if (option.price === null) {
    label += " (sin precio)";
  } else if (option.price !== undefined) {
    label += ` — ${formatCOP(option.price)}`;
  }
  if (option.disabledHint !== undefined && option.disabledHint !== "") {
    label += ` (${option.disabledHint})`;
  }
  return label;
}

export function ProductPicker({
  label,
  value,
  onChange,
  options,
  loading = false,
  error = null,
  required = false,
  disabled = false,
  placeholder = "— elegir —",
  emptyHint,
  showQuantityFilter = false,
  searchLabel,
  quantityLabel,
  compact = false,
  autoFocusSearch = false,
}: ProductPickerProps) {
  const [search, setSearch] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  const searchId = useId();
  const quantityId = useId();

  const resolvedSearchLabel = searchLabel ?? "Buscar producto";
  const resolvedQuantityLabel = quantityLabel ?? "Cantidad mínima en stock";

  const normalizedSearch = normalizeText(search.trim());
  const parsedMin = minQuantity.trim() === "" ? null : Math.max(0, Number(minQuantity));
  const activeMin = parsedMin !== null && Number.isFinite(parsedMin) ? parsedMin : null;

  const filteredOptions = options.filter((option) => {
    const matchesText =
      normalizedSearch === "" ||
      normalizeText(option.name).includes(normalizedSearch) ||
      normalizeText(option.brand ?? "").includes(normalizedSearch);
    const matchesQuantity =
      activeMin === null ||
      (option.quantity !== null && option.quantity !== undefined && option.quantity >= activeMin);
    return matchesText && matchesQuantity;
  });

  // Si el usuario ya eligió un producto, sigue visible aunque el filtro actual
  // no lo muestre: un <select> cuyo value desaparece se ve vacío y confunde.
  const selected = options.find((option) => String(option.id) === value) ?? null;
  const visibleOptions =
    selected !== null && !filteredOptions.some((option) => option.id === selected.id)
      ? [selected, ...filteredOptions]
      : filteredOptions;

  const filtering = normalizedSearch !== "" || activeMin !== null;

  const searchInput = (
    <input
      id={compact ? undefined : searchId}
      className={inputClass}
      type="search"
      placeholder="Nombre o marca…"
      aria-label={compact ? resolvedSearchLabel : undefined}
      autoFocus={autoFocusSearch}
      disabled={loading || disabled}
      value={search}
      onChange={(event) => setSearch(event.target.value)}
      onKeyDown={(event) => {
        // Enter en un input de búsqueda dentro de un <form> lo enviaría antes
        // de elegir producto; acá solo filtra.
        if (event.key === "Enter") event.preventDefault();
      }}
    />
  );

  const quantityInput = showQuantityFilter ? (
    <input
      id={compact ? undefined : quantityId}
      className={inputClass}
      type="number"
      inputMode="decimal"
      min="0"
      step="0.001"
      placeholder="0"
      aria-label={compact ? resolvedQuantityLabel : undefined}
      disabled={loading || disabled}
      value={minQuantity}
      onChange={(event) => setMinQuantity(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
      }}
    />
  ) : null;

  const filterSummary = filtering ? (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
      <span
        role="status"
        className={filteredOptions.length === 0 ? "font-medium text-amber-700" : "text-gray-500"}
      >
        {filteredOptions.length === 0
          ? "Sin coincidencias"
          : `${filteredOptions.length} de ${options.length} productos`}
      </span>
      <button
        type="button"
        className="font-medium text-gray-700 underline underline-offset-2 transition hover:text-gray-900"
        onClick={() => {
          setSearch("");
          setMinQuantity("");
        }}
      >
        Limpiar filtros
      </button>
    </div>
  ) : null;

  const select = (
    <select
      className={inputClass}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={required}
      disabled={disabled || loading}
      aria-label={compact ? label : undefined}
    >
      <option value="">{placeholder}</option>
      {visibleOptions.map((option) => (
        <option key={option.id} value={option.id} disabled={option.disabled}>
          {optionLabel(option)}
        </option>
      ))}
    </select>
  );

  const emptyMessage =
    !loading && error === null && options.length === 0 && emptyHint !== undefined ? (
      <p className="mt-1 text-xs text-gray-500">{emptyHint}</p>
    ) : null;

  if (compact) {
    return (
      <div className="min-w-0">
        <Status loading={loading} error={error} />
        <div
          className={`mb-2 grid gap-2 ${
            showQuantityFilter ? "sm:grid-cols-[minmax(0,1fr)_7rem]" : ""
          }`}
        >
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Buscar
            </span>
            {searchInput}
          </label>
          {quantityInput !== null && (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Stock mín.
              </span>
              {quantityInput}
            </label>
          )}
        </div>
        {filterSummary}
        {select}
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="max-w-md">
      <Status loading={loading} error={error} />
      <div className={`mb-3 ${showQuantityFilter ? "grid gap-2 sm:grid-cols-2" : ""}`}>
        <label htmlFor={searchId} className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs font-semibold tracking-wide text-gray-600">
            {resolvedSearchLabel}
          </span>
          {searchInput}
        </label>
        {showQuantityFilter && (
          <label htmlFor={quantityId} className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-semibold tracking-wide text-gray-600">
              {resolvedQuantityLabel}
            </span>
            {quantityInput}
          </label>
        )}
      </div>
      {filterSummary}
      <Field label={label}>{select}</Field>
      {emptyMessage}
    </div>
  );
}
