import type { ProductFormValues } from "../schemas";
import type { CatalogRef } from "../types";
import { BarcodeScanner } from "./BarcodeScanner";

export interface ProductFormErrors {
  name?: string;
  description?: string;
  brand_id?: string;
  unit_type_id?: string;
  category_id?: string;
  base_quantity?: string;
  barcode?: string;
}

export interface ProductFormProps {
  values: ProductFormValues;
  errors: ProductFormErrors;
  // Mapeado por mapError() en el call site del contenedor (HARD-1).
  formError: string | null;
  saving: boolean;
  // distribuidor (y rol null) en /products/:id: datos visibles, cero controles
  // de escritura (SEC-01 idea:113 "solo lectura"; ocultar es UX — idea:134).
  readOnly: boolean;
  // admin en modo edición (el borrado en dos pasos vive en el contenedor).
  canDelete: boolean;
  submitLabel: string;
  brands: CatalogRef[];
  units: CatalogRef[];
  categories: CatalogRef[];
  onChange: (next: ProductFormValues) => void;
  onSubmit: () => void;
  onDelete: () => void;
}

// Presentacional pura (D1): formulario de producto para alta y edición.
// Los FK se pintan como <select> poblados desde los catálogos sembrados
// (T6.2 "catalog FK selects"); la validación Zod corre en el contenedor
// ANTES de cualquier request (idea:198 / PROD-3) — acá solo se pintan los
// errores por campo. Los textos de las opciones placeholder son DISTINTOS de
// los mensajes de error: un placeholder idéntico duplicaría el texto en el
// DOM y rompería los tests estructurales (lección de B5/#519).
export function ProductForm({
  values,
  errors,
  formError,
  saving,
  readOnly,
  canDelete,
  submitLabel,
  brands,
  units,
  categories,
  onChange,
  onSubmit,
  onDelete,
}: ProductFormProps) {
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {formError !== null && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {formError}
        </p>
      )}
      {readOnly && (
        <p
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          Vista de solo lectura: no tenés permisos para editar productos.
        </p>
      )}
      <div>
        <label htmlFor="product-name" className="block text-sm font-medium text-gray-700">
          Nombre
        </label>
        <input
          id="product-name"
          type="text"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.name}
          aria-invalid={errors.name !== undefined}
          aria-describedby={errors.name === undefined ? undefined : "product-name-error"}
          onChange={(event) => onChange({ ...values, name: event.target.value })}
        />
        {errors.name !== undefined && (
          <p id="product-name-error" className="mt-1 text-xs text-red-600">
            {errors.name}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="product-description" className="block text-sm font-medium text-gray-700">
          Descripción
        </label>
        <textarea
          id="product-description"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.description}
          onChange={(event) => onChange({ ...values, description: event.target.value })}
        />
      </div>
      <div>
        <label htmlFor="product-brand" className="block text-sm font-medium text-gray-700">
          Marca
        </label>
        <select
          id="product-brand"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.brand_id}
          aria-invalid={errors.brand_id !== undefined}
          aria-describedby={errors.brand_id === undefined ? undefined : "product-brand-error"}
          onChange={(event) => onChange({ ...values, brand_id: event.target.value })}
        >
          <option value="">Seleccioná una marca</option>
          {brands.map((brand) => (
            <option key={brand.id} value={String(brand.id)}>
              {brand.name}
            </option>
          ))}
        </select>
        {errors.brand_id !== undefined && (
          <p id="product-brand-error" className="mt-1 text-xs text-red-600">
            {errors.brand_id}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="product-unit" className="block text-sm font-medium text-gray-700">
          Unidad de medida
        </label>
        <select
          id="product-unit"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.unit_type_id}
          aria-invalid={errors.unit_type_id !== undefined}
          aria-describedby={errors.unit_type_id === undefined ? undefined : "product-unit-error"}
          onChange={(event) => onChange({ ...values, unit_type_id: event.target.value })}
        >
          <option value="">Seleccioná una unidad de medida</option>
          {units.map((unit) => (
            <option key={unit.id} value={String(unit.id)}>
              {unit.name}
            </option>
          ))}
        </select>
        {errors.unit_type_id !== undefined && (
          <p id="product-unit-error" className="mt-1 text-xs text-red-600">
            {errors.unit_type_id}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="product-category" className="block text-sm font-medium text-gray-700">
          Categoría
        </label>
        <select
          id="product-category"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.category_id}
          aria-invalid={errors.category_id !== undefined}
          aria-describedby={
            errors.category_id === undefined ? undefined : "product-category-error"
          }
          onChange={(event) => onChange({ ...values, category_id: event.target.value })}
        >
          <option value="">Seleccioná una categoría</option>
          {categories.map((category) => (
            <option key={category.id} value={String(category.id)}>
              {category.name}
            </option>
          ))}
        </select>
        {errors.category_id !== undefined && (
          <p id="product-category-error" className="mt-1 text-xs text-red-600">
            {errors.category_id}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="product-base-quantity" className="block text-sm font-medium text-gray-700">
          Cantidad base
        </label>
        <input
          id="product-base-quantity"
          type="number"
          step="any"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.base_quantity}
          aria-invalid={errors.base_quantity !== undefined}
          aria-describedby={
            errors.base_quantity === undefined ? undefined : "product-base-quantity-error"
          }
          onChange={(event) => onChange({ ...values, base_quantity: event.target.value })}
        />
        {errors.base_quantity !== undefined && (
          <p id="product-base-quantity-error" className="mt-1 text-xs text-red-600">
            {errors.base_quantity}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="product-barcode" className="block text-sm font-medium text-gray-700">
          Código de barras (opcional)
        </label>
        <input
          id="product-barcode"
          type="text"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.barcode}
          aria-invalid={errors.barcode !== undefined}
          aria-describedby={
            errors.barcode === undefined
              ? "product-barcode-hint"
              : "product-barcode-hint product-barcode-error"
          }
          onChange={(event) => onChange({ ...values, barcode: event.target.value })}
        />
        <p id="product-barcode-hint" className="mt-1 text-xs text-gray-500">
          Escaneá el código con la cámara o escribilo a mano.
        </p>
        {errors.barcode !== undefined && (
          <p id="product-barcode-error" className="mt-1 text-xs text-red-600">
            {errors.barcode}
          </p>
        )}
        {!readOnly && (
          <BarcodeScanner
            disabled={saving}
            onCode={(raw) => onChange({ ...values, barcode: raw })}
          />
        )}
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {saving ? "Guardando…" : submitLabel}
          </button>
          {canDelete && (
            <button
              type="button"
              disabled={saving}
              onClick={onDelete}
              className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Desactivar producto
            </button>
          )}
        </div>
      )}
    </form>
  );
}
