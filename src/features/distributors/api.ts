import { pageRange, type ListQuery, type ListResult } from "../../shared/lib/list";
import { supabase } from "../../shared/lib/supabase/client";
import type { DistributorFormValues } from "./schemas";
import {
  CONTACT_PREFERENCES,
  type ContactPreference,
  type DistributorListRow,
  type DistributorRow,
  type DistributorUserCounts,
} from "./types";

// distributors tiene CRUD DIRECTO por tabla (T5.1 / DIST-1, spec #483 S4):
// no existe RPC y la tabla NO está en el REVOKE RPC-only (0006:351-357).
// Políticas verificadas a mano en 0006:125-135: SELECT admin+operador ·
// INSERT/UPDATE admin · DELETE admin SOLO sobre filas ya inactivas.

// PostgREST NO rinde error cuando RLS filtra TODAS las filas de un
// UPDATE/DELETE: responde 0 filas afectadas. Sin esta guarda, una operación
// denegada parecería éxito. Se sintetiza el SQLSTATE real (42501) para que
// mapError() lo traduzca (HARD-1; "never a false success" — PROD-2 como
// referencia del mismo principio). Variable (no literal en el return) para
// no disparar el excess-property check de TS sobre { message }.
const RLS_NO_ROWS = {
  code: "42501",
  message: "permission denied for table distributors (0 rows affected)",
};

function isContactPreference(value: unknown): value is ContactPreference {
  return CONTACT_PREFERENCES.some((preference) => preference === value);
}

function normalizeListRow(raw: Record<string, unknown>): DistributorListRow {
  return {
    id: typeof raw.id === "number" ? raw.id : 0,
    name: typeof raw.name === "string" ? raw.name : "",
    nit: typeof raw.nit === "string" ? raw.nit : "",
    is_active: raw.is_active === true,
  };
}

function normalizeRow(raw: Record<string, unknown>): DistributorRow {
  return {
    ...normalizeListRow(raw),
    contact_name: typeof raw.contact_name === "string" ? raw.contact_name : null,
    phone: typeof raw.phone === "string" ? raw.phone : null,
    email: typeof raw.email === "string" ? raw.email : null,
    contact_preference: isContactPreference(raw.contact_preference)
      ? raw.contact_preference
      : "whatsapp",
  };
}

// Cols explícitas: solo lo que la UI muestra (D4). count 'planned' NUNCA
// 'exact' + .range para paginar (Base:695, contrato useList D4). El error
// sale CRUDO acá: useList lo mapea con mapError() — el texto del backend
// jamás llega al DOM (HARD-1).
export async function fetchDistributors(
  query: ListQuery,
): Promise<ListResult<DistributorListRow>> {
  const { from, to } = pageRange(query);
  const { data, count, error } = await supabase
    .from("distributors")
    .select("id, name, nit, is_active", { count: "planned" })
    .order("name")
    .range(from, to);
  if (error !== null) {
    return { rows: [], count: null, error };
  }
  const rows = Array.isArray(data) ? data.map(normalizeListRow) : [];
  return { rows, count, error: null };
}

// sdd/admin-console T-E2 (in-scope #5): query de APOYO de la columna admin
// «Usuarios asignados» — UNA sola lectura de users (policy users_select
// admin 0006:202-204) con el conteo por distributor_id hecho en el cliente:
// SIN N+1 (nunca una query por fila de la lista) y sin tocar la query de la
// lista. Si falla, la columna degrada a «—» y la lista no se rompe (mismo
// patrón de degradación que fetchUserStoreCounts en features/users/api.ts).
export async function fetchDistributorUserCounts(): Promise<{
  counts: DistributorUserCounts | null;
  error: { message: string } | null;
}> {
  const { data, error } = await supabase.from("users").select("distributor_id");
  if (error !== null) {
    return { counts: null, error };
  }
  const counts: DistributorUserCounts = {};
  if (Array.isArray(data)) {
    for (const raw of data) {
      const distributorId = (raw as { distributor_id?: unknown }).distributor_id;
      // distributor_id null (usuarios sin alcance) no cuenta para ningún
      // distributor; cualquier otra forma se ignora en vez de romper.
      if (typeof distributorId === "number") {
        counts[distributorId] = (counts[distributorId] ?? 0) + 1;
      }
    }
  }
  return { counts, error: null };
}

// .single(): sin fila (o una policy que la oculta) ⇒ PGRST116, que la UI
// traduce vía mapError() — nunca un crash (D4).
export async function fetchDistributor(
  id: number,
): Promise<{ row: DistributorRow | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("distributors")
    .select("*")
    .eq("id", id)
    .single();
  if (error !== null) {
    return { row: null, error };
  }
  return { row: normalizeRow(data), error: null };
}

// INSERT directo: la policy distributors_insert exige admin (0006:128-129);
// un rol menor que lo fuerza recibe 42501 real de la DB y la UI lo muestra
// amigable (DIST-1 "forced write → friendly denial").
export async function createDistributor(
  values: DistributorFormValues,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from("distributors").insert({
    name: values.name,
    nit: values.nit,
    contact_name: values.contact_name === "" ? null : values.contact_name,
    phone: values.phone === "" ? null : values.phone,
    email: values.email === "" ? null : values.email,
    contact_preference: values.contact_preference,
  });
  return { error };
}

export async function updateDistributor(
  id: number,
  values: DistributorFormValues,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("distributors")
    .update({
      name: values.name,
      nit: values.nit,
      contact_name: values.contact_name === "" ? null : values.contact_name,
      phone: values.phone === "" ? null : values.phone,
      email: values.email === "" ? null : values.email,
      contact_preference: values.contact_preference,
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

// Paso 1 del borrado en dos pasos (DIST-1 soft-delete): la policy
// distributors_delete exige is_active = false (0006:133-135), así que
// SIEMPRE se desactiva ANTES de borrar.
export async function deactivateDistributor(
  id: number,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("distributors")
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

// Paso 2: DELETE sobre la fila YA desactivada (0006:133-135).
export async function deleteDistributor(
  id: number,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("distributors")
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
