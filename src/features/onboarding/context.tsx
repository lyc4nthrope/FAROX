import { createContext, useContext } from "react";

// Estado del onboarding en React Context (R-D3.5: Context, NO Zustand —
// package.json no lo trae y el estado es local a la sesión autenticada).
// El provider vive en routes/OnboardingGate.tsx (árbol post-RequireAuth) y
// lo consumen el guard y las 3 terminales.
export type OnboardingPhase = "loading" | "ready" | "error";

export interface OnboardingContextValue {
  phase: OnboardingPhase;
  // Predicado ya derivado (detection.deriveNeedsOnboarding) + ack de sesión.
  needsOnboarding: boolean;
  // Mensaje YA mapeado por mapError() en el call site (HARD-1).
  error: string | null;
  // Re-lee las 3 señales en el server — lo llaman las terminales con éxito
  // para que el guard deje de preguntar antes de navegar a "/".
  refresh: () => Promise<void>;
  // Terminal [Trabajo en tienda]: sin señal persistente ⇒ ack SOLO en esta
  // sesión (en los próximos logins la pregunta vuelve, S-D3.C — deseado).
  acknowledge: () => void;
  // Reintento tras un error de detección (phase === "error").
  retry: () => void;
}

export const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (context === null) {
    throw new Error("useOnboarding requiere un OnboardingGate por encima en el árbol");
  }
  return context;
}

