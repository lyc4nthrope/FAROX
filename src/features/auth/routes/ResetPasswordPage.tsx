import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { mapError } from "../../../shared/lib/errors/mapError";
import { establishRecoverySession, updatePassword } from "../api";
import { ResetPasswordForm, type ResetPasswordFormErrors } from "../components/ResetPasswordForm";
import { resetPasswordSchema, type ResetPasswordInput } from "../schemas";

const EMPTY_VALUES: ResetPasswordInput = { password: "", confirm_password: "" };

// Errores propios del cambio + taxonomía central: el texto crudo del backend
// jamás llega al DOM. La sesión de recuperación es de un solo uso: si expiró,
// la salida es pedir otro link.
function resetPasswordErrorMessage(message: string): string {
  const lower = message.toLowerCase();
  // `same_password` de GoTrue también contiene "password should": debe ir antes
  // que la rama de contraseña débil o el usuario recibe el mensaje equivocado.
  if (lower.includes("same_password") || lower.includes("different from the old")) {
    return "La nueva contraseña debe ser distinta de la anterior.";
  }
  if (
    lower.includes("weak_password") ||
    lower.includes("password should") ||
    lower.includes("too weak") ||
    lower.includes("password is weak")
  ) {
    return "La contraseña no cumple los requisitos mínimos de seguridad.";
  }
  if (
    lower.includes("session") &&
    (lower.includes("missing") || lower.includes("not found") || lower.includes("expired"))
  ) {
    return "Tu sesión de recuperación expiró. Pedí un link nuevo.";
  }
  return mapError({ message });
}

// El link de recuperación deja un `code` (PKCE) o tokens en el hash (implícito).
// Una vez establecida la sesión se limpian para que un refresh no reintente un
// código de un solo uso.
function stripRecoveryParams(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  if (url.hash.includes("access_token") || url.hash.includes("type=recovery")) {
    url.hash = "";
  }
  window.history.replaceState(window.history.state, "", url.toString());
}

type ResetPhase = "checking" | "ready" | "invalid" | "submitting" | "done";

export function ResetPasswordPage() {
  const [phase, setPhase] = useState<ResetPhase>("checking");
  const [values, setValues] = useState<ResetPasswordInput>(EMPTY_VALUES);
  const [errors, setErrors] = useState<ResetPasswordFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const outcome = await establishRecoverySession();
        if (cancelled) return;
        if (outcome.status !== "ready") {
          setPhase("invalid");
          return;
        }
        stripRecoveryParams();
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSubmit(): void {
    const parsed = resetPasswordSchema.safeParse(values);
    if (!parsed.success) {
      const issues = parsed.error.flatten();
      setErrors({
        password: issues.fieldErrors.password?.[0],
        confirm_password: issues.fieldErrors.confirm_password?.[0],
      });
      setFormError(null);
      return; // validación antes de cualquier request
    }
    setErrors({});
    setFormError(null);
    setPhase("submitting");
    void (async () => {
      try {
        const { error } = await updatePassword(parsed.data.password);
        if (error !== null) {
          setFormError(resetPasswordErrorMessage(error.message));
          setPhase("ready");
          return;
        }
        setPhase("done");
      } catch {
        setFormError("No se pudo conectar, revisá tu conexión.");
        setPhase("ready");
      }
    })();
  }

  if (phase === "checking") {
    return (
      <div className="mx-auto max-w-sm px-4 py-12">
        <h1 className="text-xl font-semibold">Verificando el link…</h1>
        <p role="status" className="mt-1 text-sm text-gray-600">
          Un momento mientras validamos tu link de recuperación.
        </p>
      </div>
    );
  }

  if (phase === "invalid") {
    return (
      <div className="mx-auto max-w-sm px-4 py-12">
        <h1 className="text-xl font-semibold">El link no es válido</h1>
        <p className="mt-1 text-sm text-gray-600">
          Puede haber expirado o ya haber sido usado. Pedí un link nuevo para elegir tu
          contraseña.
        </p>
        <p className="mt-4 text-sm text-gray-600">
          <Link to="/recuperar" className="font-medium text-gray-900 underline">
            Pedir un link nuevo
          </Link>
        </p>
        <p className="mt-2 text-sm text-gray-600">
          <Link to="/login" className="font-medium text-gray-900 underline">
            Volver al login
          </Link>
        </p>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="mx-auto max-w-sm px-4 py-12">
        <h1 className="text-xl font-semibold">Contraseña actualizada</h1>
        <p role="status" className="mt-1 text-sm text-gray-600">
          Ya podés usar FAROX con tu nueva contraseña.
        </p>
        <p className="mt-4 text-sm text-gray-600">
          <Link to="/inicio" className="font-medium text-gray-900 underline">
            Ir al inicio
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-xl font-semibold">Elegí una nueva contraseña</h1>
      <p className="mt-1 text-sm text-gray-600">
        Mínimo 6 caracteres. Después vas a poder iniciar sesión con la contraseña nueva.
      </p>
      <div className="mt-6">
        <ResetPasswordForm
          values={values}
          errors={errors}
          formError={formError}
          pending={phase === "submitting"}
          onChange={setValues}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
