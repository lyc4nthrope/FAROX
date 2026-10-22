// sdd/admin-console T-B3 · types de la feature users (design #599 §2.1).
// Sin codegen de tipos (D1/open question 2): las filas se normalizan a mano
// en api.ts, igual que distributors/profile. Los ids de users son uuid (text).

import type { ContactPreference } from "../profile/types";

/** Fila de la lista /users — cols explícitas (D4), role embebido por FK. */
export interface UserListRow {
  id: string;
  email: string | null;
  full_name: string;
  premium: boolean;
  is_active: boolean;
  /** name del rol vía embed role:roles(name); null si la fila no tiene join. */
  role_name: string | null;
  /**
   * Conteo de tiendas asignadas (FLAG-4): query de APOYO independiente de la
   * lista. null = la query falló o aún no resolvió ⇒ la UI pinta "—".
   */
  store_count: number | null;
}

/** Fila de detalle /users/:id — suma las 3 columnas de perfil + rol con id. */
export interface UserDetailRow {
  id: string;
  email: string | null;
  full_name: string;
  phone_number: string | null;
  contact_preference: ContactPreference;
  distributor_id: number | null;
  premium: boolean;
  is_active: boolean;
  role: { id: number; name: string } | null;
}

/** Asignación user_stores leída en SOLO LECTURA (ADM-7 · D2a desbloquea el SELECT). */
export interface UserStoreRow {
  store_id: number;
  created_at: string;
  store_name: string | null;
  store_city: string | null;
}

/** Opción del picker de distribuidor del panel de rol (M11). */
export interface DistributorOption {
  id: number;
  name: string;
}

/** user_id → cantidad de filas en user_stores (columna Tiendas de /users). */
export type UserStoreCounts = Record<string, number>;
