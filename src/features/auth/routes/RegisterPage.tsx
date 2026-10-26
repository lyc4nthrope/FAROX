import { useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { ErrorBanner } from "../../../shared/ui";
import { mapError } from "../../../shared/lib/errors/mapError";
import { PRIVACY_VERSION } from "../../../shared/lib/legal/privacyVersion";
import { resendConfirmationEmail, signUp } from "../api";
import { RegisterForm, type RegisterFormErrors } from "../components/RegisterForm";
import { registerSchema, type RegisterFormValues } from "../schemas";

// La casilla de privacidad arranca SIN marcar: el consentimiento debe ser
// explícito (unchecked por defecto, requisito de accesibilidad y de la ley).
const EMPTY_VALUES: RegisterFormValues = {
  full_name: "",
  email: "",
  password: "",
  confirm_password: "",
  privacy_policy_accepted: false,
};

// Máquina de estados del registro (D1): idle → submitting → confirmation-
// pending (flujo primario, D44: la confirmación de email está activa); un
// fallo de red cae a "error" y el formulario sigue usable con el banner.
type RegisterPhase = "idle" | "submitting" | "confirmation-pending" | "error";

type ResendState = { status: "idle" | "sending" | "sent" | "error"; message: string | null };

// Errores propios del registro + taxonomía central (mapError en el call site,
// convención B3/HARD-1): el texto crudo del backend jamás llega al DOM.
// · "User already registered" lo devuelve GoTrue SOLO con las confirmaciones
//   desactivadas (auth-js GoTrueClient.d.ts:295-297); con Confirm email ON
//   (D44) el server devuelve un usuario obfuscado SIN error — la
//   enumeración de emails ya la decide el server, no el cliente. Acá se
//   suaviza con wording condicional: no se afirma que la cuenta exista y se
//   ofrece la salida (iniciar sesión); tradeoff elegido: ACCIONABILIDAD por
//   sobre el anti-enumeración estricta, porque el server ya filtra ese dato.
function registerErrorMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("already registered") || lower.includes("user_already_exists")) {
    return "No se pudo crear la cuenta. Si ya tenés una, iniciá sesión con ese email.";
  }
  // GoTrue rechaza claves cortas con weak_password (server = autoridad; ver
  // schemas.ts registerSchema): mensaje propio en vez del fallback genérico.
  if (lower.includes("weak_password") || lower.includes("password should")) {
    return "La contraseña no cumple los requisitos mínimos de seguridad.";
  }
  return mapError({ message });
}

// Contenedor de /register (ruta PÚBLICA — sin RequireAuth: el registro pasa
// por supabase.auth.signUp, que no necesita sesión). ÉXITO primario ⇒
// confirmation-pending: el trigger on_auth_user_created (0004:397-400) ya
// creó la fila public.users al vuelo, pero el login recién funciona tras
// confirmar el email. Si la confirmación está desactivada (gate humano,
// D44) y llega sesión activa, se redirige al home — se manejan AMBAS ramas.
export function RegisterPage() {
  const { status } = useAuth();
  const [values, setValues] = useState<RegisterFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<RegisterFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<RegisterPhase>("idle");
  const [pendingEmail, setPendingEmail] = useState("");
  // signUp devolvió sesión activa (confirmación OFF): Navigate al home.
  const [granted, setGranted] = useState(false);
  const [resend, setResend] = useState<ResendState>({ status: "idle", message: null });

  function handleSubmit(): void {
    const parsed = registerSchema.safeParse(values);
    if (!parsed.success) {
      const issues = parsed.error.flatten();
      setErrors({
        full_name: issues.fieldErrors.full_name?.[0],
        email: issues.fieldErrors.email?.[0],
        password: issues.fieldErrors.password?.[0],
        confirm_password: issues.fieldErrors.confirm_password?.[0],
        privacy_policy_accepted: issues.fieldErrors.privacy_policy_accepted?.[0],
      });
      setFormError(null);
      setPhase("idle");
      return; // validación antes de cualquier request (V0-2 / idea:198)
    }
    setErrors({});
    setFormError(null);
    setPhase("submitting");
    // Consentimiento de privacidad: se estampa AL ENVIAR (fecha real del
    // aceptación) y se versiona con PRIVACY_VERSION; viaja como metadata de
    // user_metadata junto a full_name (ver api.ts SignUpPrivacyConsent).
    const privacyConsent = {
      accepted_privacy_at: new Date().toISOString(),
      accepted_privacy_version: PRIVACY_VERSION,
    };
    void (async () => {
      try {
        const result = await signUp(
          parsed.data.email,
          parsed.data.password,
          parsed.data.full_name,
          privacyConsent,
        );
        if (result.error !== null) {
          setFormError(registerErrorMessage(result.error.message));
          setPhase("error");
          return;
        }
        if (!result.needsConfirmation) {
          setGranted(true);
          return;
        }
        setPendingEmail(parsed.data.email);
        setResend({ status: "idle", message: null });
        setPhase("confirmation-pending");
      } catch {
        // Red caída: mismo wording que el catch de LoginPage (LoginPage.tsx:54-55).
        setFormError("No se pudo conectar, revisá tu conexión.");
        setPhase("error");
      }
    })();
  }

  function handleResend(): void {
    if (resend.status === "sending") return;
    setResend({ status: "sending", message: null });
    void (async () => {
      try {
        const { error } = await resendConfirmationEmail(pendingEmail);
        if (error !== null) {
          setResend({ status: "error", message: registerErrorMessage(error.message) });
          return;
        }
        setResend({
          status: "sent",
          message: "Email de confirmación reenviado. Revisá tu bandeja de entrada.",
        });
      } catch {
        setResend({
          status: "error",
          message: "No se pudo conectar, revisá tu conexión.",
        });
      }
    })();
  }

  // Sesión activa en /register (signIn con Confirm email OFF, u otro cliente
  // logueado en esta pestaña): fuera del formulario, igual que LoginPage.
  if (granted || status === "authenticated") {
    return <Navigate to="/inicio" replace />;
  }

  if (phase === "confirmation-pending") {
    return (
      <div className="mx-auto max-w-sm px-4 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Revisá tu email</h1>
        <p className="mt-1 text-sm text-gray-600">
          Revisá tu email para confirmar tu cuenta. Te enviamos el link de confirmación
          a <span className="font-medium">{pendingEmail}</span>. Sin confirmar tu email no
          vas a poder iniciar sesión.
        </p>
        {resend.message !== null && resend.status === "sent" && (
          <p
            role="status"
            className="mt-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
          >
            {resend.message}
          </p>
        )}
        {resend.message !== null && resend.status === "error" && (
          <div className="mt-4">
            <ErrorBanner message={resend.message} />
          </div>
        )}
        <button
          type="button"
          disabled={resend.status === "sending"}
          onClick={handleResend}
          className="mt-6 w-full rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          {resend.status === "sending" ? "Reenviando…" : "Reenviar email"}
        </button>
        <p className="mt-4 text-sm text-gray-600">
          <Link to="/login" className="font-medium text-gray-900 underline">
            ¿Ya tenés cuenta? Iniciá sesión
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Crear tu cuenta</h1>
      <p className="mt-1 text-sm text-gray-600">
        Registrate con tu nombre, email y contraseña para usar FAROX.
      </p>
      <div className="mt-6">
        <RegisterForm
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
          ¿Ya tenés cuenta? Iniciá sesión
        </Link>
      </p>
    </div>
  );
}
