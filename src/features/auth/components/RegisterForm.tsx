import { Link } from "react-router-dom";

import { ErrorBanner } from "../../../shared/ui";
import type { RegisterFormValues } from "../schemas";

export interface RegisterFormErrors {
  full_name?: string;
  email?: string;
  password?: string;
  privacy_policy_accepted?: string;
}

interface RegisterFormProps {
  values: RegisterFormValues;
  errors: RegisterFormErrors;
  formError: string | null;
  pending: boolean;
  onChange: (next: RegisterFormValues) => void;
  onSubmit: () => void;
}

// Presentacional pura (D1, mismo molde que LoginForm): el contenedor
// (routes/RegisterPage) valida con zod y llama a la api; aquí solo se emiten
// los errores inline, el banner (mapError en el call site, HARD-1) y el
// estado pendiente del submit.
export function RegisterForm({
  values,
  errors,
  formError,
  pending,
  onChange,
  onSubmit,
}: RegisterFormProps) {
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
          htmlFor="register-full-name"
          className="block text-sm font-medium text-gray-700"
        >
          Nombre completo
        </label>
        <input
          id="register-full-name"
          type="text"
          autoComplete="name"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.full_name}
          aria-invalid={errors.full_name !== undefined}
          aria-describedby={
            errors.full_name === undefined ? undefined : "register-full-name-error"
          }
          onChange={(event) => onChange({ ...values, full_name: event.target.value })}
        />
        {errors.full_name !== undefined && (
          <p id="register-full-name-error" className="mt-1 text-xs text-red-600">
            {errors.full_name}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="register-email" className="block text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="register-email"
          type="email"
          autoComplete="email"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.email}
          aria-invalid={errors.email !== undefined}
          aria-describedby={errors.email === undefined ? undefined : "register-email-error"}
          onChange={(event) => onChange({ ...values, email: event.target.value })}
        />
        {errors.email !== undefined && (
          <p id="register-email-error" className="mt-1 text-xs text-red-600">
            {errors.email}
          </p>
        )}
      </div>
      <div>
        <label
          htmlFor="register-password"
          className="block text-sm font-medium text-gray-700"
        >
          Contraseña
        </label>
        <input
          id="register-password"
          type="password"
          autoComplete="new-password"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.password}
          aria-invalid={errors.password !== undefined}
          aria-describedby={
            errors.password === undefined ? undefined : "register-password-error"
          }
          onChange={(event) => onChange({ ...values, password: event.target.value })}
        />
        {errors.password !== undefined && (
          <p id="register-password-error" className="mt-1 text-xs text-red-600">
            {errors.password}
          </p>
        )}
      </div>
      <div>
        {/* Consentimiento de privacidad OBLIGATORIO (Ley 1581 de 2012):
            checked controlado desde values (desmarcado por defecto) y validado
            como literal true en schemas.ts ⇒ sin marcar, CERO requests. El
            label queda asociado vía htmlFor; el Link es contenido INTERACTIVO
            del label, y la spec de HTML le da activation behavior propio: la
            pestaña nueva se abre sin togglear el checkbox, y además es una
            parada de tabulación independiente del input. */}
        <div className="flex items-start gap-2">
          <input
            id="register-privacy"
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300"
            checked={values.privacy_policy_accepted}
            aria-invalid={errors.privacy_policy_accepted !== undefined}
            aria-describedby={
              errors.privacy_policy_accepted === undefined
                ? undefined
                : "register-privacy-error"
            }
            onChange={(event) =>
              onChange({ ...values, privacy_policy_accepted: event.target.checked })
            }
          />
          <label htmlFor="register-privacy" className="text-sm text-gray-700">
            Acepto la{" "}
            <Link
              to="/privacidad"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-gray-900 underline"
            >
              Política de Privacidad
            </Link>{" "}
            y el tratamiento de mis datos
          </label>
        </div>
        {errors.privacy_policy_accepted !== undefined && (
          <p id="register-privacy-error" className="mt-1 text-xs text-red-600">
            {errors.privacy_policy_accepted}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? "Creando cuenta…" : "Crear cuenta"}
      </button>
    </form>
  );
}
