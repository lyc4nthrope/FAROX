// Espejo del enum público contact_preference (20261015000001_extensions_enums.sql:101-102).
// Duplicado A PROPÓSITO respecto de features/profile/types.ts: las features no
// se importan entre sí (límite de módulo D1, obs #486); una extracción del
// enum a shared/ queda como limpieza futura, no en este lote.
export const CONTACT_PREFERENCES = ["whatsapp", "phone", "email"] as const;

export type ContactPreference = (typeof CONTACT_PREFERENCES)[number];

// Fila del listado (§S2 /distributors: nombre + estado activo; el NIT
// identifica de paso — es UNIQUE NOT NULL, 0003:16).
export interface DistributorListRow {
  id: number;
  name: string;
  nit: string;
  is_active: boolean;
}

// Fila completa del formulario (tabla distributors, 0003:13-24).
export interface DistributorRow extends DistributorListRow {
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  contact_preference: ContactPreference;
}
