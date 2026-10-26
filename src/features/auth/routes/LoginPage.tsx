import { useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { signInWithPassword } from "../api";
import { LoginForm, type LoginFormErrors } from "../components/LoginForm";
import { loginSchema, type LoginInput } from "../schemas";

const EMPTY_VALUES: LoginInput = { email: "", password: "" };

// Mensajes amigables mínimos para login (mismo wording que la tabla D5). La
// taxonomía central mapError() llega con B3/T3.1; el texto crudo del backend
// jamás llega al DOM.
function loginErrorMessage(message: string): string {
  if (message.includes("Invalid login credentials")) {
    return "Email o contraseña incorrectos.";
  }
  // Con "Confirm email" activo, GoTrue rechaza el login hasta que el usuario
  // abra el link del email de verificación (D44): mensaje accionable en vez
  // del fallback genérico.
  if (message.toLowerCase().includes("email not confirmed")) {
    return "Confirmá tu email antes de iniciar sesión. Revisá tu bandeja de entrada y abrí el link de verificación.";
  }
  if (message.toLowerCase().includes("network") || message.toLowerCase().includes("fetch")) {
    return "No se pudo conectar, revisá tu conexión.";
  }
  return "No se pudo iniciar sesión. Revisá tus datos e intentá de nuevo.";
}

// Contenedor de login (§S2 fila /login). Tras un signInWithPassword exitoso,
// el SIGNED_IN lo levanta el AuthProvider y este componente redirige cuando el
// estado pasa a "authenticated" — sin carreras de navegación manual.
export function LoginPage() {
  const { status } = useAuth();
  const [values, setValues] = useState<LoginInput>(EMPTY_VALUES);
  const [errors, setErrors] = useState<LoginFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleSubmit(): void {
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      const issues = parsed.error.flatten();
      setErrors({
        email: issues.fieldErrors.email?.[0],
        password: issues.fieldErrors.password?.[0],
      });
      setFormError(null);
      return; // validación antes de cualquier request (V0-2)
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    void (async () => {
      try {
        const { error } = await signInWithPassword(parsed.data);
        if (error !== null) {
          setFormError(loginErrorMessage(error.message));
        }
      } catch {
        setFormError("No se pudo conectar, revisá tu conexión.");
      } finally {
        setPending(false);
      }
    })();
  }

  if (status === "authenticated") {
    return <Navigate to="/inicio" replace />;
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Iniciar sesión</h1>
      <p className="mt-1 text-sm text-gray-600">
        Ingresá con tu email y contraseña para usar FAROX.
      </p>
      <div className="mt-6">
        <LoginForm
          values={values}
          errors={errors}
          formError={formError}
          pending={pending}
          onChange={setValues}
          onSubmit={handleSubmit}
        />
      </div>
      {/* Cross-link Login ↔ Register (D1): /register es ruta pública. */}
      <p className="mt-3 text-sm text-gray-600">
        <Link to="/recuperar" className="font-medium text-gray-900 underline">
          ¿Olvidaste tu contraseña?
        </Link>
      </p>
      <p className="mt-2 text-sm text-gray-600">
        <Link to="/register" className="font-medium text-gray-900 underline">
          ¿No tenés cuenta? Registrate
        </Link>
      </p>
    </div>
  );
}
