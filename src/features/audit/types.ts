import type { AUDIT_ACTIONS } from "./schemas";

// sdd/admin-console T-D1 · types de la feature audit (design #599 §2.4).
// Sin codegen de tipos (convención del repo): las filas se normalizan a mano
// en api.ts y se validan con auditRowSchema (Zod) antes de llegar a la UI.

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Fila de la lista /audit — cols explícitas de audit_log (0003:255-266). */
export interface AuditRow {
  id: number;
  /** Actor sin FK (0003:257): uuid sin join posible ⇒ la UI lo trunca. */
  created_by: string | null;
  table_name: string;
  action: AuditAction;
  /** text (no bigint): en users.id es uuid (0003:261-262). */
  row_id: string | null;
  /** jsonb — SOLO columnas cambiadas (D10, 0003:263). Objeto/array/null defensivo. */
  diff: unknown;
  created_at: string;
}
