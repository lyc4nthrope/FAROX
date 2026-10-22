import { supabase } from "../../shared/lib/supabase/client";
import type { RoleFormValues } from "./schemas";
import type { RoleDetailRow, RoleListRow } from "./types";

// sdd/admin-console T-C1 · capa de datos de /roles (design #599 §2.2).
// DML DIRECTO sobre la tabla roles — no existe RPC y las policies
// catalogs_* (0006:56-64) dan SELECT libre y escritura solo-admin:
// · fetchRoles ⇒ catalogs_select USING(true) (0006:56-57);
// · createRole/updateRole/deleteRole ⇒ catalogs_insert/update/delete
//   admin-only (0006:58-64); un no-admin recibe 42501 REAL de la DB.
// NO hay is_active en roles (0002:41-46) ⇒ el borrado es HARD directo.
// users.role_id → roles ON DELETE RESTRICT (0002:73): borrar un rol en uso
// trae SQLSTATE 23503 del server, que la UI traduce vía mapError (T-B1:
// «Este registro está en uso y no se puede eliminar.» — HARD-1).
// El error sale CRUDO de acá: el call site lo pasa por mapError() (HARD-1).

// PostgREST NO rinde error cuando RLS filtra TODAS las filas de un
// UPDATE/DELETE: responde 0 filas afectadas. Sin esta guarda, una operación
// denegada parecería éxito. Se sintetiza el SQLSTATE real (42501) para que
// mapError() lo traduzca (patrón stores/api.ts:31-34). Variable por el
// excess-property check de TS.
const RLS_NO_ROWS = {
  code: "42501",
  message: "permission denied for table roles (0 rows affected)",
};

// Cols explícitas (D4): id, name, description — las únicas que la UI usa.
const SELECT_COLS = "id, name, description";

function normalizeListRow(raw: Record<string, unknown>): RoleListRow {
  return {
    id: typeof raw.id === "number" ? raw.id : 0,
    name: typeof raw.name === "string" ? raw.name : "",
    description: typeof raw.description === "string" ? raw.description : null,
  };
}

function normalizeDetailRow(raw: Record<string, unknown>): RoleDetailRow {
  return normalizeListRow(raw);
}

// Lista COMPLETA de /roles sin paginar (D4): la tabla roles es acotada por
// diseño (3 semilla + los que el admin cree), order name — igual que las
// queries de opciones de otras features (users/api.ts:249-256).
export async function fetchRoles(): Promise<{
  rows: RoleListRow[];
  error: { message: string } | null;
}> {
  const { data, error } = await supabase
    .from("roles")
    .select(SELECT_COLS)
    .order("name");
  if (error !== null) {
    return { rows: [], error };
  }
  const rows = Array.isArray(data) ? data.map(normalizeListRow) : [];
  return { rows, error: null };
}

// Detalle /roles/:id — .single(): sin fila (o policy que la oculta) ⇒
// PGRST116, que la UI traduce vía mapError() (mapError.ts:68-70).
export async function fetchRole(
  id: number,
): Promise<{ row: RoleDetailRow | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("roles")
    .select(SELECT_COLS)
    .eq("id", id)
    .single();
  if (error !== null) {
    return { row: null, error };
  }
  return { row: normalizeDetailRow(data), error: null };
}

// ADM-8.1: INSERT directo. Zod ya corrió en el contenedor (roleSchema.name =
// z.enum(ROLE_NAMES) ⇒ R3), así que el name que llega acá SIEMPRE ∈ catálogo.
export async function createRole(
  values: RoleFormValues,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from("roles").insert({
    name: values.name,
    description: values.description === "" ? null : values.description,
  });
  return { error };
}

// Edición (soloRoles legacy o descripción de semilla): 0 filas ⇒ 42501
// sintetizado, nunca un falso éxito.
export async function updateRole(
  id: number,
  values: RoleFormValues,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("roles")
    .update({
      name: values.name,
      description: values.description === "" ? null : values.description,
    })
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

// ADM-8.4: DELETE directo — un rol en uso revienta con 23503 REAL del server
// (FK RESTRICT 0002:73) que mapError traduce a «en uso» (T-B1). 0 filas
// (RLS o fila fantasma) ⇒ 42501 sintetizado.
export async function deleteRole(
  id: number,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("roles")
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
