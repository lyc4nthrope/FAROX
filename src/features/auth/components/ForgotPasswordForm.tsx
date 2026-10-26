import type { ForgotPasswordInput } from "../schemas";

export interface ForgotPasswordFormErrors {
  email?: string;
}

interface ForgotPasswordFormProps {
  values: ForgotPasswordInput;
  errors: ForgotPasswordFormErrors;
  formError: string | null;
  pending: boolean;
  onChange: (next: ForgotPasswordInput) => void;
  onSubmit: () => void;
}

// Presentacional pura: el contenedor valida con zod y llama a la api; acá solo
// se emiten errores inline y el estado pendiente.
export function ForgotPasswordForm({
  values,
  errors,
  formError,
  pending,
  onChange,
  onSubmit,
}: ForgotPasswordFormProps) {
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
      <div>
        <label htmlFor="forgot-email" className="block text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="forgot-email"
          type="email"
          autoComplete="email"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.email}
          aria-invalid={errors.email !== undefined}
          aria-describedby={errors.email === undefined ? undefined : "forgot-email-error"}
          onChange={(event) => onChange({ email: event.target.value })}
        />
        {errors.email !== undefined && (
          <p id="forgot-email-error" className="mt-1 text-xs text-red-600">
            {errors.email}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? "Enviando…" : "Enviar link"}
      </button>
    </form>
  );
}
