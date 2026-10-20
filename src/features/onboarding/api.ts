import { supabase } from "../../shared/lib/supabase/client";
import { buildLocationEWKT } from "../stores/geo";
import type { DistributorRegistrationValues, MyStoreValues } from "./schemas";
import {
  hasDistributorId,
  hasOwnedStores,
  hasStoreIds,
} from "./detection";
import type { OnboardingSignals, StoreTypeOption } from "./types";

// Onboarding DERIVADO (design #538 §5.1 · R-D3.2): la detección usa SOLO
// helpers ya whitelisteados (my_distributor_id 0011:484 / my_store_ids
// 0011:483) + 1 lectura legible de stores (stores_select USING true,
// 0006:164-165). CERO SELECT de columnas privilegiadas: users.distributor_id
// está revocado para el cliente (0006:198/:368-369) y user_stores es
// ilegible (0006:373) — por eso los helpers.

export interface OnboardingSignalsResult {
  signals: OnboardingSignals | null;
  // shape mínimo de PostgREST: code opcional porque mapError() lo lee para
  // traducir SQLSTATE (42501/23502/PGRST116).
  error: { message: string; code?: string } | null;
}

// 3 reads en paralelo; cualquier error ⇒ se reporta crudo y el call site lo
// pasa por mapError() (HARD-1). Las 3 señales se combinan en la capa api y
// el predicado puro vive en detection.ts.
export async function fetchOnboardingSignals(
  userId: string,
): Promise<OnboardingSignalsResult> {
  const [distributor, storeIds, owned] = await Promise.all([
    supabase.rpc("my_distributor_id"),
    supabase.rpc("my_store_ids"),
    supabase.from("stores").select("id").eq("created_by", userId),
  ]);
  if (distributor.error !== null) {
    return { signals: null, error: distributor.error };
  }
  if (storeIds.error !== null) {
    return { signals: null, error: storeIds.error };
  }
  if (owned.error !== null) {
    return { signals: null, error: owned.error };
  }
  return {
    signals: {
      hasDistributor: hasDistributorId(distributor.data),
      hasStore: hasStoreIds(storeIds.data) || hasOwnedStores(owned.data),
    },
    error: null,
  };
}

// Terminal [Distribuidor] — RPC register_distributor (D5, contract EXACTO de
// design #538 §2.1): SECURITY DEFINER que valida NIT/name, crea la fila
// distributors y setea users.role_id + users.distributor_id en UNA
// transacción, devolviendo el id nuevo (bigint). Los opcionales vacíos viajan
// NULL (DEFAULT NULL en la firma). Errores server-side (NIT duplicado
// unique_violation, cap-1 "ya tenés un distribuidor asociado", guard de
// usuario inactivo) salen crudos y el contenedor los pasa por mapError()
// en el call site (HARD-1).
export async function registerDistributor(
  values: DistributorRegistrationValues,
): Promise<{ id: number | null; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc("register_distributor", {
    p_name: values.name,
    p_nit: values.nit,
    p_contact_name: values.contact_name === "" ? null : values.contact_name,
    p_phone: values.phone === "" ? null : values.phone,
    p_email: values.email === "" ? null : values.email,
    p_contact_preference: values.contact_preference,
  });
  if (error !== null) {
    return { id: null, error };
  }
  const id = typeof data === "number" ? data : Number(data);
  return { id: Number.isFinite(id) ? id : null, error: null };
}

// Terminal [Mi tienda] — alta SOLO por la RPC create_store (mismo camino que
// features/stores/api.ts: la creación en stores pasa exclusivamente por esa
// RPC, STORE-1). El EWKT de p_location se arma con stores/geo.buildLocationEWKT
// (lng-first SIEMPRE — T2.5 "reusar geo.ts como building block"; un swap
// lat/lng es silencioso y dejaría la tienda en el océano). address/city/phone
// no viajan: son DEFAULT NULL (0004:641-643). La auto-asociación del dueño en
// user_stores la hace el server (D35, 0004:661-663) ⇒ tras el éxito la señal
// my_store_ids() aparece derivada, sin llamadas extra.
export async function createStore(
  values: MyStoreValues,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.rpc("create_store", {
    p_name: values.name,
    p_store_type_id: Number(values.store_type_id),
    p_address: null,
    p_city: null,
    p_phone: null,
    p_location: buildLocationEWKT(Number(values.lat), Number(values.lng)),
  });
  return { error };
}

// Catálogo store_types para el <select> de [Mi tienda] (0006:76-77 policies
// catalogs_select USING true) — lectura mínima, mismo select que el form de
// B7. El error sale CRUDO: el contenedor lo mapea con mapError() (HARD-1).
export async function fetchStoreTypes(): Promise<{
  rows: StoreTypeOption[];
  error: { message: string } | null;
}> {
  const { data, error } = await supabase.from("store_types").select("id, name").order("name");
  if (error !== null) {
    return { rows: [], error };
  }
  const rows = Array.isArray(data)
    ? data
        .map((raw) => {
          const record = raw as Record<string, unknown>;
          const id = typeof record.id === "number" ? record.id : Number(record.id);
          if (typeof record.name !== "string" || !Number.isFinite(id)) return null;
          return { id, name: record.name };
        })
        .filter((row): row is StoreTypeOption => row !== null)
    : [];
  return { rows, error: null };
}
