import { MapLocationField } from "../../../shared/ui/LocationPicker/MapLocationField";
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
  // El MAPA es el input de coordenadas (supersede del D3 de #486): el
  // contenedor recibe la mutación del pin, setea lat/lng y agenda el reverse
  // geocode que puede completar Dirección (best-effort).
  onLocationChange: (next: { latitude: number; longitude: number }) => void;
  onSubmit: () => void;
  onDelete: () => void;
}

// Presentacional pura (D1): formulario de tienda para alta y edición (§S2 fila
// Store form · STORE-1/STORE-3). El tipo se pinta como <select> poblado desde
// el catálogo store_types sembrado (0006:76-77); la validación Zod corre en el
// contenedor ANTES de cualquier request (idea:198 / STORE-1) — acá solo se
// pintan los errores por campo.
//
// COORDENADAS (supersede del trap #2 de B7 · D3 de #486): el input principal
// es un MAPA (MapLocationField, lazy sobre Leaflet con escape hatch numérico
// si el chunk no carga). El orden EWKT (lng-first) lo garantiza geo.ts en el
// armado del request — acá solo se emiten coordenadas con campos NOMINADOS y
// el contenedor nunca las reordena. El campo Dirección sigue siendo editable
// a mano y puede ser completado por el reverse geocode del pin (solo si
// estaba vacío: jamás pisa lo que el usuario escribió).
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
  onLocationChange,
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
        <MapLocationField
          latitude={values.lat}
          longitude={values.lng}
          address={values.address}
          latitudeError={errors.lat}
          longitudeError={errors.lng}
          onLocationChange={onLocationChange}
          onCoordinateTextChange={(next) =>
            onChange({ ...values, lat: next.latitude, lng: next.longitude })
          }
          disabled={readOnly}
          label="Ubicación de la tienda"
          idPrefix="store"
        />
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
              Desactivar tienda
            </button>
          )}
        </div>
      )}
    </form>
  );
}
