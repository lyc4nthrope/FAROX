import { PasswordInput } from "../../../shared/ui";
import type { ResetPasswordInput } from "../schemas";

export interface ResetPasswordFormErrors {
  password?: string;
  confirm_password?: string;
}

interface ResetPasswordFormProps {
  values: ResetPasswordInput;
  errors: ResetPasswordFormErrors;
  formError: string | null;
  pending: boolean;
  onChange: (next: ResetPasswordInput) => void;
  onSubmit: () => void;
}

// Presentacional pura: el parse de zod ocurre en el contenedor; este form solo
// pinta los dos campos de contraseña y el estado pendiente.
export function ResetPasswordForm({
  values,
  errors,
  formError,
  pending,
  onChange,
  onSubmit,
}: ResetPasswordFormProps) {
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
      <PasswordInput
        id="reset-password"
        label="Nueva contraseña"
        autoComplete="new-password"
        value={values.password}
        onChange={(password) => onChange({ ...values, password })}
        revealName="nueva contraseña"
        error={errors.password}
      />
      <PasswordInput
        id="reset-confirm"
        label="Repetir contraseña"
        autoComplete="new-password"
        value={values.confirm_password}
        onChange={(confirm_password) => onChange({ ...values, confirm_password })}
        revealName="repetir contraseña"
        error={errors.confirm_password}
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? "Guardando…" : "Guardar contraseña"}
      </button>
    </form>
  );
}
