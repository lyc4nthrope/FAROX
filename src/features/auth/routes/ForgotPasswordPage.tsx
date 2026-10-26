import { useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { mapError } from "../../../shared/lib/errors/mapError";
import { requestPasswordReset } from "../api";
import {
  ForgotPasswordForm,
  type ForgotPasswordFormErrors,
} from "../components/ForgotPasswordForm";
import { forgotPasswordSchema, type ForgotPasswordInput } from "../schemas";

const EMPTY_VALUES: ForgotPasswordInput = { email: "" };

// El éxito de resetPasswordForEmail es SIEMPRE genérico: Supabase responde
// igual exista o no la cuenta, así que la UI no debe confirmar el email.
// Rate limit es el caso accionable más común (reenvíos seguidos).
function forgotPasswordErrorMessage(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("security purposes") ||
    lower.includes("rate limit") ||
    lower.includes("too many")
  ) {
    return "Pediste varios emails seguidos. Esperá unos minutos y volvé a intentar.";
  }
  return mapError({ message });
}

type ForgotPhase = "idle" | "submitting" | "sent";

export function ForgotPasswordPage() {
  const { status } = useAuth();
  const [values, setValues] = useState<ForgotPasswordInput>(EMPTY_VALUES);
  const [errors, setErrors] = useState<ForgotPasswordFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ForgotPhase>("idle");

  function handleSubmit(): void {
    const parsed = forgotPasswordSchema.safeParse(values);
    if (!parsed.success) {
      const issues = parsed.error.flatten();
      setErrors({ email: issues.fieldErrors.email?.[0] });
      setFormError(null);
      return; // validación antes de cualquier request
    }
    setErrors({});
    setFormError(null);
    setPhase("submitting");
    void (async () => {
      try {
        const { error } = await requestPasswordReset(parsed.data.email);
        if (error !== null) {
          setFormError(forgotPasswordErrorMessage(error.message));
          setPhase("idle");
          return;
        }
        setPhase("sent");
      } catch {
        setFormError("No se pudo conectar, revisá tu conexión.");
        setPhase("idle");
      }
    })();
  }

  // Un usuario ya autenticado no necesita recuperar la contraseña desde acá.
  if (status === "authenticated") {
    return <Navigate to="/inicio" replace />;
  }

  if (phase === "sent") {
    return (
      <div className="mx-auto max-w-sm px-4 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Revisá tu email</h1>
        <p role="status" className="mt-1 text-sm text-gray-600">
          Si el email está registrado, te enviamos un link para restablecer tu contraseña.
          Revisá tu bandeja de entrada y la carpeta de spam.
        </p>
        <p className="mt-4 text-sm text-gray-600">
          <Link to="/login" className="font-medium text-gray-900 underline">
            Volver al login
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Recuperar contraseña</h1>
      <p className="mt-1 text-sm text-gray-600">
        Escribí el email de tu cuenta y te enviamos un link para elegir una nueva
        contraseña.
      </p>
      <div className="mt-6">
        <ForgotPasswordForm
          values={values}
          errors={errors}
          formError={formError}
          pending={phase === "submitting"}
          onChange={setValues}
          onSubmit={handleSubmit}
        />
      </div>
      <p className="mt-4 text-sm text-gray-600">
        <Link to="/login" className="font-medium text-gray-900 underline">
          Volver al login
        </Link>
      </p>
    </div>
  );
}
