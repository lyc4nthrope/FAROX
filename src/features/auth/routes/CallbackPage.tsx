import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { ErrorBanner } from "../../../shared/ui";
import { mapError } from "../../../shared/lib/errors/mapError";
import { confirmEmailConfirmationCode } from "../api";

// Contenedor de /auth/callback (D2 — ruta PÚBLICA: el usuario llega del link
// de confirmación de email a MITAD de la autenticación, sin sesión todavía).
// Máquina de estados mínima: processing → (success ⇒ Navigate "/" con el
// código ya canjeado) | error (mensaje mapeado + salida al login).
type CallbackPhase = "processing" | "error";

// Errores propios del canje + taxonomía central (mapError en el call site,
// convención B3/HARD-1 — mismo molde que registerErrorMessage en
// RegisterPage.tsx:29-40): el texto crudo de GoTrue jamás llega al DOM.
function callbackErrorMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("expired")) {
    return "El link de confirmación expiró. Iniciá sesión y pedí uno nuevo.";
  }
  if (lower.includes("already") || lower.includes("redeemed")) {
    return "Este link de confirmación ya fue usado. Iniciá sesión para continuar.";
  }
  return mapError({ message });
}

// El código ya canjeará el servidor (single-use): lo sacamos de la URL con
// replaceState para que un refresh no reintente un código muerto. Sin
// recarga de página — el Navigate de abajo se encarga de la navegación.
function stripCodeFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  window.history.replaceState(window.history.state, "", url.toString());
}

export function CallbackPage() {
  const [phase, setPhase] = useState<CallbackPhase>("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const outcome = await confirmEmailConfirmationCode();
        if (cancelled) return;
        if (outcome.status === "error") {
          setErrorMessage(callbackErrorMessage(outcome.error.message));
          setPhase("error");
          return;
        }
        if (outcome.status === "missing-code") {
          setErrorMessage(
            "El link de confirmación es inválido o está incompleto. Pedí uno nuevo desde el login.",
          );
          setPhase("error");
          return;
        }
        stripCodeFromUrl();
        setGranted(true);
      } catch {
        // Red caída: mismo wording que el catch de LoginPage/RegisterPage.
        if (cancelled) return;
        setErrorMessage("No se pudo conectar, revisá tu conexión.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ÉXITO: hay sesión — canje hecho, código fuera de la URL. El seam de
  // onboarding es DERIVADO (diseño #538 §8): D3 detecta "sesión autenticada
  // sin tienda ni distribuidor" y muestra la pregunta SIN importar cómo llegó
  // el usuario (post-confirmación de email o login normal). Por eso el
  // destino es "/" (el shell de la app) y NO una ruta de onboarding
  // hardcodeada — que además no existe todavía.
  if (granted) {
    return <Navigate to="/" replace />;
  }

  if (phase === "error") {
    return (
      <div className="mx-auto max-w-sm px-4 py-12">
        <h1 className="text-xl font-semibold">No pudimos confirmar tu cuenta</h1>
        <p className="mt-1 text-sm text-gray-600">
          El link de confirmación puede haber expirado o ya haber sido usado.
        </p>
        {errorMessage !== null && (
          <div className="mt-4">
            <ErrorBanner message={errorMessage} />
          </div>
        )}
        <p className="mt-4 text-sm text-gray-600">
          <Link to="/login" className="font-medium text-gray-900 underline">
            Iniciá sesión
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-xl font-semibold">Confirmando tu cuenta…</h1>
      <p role="status" className="mt-1 text-sm text-gray-600">
        Un momento mientras activamos tu cuenta.
      </p>
    </div>
  );
}
