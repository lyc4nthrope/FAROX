import type { ProfileFormValues } from "../schemas";
import { CONTACT_PREFERENCES, type ContactPreference } from "../types";
import { buttonClass, inputClass } from "../../../shared/ui/Box";

export interface ProfileFormErrors {
  full_name?: string;
  phone_number?: string;
  contact_preference?: string;
}

interface ProfileFormProps {
  values: ProfileFormValues;
  errors: ProfileFormErrors;
  formError: string | null;
  notice: string | null;
  saving: boolean;
  onChange: (next: ProfileFormValues) => void;
  onSubmit: () => void;
}

const PREFERENCE_LABELS: Record<ContactPreference, string> = {
  whatsapp: "WhatsApp",
  phone: "Teléfono",
  email: "Email",
};

// Presentacional pura (D1): solo las 3 columnas de perfil existen en este
// formulario — ninguna otra columna de users se envía jamás (0006:368-369).
export function ProfileForm({
  values,
  errors,
  formError,
  notice,
  saving,
  onChange,
  onSubmit,
}: ProfileFormProps) {
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
          className="rounded-xl border border-red-200 border-l-4 border-l-red-500 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {formError}
        </p>
      )}
      {notice !== null && (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 border-l-4 border-l-emerald-500 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}
      <div>
        <label
          htmlFor="profile-full-name"
          className="block text-xs font-semibold tracking-wide text-gray-600"
        >
          Nombre completo
        </label>
        <input
          id="profile-full-name"
          type="text"
          autoComplete="name"
          className={`${inputClass} mt-1 w-full`}
          value={values.full_name}
          aria-invalid={errors.full_name !== undefined}
          aria-describedby={errors.full_name === undefined ? undefined : "profile-full-name-error"}
          onChange={(event) => onChange({ ...values, full_name: event.target.value })}
        />
        {errors.full_name !== undefined && (
          <p id="profile-full-name-error" className="mt-1 text-xs text-red-600">
            {errors.full_name}
          </p>
        )}
      </div>
      <div>
        <label
          htmlFor="profile-phone"
          className="block text-xs font-semibold tracking-wide text-gray-600"
        >
          Teléfono
        </label>
        <input
          id="profile-phone"
          type="tel"
          autoComplete="tel"
          className={`${inputClass} mt-1 w-full`}
          value={values.phone_number}
          aria-invalid={errors.phone_number !== undefined}
          aria-describedby={errors.phone_number === undefined ? undefined : "profile-phone-error"}
          onChange={(event) => onChange({ ...values, phone_number: event.target.value })}
        />
        {errors.phone_number !== undefined && (
          <p id="profile-phone-error" className="mt-1 text-xs text-red-600">
            {errors.phone_number}
          </p>
        )}
      </div>
      <div>
        <label
          htmlFor="profile-preference"
          className="block text-xs font-semibold tracking-wide text-gray-600"
        >
          Preferencia de contacto
        </label>
        <select
          id="profile-preference"
          className={`${inputClass} mt-1 w-full`}
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
      <button type="submit" disabled={saving} className={buttonClass}>
        {saving ? "Guardando…" : "Guardar cambios"}
      </button>
    </form>
  );
}
