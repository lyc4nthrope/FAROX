import { pageRange, type ListQuery, type ListResult } from "../../shared/lib/list";
import { supabase } from "../../shared/lib/supabase/client";
import type { RoleName } from "../auth/types";
import type { ProfileFormValues } from "../profile/schemas";
import { CONTACT_PREFERENCES, type ContactPreference } from "../profile/types";
import type {
  DistributorOption,
  UserDetailRow,
  UserListRow,
  UserStoreCounts,
  UserStoreRow,
} from "./types";

// sdd/admin-console T-B3 · capa de datos de /users (design #599 §2.1).
// Prueba de autorización por llamada:
// · SELECT de users ⇒ policy users_select "fila propia o admin" (0006:202-204);
//   el SELECT de users NUNCA se revoca (07_users.sql:192).
// · UPDATE de users ⇒ SOLO las 3 columnas con GRANT por columna (0006:368-369,
//   D45): role_id/email/distributor_id/premium/is_active mutan SOLO por RPC.
// · rol/premium/activo ⇒ RPCs assert_admin() (0011:85-139, GRANTs 0011:486-488).
// · user_stores ⇒ SOLO lectura y SOLO tras la migración D2a (lote A); policy
//   user_stores_select (0006:308-310) da TODAS las filas al admin (ADM-1.1).
// El error sale CRUDO de acá: el call site lo pasa por mapError() (HARD-1).

// PostgREST NO rinde error cuando RLS filtra TODAS las filas de un UPDATE:
// responde 0 filas afectadas. Sin esta guarda, una edición denegada parecería
// éxito. Se sintetiza el SQLSTATE real (42501) para que mapError() lo traduzca
// (patrón stores/api.ts:31-34). Variable por el excess-property check de TS.
const RLS_NO_ROWS = {
  code: "42501",
  message: "permission denied for table users (0 rows affected)",
};

// Cols explícitas de la UI (D4). El join de rol va por FK users.role_id →
// roles (0002:73, ON DELETE RESTRICT).
const FORM_SELECT =
  "id, email, full_name, phone_number, contact_preference, distributor_id, premium, is_active";

function isContactPreference(value: unknown): value is ContactPreference {
  return CONTACT_PREFERENCES.some((preference) => preference === value);
}

function normalizeRoleName(raw: unknown): string | null {
  if (typeof raw === "object" && raw !== null && "name" in raw) {
    const { name } = raw as { name: unknown };
    return typeof name === "string" ? name : null;
  }
  return null;
}

function normalizeRole(
  raw: unknown,
): { id: number; name: string } | null {
  if (typeof raw === "object" && raw !== null && "id" in raw && "name" in raw) {
    const { id, name } = raw as { id: unknown; name: unknown };
    if (typeof id === "number" && typeof name === "string") {
      return { id, name };
    }
  }
  return null;
}

function normalizeListRow(raw: Record<string, unknown>): UserListRow {
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    email: typeof raw.email === "string" ? raw.email : null,
    full_name: typeof raw.full_name === "string" ? raw.full_name : "",
    premium: raw.premium === true,
    is_active: raw.is_active === true,
    role_name: normalizeRoleName(raw.role),
    store_count: null, // lo completa UsersPage con la query de apoyo (FLAG-4)
  };
}

function normalizeDetailRow(raw: Record<string, unknown>): UserDetailRow {
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    email: typeof raw.email === "string" ? raw.email : null,
    full_name: typeof raw.full_name === "string" ? raw.full_name : "",
    phone_number: typeof raw.phone_number === "string" ? raw.phone_number : null,
    contact_preference: isContactPreference(raw.contact_preference)
      ? raw.contact_preference
      : "whatsapp",
    distributor_id: typeof raw.distributor_id === "number" ? raw.distributor_id : null,
    premium: raw.premium === true,
    is_active: raw.is_active === true,
    role: normalizeRole(raw.role),
  };
}

function normalizeStoreRow(raw: Record<string, unknown>): UserStoreRow {
  const store =
    typeof raw.stores === "object" && raw.stores !== null
      ? (raw.stores as { name?: unknown; city?: unknown })
      : null;
  return {
    store_id: typeof raw.store_id === "number" ? raw.store_id : 0,
    created_at: typeof raw.created_at === "string" ? raw.created_at : "",
    store_name: typeof store?.name === "string" ? store.name : null,
    store_city: typeof store?.city === "string" ? store.city : null,
  };
}

// Lista paginada de /users: count 'planned' NUNCA 'exact' + .range (Base:695,
// contrato useList D4). SIN RPC: la policy users_select ya le da al admin
// todas las filas (0006:202-204).
export async function fetchUsers(
  query: ListQuery,
): Promise<ListResult<UserListRow>> {
  const { from, to } = pageRange(query);
  const { data, count, error } = await supabase
    .from("users")
    .select(`${FORM_SELECT}, role:roles(name)`, { count: "planned" })
    .order("full_name")
    .range(from, to);
  if (error !== null) {
    return { rows: [], count: null, error };
  }
  const rows = Array.isArray(data) ? data.map(normalizeListRow) : [];
  return { rows, count, error: null };
}

