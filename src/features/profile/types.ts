// Espejo del enum público contact_preference (20261015000001_extensions_enums.sql:101-102).
// Sin codegen de tipos todavía (D1/open question 2): la constante se mantiene a mano.
export const CONTACT_PREFERENCES = ["whatsapp", "phone", "email"] as const;

export type ContactPreference = (typeof CONTACT_PREFERENCES)[number];

// Fila propia de public.users con SOLO las columnas de perfil editables
// (0006:369 grantea UPDATE únicamente a esas 3 columnas).
export interface ProfileRow {
  full_name: string;
  phone_number: string | null;
  contact_preference: ContactPreference;
}
