import type { LoginInput } from "../schemas";

export interface LoginFormErrors {
  email?: string;
  password?: string;
}

interface LoginFormProps {
  values: LoginInput;
  errors: LoginFormErrors;
  formError: string | null;
  pending: boolean;
  onChange: (next: LoginInput) => void;
  onSubmit: () => void;
}

// Presentacional pura (D1): el contenedor (routes/LoginPage) valida con zod y
// llama a la api; aquí solo se emiten los errores inline y el estado pendiente.
export function LoginForm({
  values,
  errors,
  formError,
  pending,
  onChange,
  onSubmit,
}: LoginFormProps) {
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
        <label htmlFor="login-email" className="block text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.email}
          aria-invalid={errors.email !== undefined}
          aria-describedby={errors.email === undefined ? undefined : "login-email-error"}
          onChange={(event) => onChange({ ...values, email: event.target.value })}
        />
        {errors.email !== undefined && (
          <p id="login-email-error" className="mt-1 text-xs text-red-600">
            {errors.email}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="login-password" className="block text-sm font-medium text-gray-700">
          Contraseña
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.password}
          aria-invalid={errors.password !== undefined}
          aria-describedby={errors.password === undefined ? undefined : "login-password-error"}
          onChange={(event) => onChange({ ...values, password: event.target.value })}
        />
        {errors.password !== undefined && (
          <p id="login-password-error" className="mt-1 text-xs text-red-600">
            {errors.password}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
