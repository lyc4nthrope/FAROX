// sdd/admin-console T-C1 · types de la feature roles (design #599 §2.2).
// DML directo sobre la tabla roles (policies catalogs_* admin-only,
// 0006:56-64): sin RPC y sin is_active — el borrado es HARD y la protección
// de filas en uso la da la FK RESTRICT users.role_id → roles (0002:73).
// Los ids de roles son integer (identity, 0002:42).

/** Fila de la lista /roles — cols explícitas (D4). */
export interface RoleListRow {
  id: number;
  name: string;
  description: string | null;
}

/** Detalle /roles/:id — misma forma que la lista (tabla de 4 columnas). */
export interface RoleDetailRow {
  id: number;
  name: string;
  description: string | null;
}

import { ROLE_NAMES } from "../auth/types";

// ADM-8.5 (d): los 3 roles semilla (0005:18-22) son EXACTAMENTE el catálogo
// de la app — no se pueden renombrar ni borrar desde la UI. Un rol legacy
// fuera de ROLE_NAMES (R3) sí se puede corregir o eliminar: ese es su camino
// de limpieza.
export function esRolSemilla(name: string): boolean {
  return ROLE_NAMES.some((seed) => seed === name);
}
