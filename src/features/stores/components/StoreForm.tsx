import type { StoreFormValues } from "../schemas";
import type { StoreTypeRef } from "../types";

export interface StoreFormErrors {
  name?: string;
  store_type_id?: string;
  lat?: string;
  lng?: string;
}

export interface StoreFormProps {
  values: StoreFormValues;
  errors: StoreFormErrors;
  // Mapeado por mapError() en el call site del contenedor (HARD-1).
  formError: string | null;
  saving: boolean;
  // La ruta /stores/:id exige admin|operador (§S2: distribuidor ✘ en tiendas,
  // idea:114), así que hoy no hay rol que lo pinte — se mantiene como defensa
  // por si el guard de la ruta cambia (idea:134: ocultar es UX, la DB manda).
  readOnly: boolean;
  // admin en modo edición (el borrado en dos pasos vive en el contenedor):
  // SEC-01 idea:114 — operador crea/edita pero NO borra (idea:130 "sin
  // destruir"); el DELETE es admin-only (0006:172-174).
  canDelete: boolean;
  submitLabel: string;
  storeTypes: StoreTypeRef[];
  onChange: (next: StoreFormValues) => void;
  onSubmit: () => void;
  onDelete: () => void;
}

// Presentacional pura (D1): formulario de tienda para alta y edición (§S2 fila
// Store form · STORE-1/STORE-3). El tipo se pinta como <select> poblado desde
// el catálogo store_types sembrado (0006:76-77); la validación Zod corre en el
// contenedor ANTES de cualquier request (idea:198 / STORE-1) — acá solo se
// pintan los errores por campo.
//
// COORDENADAS (trap #2 de B7 · D3): campos numéricos MANUALES, sin mapa, con
// el rango escrito en el propio label — latitud (-90 a 90) y longitud
// (-180 a 180) no se pueden confundir leyendo la pantalla. El orden EWKT
// (lng-first) lo garantiza geo.ts en el armado del request; acá solo se
// separan los campos para que el usuario meta el valor correcto en el correcto.
// Los placeholders son DISTINTOS de los mensajes de error: un placeholder
// idéntico duplicaría texto en el DOM y rompería los tests estructurales
// (lección #519).
export function StoreForm({
  values,
  errors,
  formError,
  saving,
  readOnly,
  canDelete,
  submitLabel,
  storeTypes,
  onChange,
  onSubmit,
  onDelete,
}: StoreFormProps) {
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
          Vista de solo lectura: no tenés permisos para editar tiendas.
        </p>
      )}
      <div>
        <label htmlFor="store-name" className="block text-sm font-medium text-gray-700">
          Nombre
        </label>
        <input
          id="store-name"
          type="text"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.name}
          aria-invalid={errors.name !== undefined}
          aria-describedby={errors.name === undefined ? undefined : "store-name-error"}
          onChange={(event) => onChange({ ...values, name: event.target.value })}
        />
        {errors.name !== undefined && (
          <p id="store-name-error" className="mt-1 text-xs text-red-600">
            {errors.name}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="store-type" className="block text-sm font-medium text-gray-700">
          Tipo de tienda
        </label>
        <select
          id="store-type"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.store_type_id}
          aria-invalid={errors.store_type_id !== undefined}
          aria-describedby={errors.store_type_id === undefined ? undefined : "store-type-error"}
          onChange={(event) => onChange({ ...values, store_type_id: event.target.value })}
        >
          <option value="">Seleccioná un tipo de tienda</option>
          {storeTypes.map((storeType) => (
            <option key={storeType.id} value={String(storeType.id)}>
              {storeType.name}
            </option>
          ))}
        </select>
        {errors.store_type_id !== undefined && (
          <p id="store-type-error" className="mt-1 text-xs text-red-600">
            {errors.store_type_id}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="store-address" className="block text-sm font-medium text-gray-700">
          Dirección
        </label>
        <input
          id="store-address"
          type="text"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.address}
          onChange={(event) => onChange({ ...values, address: event.target.value })}
        />
      </div>
      <div>
        <label htmlFor="store-city" className="block text-sm font-medium text-gray-700">
          Ciudad
        </label>
        <input
          id="store-city"
          type="text"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.city}
          onChange={(event) => onChange({ ...values, city: event.target.value })}
        />
      </div>
      <div>
        <label htmlFor="store-phone" className="block text-sm font-medium text-gray-700">
          Teléfono
        </label>
        <input
          id="store-phone"
          type="text"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.phone}
          onChange={(event) => onChange({ ...values, phone: event.target.value })}
        />
      </div>
      <div>
        <label htmlFor="store-lat" className="block text-sm font-medium text-gray-700">
          Latitud (-90 a 90)
        </label>
        <input
          id="store-lat"
          type="number"
          step="any"
          min={-90}
          max={90}
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.lat}
          placeholder="ej. 4.6097"
          aria-invalid={errors.lat !== undefined}
          aria-describedby={errors.lat === undefined ? undefined : "store-lat-error"}
          onChange={(event) => onChange({ ...values, lat: event.target.value })}
        />
        {errors.lat !== undefined && (
          <p id="store-lat-error" className="mt-1 text-xs text-red-600">
            {errors.lat}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="store-lng" className="block text-sm font-medium text-gray-700">
          Longitud (-180 a 180)
        </label>
        <input
          id="store-lng"
          type="number"
          step="any"
          min={-180}
          max={180}
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.lng}
          placeholder="ej. -74.0631"
          aria-invalid={errors.lng !== undefined}
          aria-describedby={errors.lng === undefined ? undefined : "store-lng-error"}
          onChange={(event) => onChange({ ...values, lng: event.target.value })}
        />
        {errors.lng !== undefined && (
          <p id="store-lng-error" className="mt-1 text-xs text-red-600">
            {errors.lng}
          </p>
        )}
      </div>
      {!readOnly && (
        <div className="flex items-center gap-3">
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
              Eliminar tienda
            </button>
          )}
        </div>
      )}
    </form>
  );
}
