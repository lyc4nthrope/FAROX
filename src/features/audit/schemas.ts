import { z } from "zod";

// sdd/admin-console T-D1 (design #599 §2.5 · spec ADM-10). Zod valida ANTES
// de cualquier request: input inválido ⇒ CERO invocaciones de red (convención
// global, ProductFormPage.test.tsx:201-229). Acá vive la ÚNICA defensa de
// inputs de /audit: fetchAuditPage safeParsea cursor y filtro antes de tocar
// el cliente supabase, así ninguna ruta inválida alcanza la red.

// 8 tablas con alcance de auditoría (D21, 0003:258-259) como strings PLAIN:
// la gate §S8 matchea `.from(` + comilla, nunca strings sueltos — por eso
// estos nombres viven acá y no en comentarios con llamadas (check-scope.mjs:62-65).
export const AUDITED_TABLES = [
  "users",
  "price_publications",
  "orders",
  "credits",
  "credit_payments",
  "distributors",
  "products",
  "stores",
] as const;

export type AuditedTable = (typeof AUDITED_TABLES)[number];

// Valores del enum server audit_action (0001:94).
export const AUDIT_ACTIONS = ["insert", "update", "delete"] as const;

// Filtro de la lista: tabla opcional (el select del page manda "" = todas ⇒
// el api recibe undefined y NO encadena .eq).
export const auditFilterSchema = z.object({
  table_name: z.enum(AUDITED_TABLES).optional(),
});

// Cursor keyset: id es bigint GENERATED ALWAYS AS IDENTITY (0003:256) —
// monotónico, evita los ties de created_at que rompen cursores (FLAG-1).
export const auditCursorSchema = z.number().int().positive().nullable();

// Fila cruda de audit_log validada por Zod (T-D1: "Zod-validate rows").
// diff es jsonb: puede venir como objeto, array o (defensivo) null aunque la
// columna sea NOT NULL DEFAULT '{}' (0003:263) — nunca se confía al runtime.
export const auditRowSchema = z.object({
  id: z.number(),
  // created_by SIN FK (0003:257): uuid suelto, se muestra truncado.
  created_by: z.string().nullable(),
  table_name: z.string(),
  action: z.enum(AUDIT_ACTIONS),
  // row_id es text (no bigint): users.id es uuid (0003:261-262).
  row_id: z.string().nullable(),
  diff: z.unknown(),
  created_at: z.string(),
});
