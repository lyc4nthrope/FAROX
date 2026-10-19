import type { DistributorFormValues } from "../schemas";
import { CONTACT_PREFERENCES, type ContactPreference } from "../types";

export interface DistributorFormErrors {
  name?: string;
  nit?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  contact_preference?: string;
}

export interface DistributorFormProps {
  values: DistributorFormValues;
  errors: DistributorFormErrors;
  // Mapeado por mapError() en el call site del contenedor (HARD-1).
  formError: string | null;
  saving: boolean;
  // operador en /distributors/:id: datos visibles, cero controles de escritura
  // (SEC-01 idea:119 "solo lectura"; ocultar es UX — idea:134).
  readOnly: boolean;
  // admin en modo edición (el borrado en dos pasos vive en el contenedor).
  canDelete: boolean;
  submitLabel: string;
  onChange: (next: DistributorFormValues) => void;
  onSubmit: () => void;
  onDelete: () => void;
}

const PREFERENCE_LABELS: Record<ContactPreference, string> = {
  whatsapp: "WhatsApp",
  phone: "Teléfono",
  email: "Email",
};

// Presentacional pura (D1): formulario de distribuidor para alta y edición.
// La validación Zod corre en el contenedor ANTES de cualquier request
// (idea:198) — acá solo se pintan los errores por campo.
export function DistributorForm({
  values,
  errors,
  formError,
  saving,
  readOnly,
  canDelete,
  submitLabel,
  onChange,
  onSubmit,
  onDelete,
}: DistributorFormProps) {
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
          Vista de solo lectura: solo un administrador puede editar distribuidores.
        </p>
      )}
      <div>
        <label htmlFor="distributor-name" className="block text-sm font-medium text-gray-700">
          Nombre
        </label>
        <input
          id="distributor-name"
          type="text"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.name}
          aria-invalid={errors.name !== undefined}
          aria-describedby={errors.name === undefined ? undefined : "distributor-name-error"}
          onChange={(event) => onChange({ ...values, name: event.target.value })}
        />
        {errors.name !== undefined && (
          <p id="distributor-name-error" className="mt-1 text-xs text-red-600">
            {errors.name}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="distributor-nit" className="block text-sm font-medium text-gray-700">
          NIT
        </label>
        <input
          id="distributor-nit"
          type="text"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.nit}
          aria-invalid={errors.nit !== undefined}
          aria-describedby={errors.nit === undefined ? undefined : "distributor-nit-error"}
          onChange={(event) => onChange({ ...values, nit: event.target.value })}
        />
        {errors.nit !== undefined && (
          <p id="distributor-nit-error" className="mt-1 text-xs text-red-600">
            {errors.nit}
          </p>
        )}
      </div>
      <div>
        <label
          htmlFor="distributor-contact-name"
          className="block text-sm font-medium text-gray-700"
        >
          Nombre de contacto
        </label>
        <input
          id="distributor-contact-name"
          type="text"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.contact_name}
          onChange={(event) => onChange({ ...values, contact_name: event.target.value })}
        />
      </div>
      <div>
        <label htmlFor="distributor-phone" className="block text-sm font-medium text-gray-700">
          Teléfono
        </label>
        <input
          id="distributor-phone"
          type="tel"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.phone}
          onChange={(event) => onChange({ ...values, phone: event.target.value })}
        />
      </div>
      <div>
        <label htmlFor="distributor-email" className="block text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="distributor-email"
          type="email"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.email}
          aria-invalid={errors.email !== undefined}
          aria-describedby={errors.email === undefined ? undefined : "distributor-email-error"}
          onChange={(event) => onChange({ ...values, email: event.target.value })}
        />
        {errors.email !== undefined && (
          <p id="distributor-email-error" className="mt-1 text-xs text-red-600">
            {errors.email}
          </p>
        )}
      </div>
      <div>
        <label
          htmlFor="distributor-preference"
          className="block text-sm font-medium text-gray-700"
        >
          Preferencia de contacto
        </label>
        <select
          id="distributor-preference"
          disabled={readOnly}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={values.contact_preference}
          onChange={(event) =>
            onChange({
              ...values,
              contact_preference: event.target.value as ContactPreference,
            })
          }
        >
          {CONTACT_PREFERENCES.map((preference) => (
            <option key={preference} value={preference}>
              {PREFERENCE_LABELS[preference]}
            </option>
          ))}
        </select>
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
              Eliminar distribuidor
            </button>
          )}
        </div>
      )}
    </form>
  );
}
