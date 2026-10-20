import { ErrorBanner } from "../../../shared/ui";
import { MapLocationField } from "../../../shared/ui/LocationPicker/MapLocationField";
import type { MyStoreValues } from "../schemas";
import type { StoreTypeOption } from "../types";

export interface MyStoreFormErrors {
  name?: string;
  store_type_id?: string;
  lat?: string;
  lng?: string;
}

export interface MyStoreSetupFormProps {
  values: MyStoreValues;
  errors: MyStoreFormErrors;
  // Mapeado por mapError() en el call site del contenedor (HARD-1).
  formError: string | null;
  saving: boolean;
  storeTypes: StoreTypeOption[];
  onChange: (next: MyStoreValues) => void;
  // El MAPA es el input de coordenadas (supersede del D3 de #486): el
  // contenedor recibe la mutación del pin y agenda el reverse geocode
  // (best-effort → values.address → p_address).
  onLocationChange: (next: { latitude: number; longitude: number }) => void;
  onSubmit: () => void;
  onBack: () => void;
}

// Presentacional pura: form MÍNIMO de la terminal [Mi tienda] — nombre, tipo
// (catálogo) y ubicación OBLIGATORIAS (stores.location NOT NULL, 0002:131).
// Sin city/phone (alta mínima del onboarding; la capa api los envía NULL) y
// SIN duplicar la página CRUD de B7 (/stores/new). La ubicación se elige en
// un mapa (MapLocationField, lazy + escape hatch numérico si el chunk no
// carga); la validación Zod corre en el contenedor ANTES de cualquier request
// (idea:198) — sin pin, lat/lng quedan "" y el submit se bloquea.
export function MyStoreSetupForm({
  values,
  errors,
  formError,
  saving,
  storeTypes,
  onChange,
  onLocationChange,
  onSubmit,
  onBack,
}: MyStoreSetupFormProps) {
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {formError !== null && <ErrorBanner message={formError} />}
      <div>
        <label htmlFor="onboarding-store-name" className="block text-sm font-medium text-gray-700">
          Nombre
        </label>
        <input
          id="onboarding-store-name"
          type="text"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.name}
          aria-invalid={errors.name !== undefined}
          aria-describedby={errors.name === undefined ? undefined : "onboarding-store-name-error"}
          onChange={(event) => onChange({ ...values, name: event.target.value })}
        />
        {errors.name !== undefined && (
          <p id="onboarding-store-name-error" className="mt-1 text-xs text-red-600">
            {errors.name}
          </p>
        )}
      </div>
      <div>
        <label
          htmlFor="onboarding-store-type"
          className="block text-sm font-medium text-gray-700"
        >
          Tipo de tienda
        </label>
        <select
          id="onboarding-store-type"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.store_type_id}
          aria-invalid={errors.store_type_id !== undefined}
          aria-describedby={
            errors.store_type_id === undefined ? undefined : "onboarding-store-type-error"
          }
          onChange={(event) => onChange({ ...values, store_type_id: event.target.value })}
        >
          <option value="">Seleccioná un tipo</option>
          {storeTypes.map((storeType) => (
            <option key={storeType.id} value={String(storeType.id)}>
              {storeType.name}
            </option>
          ))}
        </select>
        {errors.store_type_id !== undefined && (
          <p id="onboarding-store-type-error" className="mt-1 text-xs text-red-600">
            {errors.store_type_id}
          </p>
        )}
      </div>
      <div>
        <MapLocationField
          latitude={values.lat}
          longitude={values.lng}
          address={values.address}
          latitudeError={errors.lat}
          longitudeError={errors.lng}
          onLocationChange={onLocationChange}
          onCoordinateTextChange={(next) => onChange({ ...values, lat: next.latitude, lng: next.longitude })}
          label="Ubicación de la tienda"
          idPrefix="onboarding-store"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? "Creando…" : "Crear mi tienda"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onBack}
          className="text-sm text-gray-600 hover:underline disabled:opacity-50"
        >
          Volver
        </button>
      </div>
    </form>
  );
}
