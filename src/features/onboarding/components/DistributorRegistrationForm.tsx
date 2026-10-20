import { ErrorBanner } from "../../../shared/ui";
import type { DistributorRegistrationValues } from "../schemas";
import { CONTACT_PREFERENCES, type ContactPreference } from "../types";

export interface DistributorFormErrors {
  name?: string;
  nit?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  contact_preference?: string;
}

export interface DistributorRegistrationFormProps {
  values: DistributorRegistrationValues;
  errors: DistributorFormErrors;
  // Mapeado por mapError() en el call site del contenedor (HARD-1).
  formError: string | null;
  saving: boolean;
  onChange: (next: DistributorRegistrationValues) => void;
  onSubmit: () => void;
  onBack: () => void;
}

const PREFERENCE_LABELS: Record<ContactPreference, string> = {
  whatsapp: "WhatsApp",
  phone: "Teléfono",
  email: "Email",
};

// Presentacional pura: form de la terminal [Distribuidor] — nombre + NIT
// obligatorios (0003:16 UNIQUE NOT NULL) y contacto opcional (0003:18-19).
// La validación Zod corre en el contenedor ANTES de cualquier request
// (idea:198) — acá solo se pintan errores inline, el banner y el estado de
// guardado.
export function DistributorRegistrationForm({
  values,
  errors,
  formError,
  saving,
  onChange,
  onSubmit,
  onBack,
}: DistributorRegistrationFormProps) {
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
        <label
          htmlFor="onboarding-distributor-name"
          className="block text-sm font-medium text-gray-700"
        >
          Nombre
        </label>
        <input
          id="onboarding-distributor-name"
          type="text"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.name}
          aria-invalid={errors.name !== undefined}
          aria-describedby={
            errors.name === undefined ? undefined : "onboarding-distributor-name-error"
          }
          onChange={(event) => onChange({ ...values, name: event.target.value })}
        />
        {errors.name !== undefined && (
          <p id="onboarding-distributor-name-error" className="mt-1 text-xs text-red-600">
            {errors.name}
          </p>
        )}
      </div>
      <div>
        <label
          htmlFor="onboarding-distributor-nit"
          className="block text-sm font-medium text-gray-700"
        >
          NIT
        </label>
        <input
          id="onboarding-distributor-nit"
          type="text"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.nit}
          aria-invalid={errors.nit !== undefined}
          aria-describedby={
            errors.nit === undefined ? undefined : "onboarding-distributor-nit-error"
          }
          onChange={(event) => onChange({ ...values, nit: event.target.value })}
        />
        {errors.nit !== undefined && (
          <p id="onboarding-distributor-nit-error" className="mt-1 text-xs text-red-600">
            {errors.nit}
          </p>
        )}
      </div>
      <div>
        <label
          htmlFor="onboarding-distributor-contact-name"
          className="block text-sm font-medium text-gray-700"
        >
          Nombre de contacto (opcional)
        </label>
        <input
          id="onboarding-distributor-contact-name"
          type="text"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.contact_name}
          onChange={(event) => onChange({ ...values, contact_name: event.target.value })}
        />
      </div>
      <div>
        <label
          htmlFor="onboarding-distributor-phone"
          className="block text-sm font-medium text-gray-700"
        >
          Teléfono (opcional)
        </label>
        <input
          id="onboarding-distributor-phone"
          type="tel"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.phone}
          onChange={(event) => onChange({ ...values, phone: event.target.value })}
        />
      </div>
      <div>
        <label
          htmlFor="onboarding-distributor-email"
          className="block text-sm font-medium text-gray-700"
        >
          Email (opcional)
        </label>
        <input
          id="onboarding-distributor-email"
          type="email"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.email}
          aria-invalid={errors.email !== undefined}
          aria-describedby={
            errors.email === undefined ? undefined : "onboarding-distributor-email-error"
          }
          onChange={(event) => onChange({ ...values, email: event.target.value })}
        />
        {errors.email !== undefined && (
          <p id="onboarding-distributor-email-error" className="mt-1 text-xs text-red-600">
            {errors.email}
          </p>
        )}
      </div>
      <div>
        <label
          htmlFor="onboarding-distributor-preference"
          className="block text-sm font-medium text-gray-700"
        >
          Preferencia de contacto
        </label>
        <select
          id="onboarding-distributor-preference"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
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
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? "Registrando…" : "Registrarme como distribuidor"}
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
