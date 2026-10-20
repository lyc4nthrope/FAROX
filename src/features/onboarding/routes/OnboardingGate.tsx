import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { mapError } from "../../../shared/lib/errors/mapError";
import { ErrorBanner } from "../../../shared/ui";
import { fetchOnboardingSignals } from "../api";
import {
  OnboardingContext,
  useOnboarding,
  type OnboardingContextValue,
  type OnboardingPhase,
} from "../context";
import { deriveNeedsOnboarding } from "../detection";
import type { OnboardingSignals } from "../types";

// Guard DERIVADO post-RequireAuth (R-D3.1 · design #538 §5.2 y §8):
// RequireAuth/RequireRole quedan INTACTOS — este layout solo se monta
// DESPUÉS de que la sesión esté resuelta y intercepta cualquier ruta
// autenticada (también la llegada post-confirmación de D2, que redirige a
// "/"). Si el usuario no tiene tienda NI distributor ⇒ /onboarding; si ya
// tiene alguna señal ⇒ la pregunta jamás aparece (idempotente, S-D3.0).
// El estado vive en React Context (R-D3.5): se deriva 1 vez por sesión y las
// terminales lo refrescan con éxito en vez de re-preguntar.

function OnboardingProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const [phase, setPhase] = useState<OnboardingPhase>("loading");
  const [signals, setSignals] = useState<OnboardingSignals | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // RequireAuth garantiza sesión antes de montar este layout; el null es
    // solo por el tipo de AuthProvider.
    if (userId === null) return;
    let cancelled = false;
    setPhase("loading");
    void (async () => {
      try {
        const result = await fetchOnboardingSignals(userId);
        if (cancelled) return;
        if (result.error !== null) {
          // Detección fallida ⇒ NUNCA adivinar (ni pasar al app ni preguntar):
          // banner mapeado + reintento explícito (HARD-1, sin texto crudo).
          setError(mapError(result.error));
          setPhase("error");
          return;
        }
        setSignals(result.signals);
        setError(null);
        setPhase("ready");
      } catch (thrown) {
        if (cancelled) return;
        setError(mapError(thrown));
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  // Las terminales con éxito (register_distributor / create_store) la llaman
  // ANTES de navegar a "/" para que el guard evalúe la señal ya presente en
  // el server (my_distributor_id / my_store_ids — S-D3.A/S-D3.B AC).
  const refresh = useCallback(async (): Promise<void> => {
    if (userId === null) return;
    try {
      const result = await fetchOnboardingSignals(userId);
      if (result.error !== null) {
        setError(mapError(result.error));
        setPhase("error");
        return;
      }
      setSignals(result.signals);
      setError(null);
      setPhase("ready");
    } catch (thrown) {
      setError(mapError(thrown));
      setPhase("error");
    }
  }, [userId]);

  // [Trabajo en tienda]: sin señal persistente ⇒ ack SOLO de sesión (S-D3.C:
  // en los próximos logins la pregunta vuelve hasta que el admin asigne).
  const acknowledge = useCallback(() => setAcknowledged(true), []);
  const retry = useCallback(() => setAttempt((previous) => previous + 1), []);

  const needsOnboarding =
    phase === "ready" && signals !== null && deriveNeedsOnboarding(signals, acknowledged);

  const value = useMemo<OnboardingContextValue>(
    () => ({ phase, needsOnboarding, error, refresh, acknowledge, retry }),
    [phase, needsOnboarding, error, refresh, acknowledge, retry],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

function OnboardingGuard() {
  const { phase, needsOnboarding, error, retry } = useOnboarding();
  const location = useLocation();

  if (phase === "loading") {
    return (
      <p role="status" className="p-6 text-sm text-gray-500">
        Cargando tu perfil…
      </p>
    );
  }
  if (phase === "error") {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        {error !== null && <ErrorBanner message={error} />}
        <button
          type="button"
          onClick={retry}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Reintentar
        </button>
      </div>
    );
  }
  if (needsOnboarding && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }
  if (!needsOnboarding && location.pathname === "/onboarding") {
    // Señal ya presente (o ack de sesión): la pregunta NO reaparece
    // (S-D3.0 "nunca vuelve").
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

// Layout route: provider + guard en un solo árbol — las terminales (hijas
// vía Outlet) consumen el MISMO contexto que el guard decide.
export function OnboardingGate() {
  return (
    <OnboardingProvider>
      <OnboardingGuard />
    </OnboardingProvider>
  );
}
