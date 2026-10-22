// sdd/admin-console T-C4 · types del motor de catálogos (design #599 §1 D-M1,
// §2.3). UN motor genérico para las 4 tablas — la variación vive en
// definitions.ts (datos), NO en código por pantalla.
// Policies: SELECT USING(true) y escritura solo-admin (0006:66-120). Sin
// RPC: DML directo por tabla (design #599 §2.3).

/** Las 4 tablas de catálogo del motor (design key-decision #1). */
export type CatalogKey =
  | "unit_types"
  | "store_types"
  | "brands"
  | "product_categories";

/** Fila uniforme del motor: cada definition pide SOLO sus columnas al server
 * (select explícito, D4) y normalize llena el resto con defaults. */
export interface CatalogRow {
  id: number;
  name: string;
  /** Solo brands tiene is_active real (0002:52); en las demás es default. */
  is_active: boolean;
  /** unit_types (0002:32). */
  abbreviation: string | null;
  /** unit_types (0002:33). */
  category: string | null;
  /** product_categories (0002:63). */
  description: string | null;
  /** product_categories self-FK ON DELETE SET NULL (0002:64). */
  parent_id: number | null;
  /** name del padre vía embed parent:parent_id(name); null si no hay join. */
  parent_name: string | null;
}

/** Opción del picker «categoría padre» del form (solo product_categories). */
export interface ParentOption {
  id: number;
  name: string;
}
