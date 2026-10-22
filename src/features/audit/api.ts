import { supabase } from "../../shared/lib/supabase/client";
import { auditCursorSchema, auditFilterSchema, auditRowSchema } from "./schemas";
import type { AuditRow } from "./types";

// sdd/admin-console T-D1 · capa de datos de /audit (design #599 §2.4 ·
// spec ADM-10). SOLO LECTURA y este archivo es el ÚNICO lugar del repo con el
// literal de la tabla de auditoría (invariante I1: la gate §S8 matchea texto
// crudo y T-A2 la habilitó; check-scope.mjs:62-65/91-99).
// · Acceso: GRANT SELECT 0006:377 + policy audit_read SOLO admin 0006:330-332.
// · Append-only de verdad: DML revocado a authenticated (0006:351-357) y
//   UPDATE/DELETE también para el rol de servicio (0011:551-554) ⇒ esta
//   feature NUNCA tendrá controles de escritura, por diseño.
// · Paginación keyset por id DESC (decisión #6 del design · FLAG-1): id es
//   GENERATED ALWAYS AS IDENTITY (0003:256) — monotónico, así el cursor no
//   se rompe con los ties de created_at (BRIN 0003:271 no es único).
// · NUNCA count (ni planned ni exact): en una tabla append-only e infinita el
//   total es caro e inútil — se pagina con lookahead (LIMIT 25+1) y "Cargar
//   más" (ADM-10.2). Por eso NO entra en useList (offset + count rechazados).
// El error sale CRUDO de acá: el call site lo pasa por mapError() (HARD-1).

// Cols explícitas (D4): exactamente las que la UI de /audit consume.
const SELECT_COLS = "id, created_by, table_name, action, row_id, diff, created_at";

// Página fija: 25 visibles + 1 de lookahead para saber si hay más SIN count.
export const AUDIT_PAGE_SIZE = 25;

// Defensa de runtime: auditRowSchema decide fila a fila — una fila que no
// cumple el contrato (jsonb corrupto, action fuera del enum) se DESCARTA en
// vez de romper la tabla o renderizar texto crudo del server (HARD-1).
function normalizeRow(raw: unknown): AuditRow | null {
  const parsed = auditRowSchema.safeParse(raw);
  if (!parsed.success) return null;
  // z.unknown() infiere diff como key opcional: se re-normaliza a null
  // (el render lo trata igual que «Sin cambios» — ver AuditTable).
  return { ...parsed.data, diff: parsed.data.diff ?? null };
}

// Una página de eventos, de más reciente a más viejo. El caller pagina con el
// id de la ÚLTIMA fila devuelta (cursorId) y refiltra por tabla si así lo pide.
export async function fetchAuditPage(
  cursorId: number | null,
  tableFilter?: string,
): Promise<{ rows: AuditRow[]; hasMore: boolean; error: { message: string } | null }> {
  // Zod ANTES de cualquier request (convención global): cursor o filtro
  // inválido ⇒ CERO llamadas a supabase. El server sigue siendo autoridad
  // (audit_read devuelve 0 filas a un no-admin); esto evita el viaje inútil.
  const cursor = auditCursorSchema.safeParse(cursorId);
  const filtro = auditFilterSchema.safeParse({ table_name: tableFilter });
  if (!cursor.success || !filtro.success) {
    return {
      rows: [],
      hasMore: false,
      error: { message: "audit: parámetros de consulta inválidos" },
    };
  }

  // lt/eq ANTES de order/limit: el builder de filtros expone lt/eq y devuelven
  // el mismo builder; order/limit cierran la cadena (patrón users/api.ts).
  let query = supabase.from("audit_log").select(SELECT_COLS);
  if (cursor.data !== null) {
    // Keyset: estrictamente por DEBAJO del id del cursor (DESC), nunca offset.
    query = query.lt("id", cursor.data);
  }
  if (filtro.data.table_name !== undefined) {
    query = query.eq("table_name", filtro.data.table_name);
  }
  const { data, error } = await query
    .order("id", { ascending: false })
    .limit(AUDIT_PAGE_SIZE + 1);
  if (error !== null) {
    return { rows: [], hasMore: false, error };
  }

  const crudas = Array.isArray(data) ? (data as unknown[]) : [];
  // Lookahead: la fila extra (26.ª) solo prueba "hay más" — jamás se muestra
  // y jamás se pide un conteo total (ADM-10.2).
  const hasMore = crudas.length > AUDIT_PAGE_SIZE;
  const rows = crudas
    .slice(0, AUDIT_PAGE_SIZE)
    .map(normalizeRow)
    .filter((row): row is AuditRow => row !== null);
  return { rows, hasMore, error: null };
}
