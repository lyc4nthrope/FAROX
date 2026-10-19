import { supabase } from "../../shared/lib/supabase/client";
import type { ProfileFormValues } from "./schemas";
import { CONTACT_PREFERENCES, type ContactPreference, type ProfileRow } from "./types";

function isContactPreference(value: unknown): value is ContactPreference {
  return CONTACT_PREFERENCES.some((preference) => preference === value);
}

function normalizeRow(raw: Record<string, unknown>): ProfileRow {
  return {
    full_name: typeof raw.full_name === "string" ? raw.full_name : "",
    phone_number: typeof raw.phone_number === "string" ? raw.phone_number : null,
    contact_preference: isContactPreference(raw.contact_preference)
      ? raw.contact_preference
      : "whatsapp",
  };
}

// SELECT de la fila propia (users_select permite id = auth.uid() — 0006:202-204).
// .single(): si no hay fila, PGRST116 llega como { error } y la UI degrada
// amigablemente — nunca un crash (S7: RLS vacío ≠ error).
export async function fetchMyProfile(
  userId: string,
): Promise<{ row: ProfileRow | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("users")
    .select("full_name, phone_number, contact_preference")
    .eq("id", userId)
    .single();
  if (error !== null) {
    return { row: null, error };
  }
  return { row: normalizeRow(data), error: null };
}

// Envia EXACTAMENTE las 3 columnas de perfil (§S2 profile-column-limit):
// el UPDATE de users está revocado y solo esas 3 tienen GRANT (0006:368-369),
// por lo que cualquier columna extra produciría 42501.
export async function updateMyProfile(
  userId: string,
  values: ProfileFormValues,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase
    .from("users")
    .update({
      full_name: values.full_name,
      phone_number: values.phone_number === "" ? null : values.phone_number,
      contact_preference: values.contact_preference,
    })
    .eq("id", userId);
  return { error };
}