// Detalle /users/:id — .single(): sin fila (o policy que la oculta) ⇒
// PGRST116, que la UI traduce vía mapError() (mapError.ts:68-70).
export async function fetchUser(
  id: string,
): Promise<{ row: UserDetailRow | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("users")
    .select(`${FORM_SELECT}, role:roles(id,name)`)
    .eq("id", id)
    .single();
  if (error !== null) {
    return { row: null, error };
  }
  return { row: normalizeDetailRow(data), error: null };
}

// Edición de perfil ADMIN: envía EXACTAMENTE las 3 columnas con GRANT UPDATE
// (0006:368-369, D45) — cualquier columna extra produciría 42501. 0 filas ⇒
// sintetiza 42501 (nunca un falso éxito).
export async function updateUserProfile(
  id: string,
  values: ProfileFormValues,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("users")
    .update({
      full_name: values.full_name,
      phone_number: values.phone_number === "" ? null : values.phone_number,
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

// ÚNICA vía de asignar rol y alcance de distribuidor (M11 · 0011:85-108):
// NUNCA un UPDATE directo de role_id (columna privilegiada). Para roles ≠
// distribuidor el server setea distributor_id = NULL (0011:102).
export async function updateUserRole(
  userId: string,
  role: RoleName,
  distributorId: number | null,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.rpc("update_user_role", {
    p_user: userId,
    p_role: role,
    p_distributor: distributorId ?? null,
  });
  return { error };
}

// premium solo vía RPC (D47 / 0011:111-124) — la columna no tiene GRANT.
export async function setUserPremium(
  userId: string,
  value: boolean,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.rpc("set_user_premium", {
    p_user_id: userId,
    p_value: value,
  });
  return { error };
}

// is_active solo vía RPC (0011:126-139). El backend NO tiene guard de
// auto-desactivación ⇒ la guarda de UI vive en UserDetail (T-B7, ADM-6.2).
export async function setUserActive(
  userId: string,
  value: boolean,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.rpc("set_user_active", {
    p_user_id: userId,
    p_value: value,
  });
  return { error };
}

// Tiendas asignadas en SOLO LECTURA (ADM-7): el filtro es SOLO por user_id —
// sin filtro "admin" client-side: la policy 0006:308-310 otorga todas las
// filas al admin (ocultar es UX, idea:134). La mutación (assign_user_stores)
// queda FUERA de este alcance. En runtime sin el GRANT D2a esto devuelve
// 42501 ⇒ ErrorBanner amigable, nunca un crash (invariante I4).
export async function fetchUserStores(
  userId: string,
): Promise<{ rows: UserStoreRow[]; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("user_stores")
    .select("store_id, created_at, stores(name,city)")
    .eq("user_id", userId);
  if (error !== null) {
    return { rows: [], error };
  }
  const rows = Array.isArray(data) ? data.map(normalizeStoreRow) : [];
  return { rows, error: null };
}

// Query de APOYO de la columna «Tiendas» de la lista (FLAG-4): independiente
// de fetchUsers, para que la lista no se acople a D2a — si falla, UsersPage
// degrada la columna a «—». Misma policy post-D2a que fetchUserStores.
export async function fetchUserStoreCounts(): Promise<{
  counts: UserStoreCounts | null;
  error: { message: string } | null;
}> {
  const { data, error } = await supabase.from("user_stores").select("user_id");
  if (error !== null) {
    return { counts: null, error };
  }
  const counts: UserStoreCounts = {};
  if (Array.isArray(data)) {
    for (const raw of data) {
      const userId = (raw as { user_id?: unknown }).user_id;
      if (typeof userId === "string") {
        counts[userId] = (counts[userId] ?? 0) + 1;
      }
    }
  }
  return { counts, error: null };
}

// Opciones del picker de distribuidor del panel de rol (M11). Copia local por
// convención de feature (stores/api.ts:176-194 duplica fetchStoreTypes).
export async function fetchDistributorOptions(): Promise<{
  options: DistributorOption[];
  error: { message: string } | null;
}> {
  const { data, error } = await supabase
    .from("distributors")
    .select("id,name")
    .order("name");
  if (error !== null) {
    return { options: [], error };
  }
  const options: DistributorOption[] = Array.isArray(data)
    ? data
        .filter(
          (raw: { id?: unknown; name?: unknown }) =>
            typeof raw.id === "number" && typeof raw.name === "string",
        )
        .map((raw: { id: number; name: string }) => ({
          id: raw.id,
          name: raw.name,
        }))
    : [];
  return { options, error: null };
}
