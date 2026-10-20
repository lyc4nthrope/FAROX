// Espejo del enum público contact_preference (20261015000001_extensions_enums
// .sql:101-102). Duplicado A PROPÓSITO respecto de features/distributors/
// types.ts: las features no se importan entre sí (límite de módulo D1, obs
// #486) — mismo precedente que profile/distributors para este enum.
export const CONTACT_PREFERENCES = ["whatsapp", "phone", "email"] as const;

export type ContactPreference = (typeof CONTACT_PREFERENCES)[number];

// Catálogo store_types para el <select> de [Mi tienda] (misma forma que el
// resto de los catálogos: id entero + nombre; 0006:76-77 USING true).
// Propósito de módulo: no se importa features/stores/types.
export interface StoreTypeOption {
  id: number;
  name: string;
}

// Señales DERIVADas de identidad (design #538 §5.1, R-D3.2/R-D3.3): se
// resuelven con 2 helpers whitelisteados + 1 lectura legible, sin columna
// onboarding_status. hasStore = asignada (my_store_ids) O propia
// (stores.created_by = uid).
export interface OnboardingSignals {
  hasDistributor: boolean;
  hasStore: boolean;
}

// Árbol de la pregunta de 2 niveles (design #538 §5.2, #527/#528): "¿Qué sos?"
// [Distribuidor | Tienda]; Tienda ⇒ sub-pregunta [Mi tienda | Trabajo en
// tienda]. Los pasos terminales son las 3 pantallas de terminal.
export type OnboardingStep = "role" | "store" | "distributor" | "my-store" | "worker";
