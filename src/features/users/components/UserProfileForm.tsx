import type { UserProfileFormValues } from "../schemas";
import { CONTACT_PREFERENCES, type ContactPreference } from "../../profile/types";

export interface ProfileFormErrors {
  full_name?: string;
  phone_number?: string;
  contact_preference?: string;
}

interface UserProfileFormProps {
  values: UserProfileFormValues;
  errors: ProfileFormErrors;
  formError: string | null;
  notice: string | null;
  saving: boolean;
  onChange: (next: UserProfileFormValues) => void;
  onSubmit: () => void;
}

const PREFERENCE_LABELS: Record<ContactPreference, string> = {
  whatsapp: "WhatsApp",
  phone: "Teléfono",
  email: "Email",
};

// Presentacional pura (D1) · sdd/admin-console T-B5 (ADM-4): SOLO las 3
// columnas de perfil existen en este formulario — ninguna otra columna de
// users se envía jamás (GRANT por columna 0006:368-369, D45). La validación
// Zod vive en el contenedor y corre ANTES de cualquier request.
export function UserProfileForm({
  values,
  errors,
  formError,
  notice,
  saving,
  onChange,
  onSubmit,
}: UserProfileFormProps) {
  return (
    <form
      noValidate
      className="mt-3 space-y-4"
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
      {notice !== null && (
        <p
          role="status"
          className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          {notice}
        </p>
      )}
      <div>
        <label
          htmlFor="user-profile-full-name"
          className="block text-sm font-medium text-gray-700"
        >
          Nombre completo
        </label>
        <input
          id="user-profile-full-name"
          type="text"
          autoComplete="name"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.full_name}
          aria-invalid={errors.full_name !== undefined}
          aria-describedby={
            errors.full_name === undefined ? undefined : "user-profile-full-name-error"
          }
          onChange={(event) => onChange({ ...values, full_name: event.target.value })}
        />
        {errors.full_name !== undefined && (
          <p id="user-profile-full-name-error" className="mt-1 text-xs text-red-600">
            {errors.full_name}
          </p>
        )}
      </div>
      <div>
        <label
          htmlFor="user-profile-phone"
          className="block text-sm font-medium text-gray-700"
        >
          Teléfono
        </label>
        <input
          id="user-profile-phone"
          type="tel"
          autoComplete="tel"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.phone_number}
          aria-invalid={errors.phone_number !== undefined}
          aria-describedby={
            errors.phone_number === undefined ? undefined : "user-profile-phone-error"
          }
          onChange={(event) => onChange({ ...values, phone_number: event.target.value })}
        />
        {errors.phone_number !== undefined && (
          <p id="user-profile-phone-error" className="mt-1 text-xs text-red-600">
            {errors.phone_number}
          </p>
        )}
      </div>
      <div>
        <label
          htmlFor="user-profile-preference"
          className="block text-sm font-medium text-gray-700"
        >
          Preferencia de contacto
        </label>
        <select
          id="user-profile-preference"
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
        {errors.contact_preference !== undefined && (
          <p id="user-profile-preference-error" className="mt-1 text-xs text-red-600">
            {errors.contact_preference}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={saving}
        className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {saving ? "Guardando…" : "Guardar cambios"}
      </button>
    </form>
  );
}
