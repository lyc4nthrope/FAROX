import type { OnboardingSignals } from "./types";

// Caché en MEMORIA (module-level) de las últimas señales de onboarding
// resueltas, keyed por userId.
//
// Por qué memoria y no sessionStorage: el fallo que resuelve es un
// unmount/remount de React DENTRO de una sesión viva (el SDK re-emite
// SIGNED_IN en cada visibilitychange y el guard remontaba el layout) — la
// memoria de módulo sobrevive exactamente a eso. Además:
//   · sin frontera de serialización (nada de JSON.parse validado, cuota de
//     storage ni modo privado de Safari);
//   · muere con el documento ⇒ una sesión NUEVA siempre revalida contra el
//     server; nada de respuestas viejas de horas anteriores;
//   · keyed por userId ⇒ un cambio de cuenta en la misma pestaña jamás ve
//     las señales del usuario anterior.
// Solo se escriben resoluciones EXITOSAS: un error nunca ensucia la caché.
const cache = new Map<string, OnboardingSignals>();

export function readCachedOnboardingSignals(userId: string): OnboardingSignals | null {
  return cache.get(userId) ?? null;
}

export function writeCachedOnboardingSignals(
  userId: string,
  signals: OnboardingSignals,
): void {
  cache.set(userId, signals);
}

// Aislamiento de tests: cada suite parte sin caché (el provider de
// OnboardingGate la consume al montar).
export function clearOnboardingSignalsCache(): void {
  cache.clear();
}
