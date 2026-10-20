import type { OnboardingSignals } from "./types";

// Detección DERIVADA de onboarding (design #538 §5.1 / AD-5): módulo PURO —
// ni supabase ni React (mismo criterio de testeo unitario que stores/geo).
//
// Predicado (binding, spec #536 §D3 + design §5.2):
//   needsOnboarding = (NO distributor) AND (NO tienda) AND (NO ack de sesión)
// donde
//   · NO distributor = my_distributor_id() devuelve NULL (0009:69-73);
//   · NO tienda      = my_store_ids() vacío (0009:60-67) Y ninguna fila en
//                      stores con created_by = uid (0006:164-165 USING true);
//   · ack            = la terminal [Trabajo en tienda] no produce señal
//                      persistente: se ackea SOLO en esta sesión y en los
//                      próximos logins la pregunta vuelve (S-D3.C, deseado).
function esId(value: unknown): boolean {
  const id = typeof value === "number" ? value : Number(value);
  // "" o null no cuentan: Number("") === 0 y 0 no es un id válido.
  return value !== null && value !== "" && Number.isFinite(id) && id > 0;
}

// my_distributor_id() ⇒ bigint | NULL (0009:69-73 — inactivo ⇒ NULL).
export function hasDistributorId(data: unknown): boolean {
  return esId(data);
}

// my_store_ids() ⇒ bigint[] (0009:60-67 — '{}' cuando no hay alcance).
export function hasStoreIds(data: unknown): boolean {
  return Array.isArray(data) && data.some(esId);
}

// stores filtradas por created_by = uid ⇒ filas [{ id }] (vacío ⇒ []).
export function hasOwnedStores(data: unknown): boolean {
  return Array.isArray(data) && data.length > 0;
}

// Predicado puro de la pregunta (T2.1): se muestra MIENTRAS no exista
// ninguna señal y nadie haya confirmado la terminal pasiva en esta sesión.
export function deriveNeedsOnboarding(
  signals: OnboardingSignals,
  acknowledged: boolean,
): boolean {
  return !acknowledged && !signals.hasDistributor && !signals.hasStore;
}
