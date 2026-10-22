import { type ListResult } from "../../shared/lib/list";
import { supabase } from "../../shared/lib/supabase/client";
import type { CatalogDefinition } from "./definitions";
import type { CatalogKey, CatalogRow } from "./types";

// sdd/admin-console T-C4 · capa de datos GENÉRICA del motor de catálogos
// (design #599 §2.3). DML directo por CatalogKey — no existen RPCs para
// estas tablas y las policies catalogs_* (0006:66-120) dan SELECT libre
// (USING true) y escritura solo-admin. Un no-admin que fuerce una escritura
// recibe 42501 REAL de la DB y la UI lo muestra amigable (HARD-1).
// .from(key) con variable: los nombres de estas 4 tablas NO están en la gate
// §S8 (son tablas en alcance) y products/api.ts:141 ya usa el mismo patrón.
// El error sale CRUDO de acá: el call site lo pasa por mapError() (HARD-1).

// PostgREST NO rinde error cuando RLS filtra TODAS las filas de un
// UPDATE/DELETE: responde 0 filas afectadas. Sin esta guarda, una operación
// denegada parecería éxito. Se sintetiza el SQLSTATE real (42501) para que
// mapError() lo traduzca (patrón stores/api.ts:31-34). Variable por el
// excess-property check de TS.
const RLS_NO_ROWS = {
  code: "42501",
  message: "permission denied for catalog table (0 rows affected)",
};

function normalizeRow(raw: Record<string, unknown>): CatalogRow {
  const parent =
    typeof raw.parent === "object" && raw.parent !== null
      ? (raw.parent as { name?: unknown })
      : null;
  return {
    id: typeof raw.id === "number" ? raw.id : 0,
    name: typeof raw.name === "string" ? raw.name : "",
    is_active: raw.is_active === true,
    abbreviation: typeof raw.abbreviation === "string" ? raw.abbreviation : null,
    category: typeof raw.category === "string" ? raw.category : null,
    description: typeof raw.description === "string" ? raw.description : null,
    parent_id: typeof raw.parent_id === "number" ? raw.parent_id : null,
    parent_name: typeof parent?.name === "string" ? parent.name : null,
  };
}

// Listado COMPLETO por definition (select explícito de la config, D4): las 4
// tablas son catálogos chicos y la UI no pagina (count = filas traidas).
// El contrato ListResult lo exige useList (refetch tras mutación — HARD-3).
export async function fetchCatalogRows(
  definition: Pick<CatalogDefinition, "key" | "select">,
): Promise<ListResult<CatalogRow>> {
  const { data, error } = await supabase
    .from(definition.key)
    .select(definition.select)
    .order("name");
  if (error !== null) {
    return { rows: [], count: null, error };
  }
  const rows = Array.isArray(data)
    ? (data as unknown as Array<Record<string, unknown>>).map(normalizeRow)
    : [];
  return { rows, count: rows.length, error: null };
}

// INSERT directo: el payload ya viene convertido por definition.toDbRow
// (Zod corrió en el contenedor ANTES de llegar acá).
export async function createCatalogRow(
  key: CatalogKey,
  payload: Record<string, unknown>,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from(key).insert(payload);
  return { error };
}

// UPDATE directo + select id: 0 filas ⇒ 42501 sintetizado (nunca un falso
// éxito). Para brands solo actualiza el nombre — is_active muta SOLO por la
// acción «Desactivar» (ADM-9.2, política 0006:95-97).
export async function updateCatalogRow(
  key: CatalogKey,
  id: number,
  payload: Record<string, unknown>,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from(key)
    .update(payload)
    .eq("id", id)
    .select("id");
  if (error !== null) {
    return { error };
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { error: RLS_NO_ROWS };
  }
  return { error: null };
}

// Paso 1 del borrado en dos pasos de brands (ADM-9.2 · policy 0006:95-97:
// DELETE solo sobre is_active = false). Se reimplementa el update de
// distributors/api.ts:133-148 — mismo patrón STORE-3.
export async function deactivateCatalogRow(
  key: CatalogKey,
  id: number,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from(key)
    .update({ is_active: false })
    .eq("id", id)
    .select("id");
  if (error !== null) {
    return { error };
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { error: RLS_NO_ROWS };
  }
  return { error: null };
}

// DELETE directo (hard) o paso 2 del two-step (brands, sobre fila ya
// desactivada). FK RESTRICT desde products (0002:97/98/99) ⇒ 23503 REAL del
// server en filas en uso, traducido por mapError (T-B1). Borrar un padre de
// categorías es seguro: los hijos quedan con parent_id NULL (0002:64).
export async function deleteCatalogRow(
  key: CatalogKey,
  id: number,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from(key)
    .delete()
    .eq("id", id)
    .select("id");
  if (error !== null) {
    return { error };
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { error: RLS_NO_ROWS };
  }
  return { error: null };
}
