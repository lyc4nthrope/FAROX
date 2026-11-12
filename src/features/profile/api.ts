import { supabase } from "../../shared/lib/supabase/client";
import type { LoadResult } from "../../shared/hooks/useLoad";
import type { ProfileFormValues } from "./schemas";
import { CONTACT_PREFERENCES, type ContactPreference, type ProfileRow } from "./types";

function isContactPreference(value: unknown): value is ContactPreference {
  return CONTACT_PREFERENCES.some((preference) => preference === value);
}

function normalizeMargin(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const margin = Number(value);
  return Number.isFinite(margin) ? margin : null;
}

function normalizeRow(raw: Record<string, unknown>): ProfileRow {
  return {
    full_name: typeof raw.full_name === "string" ? raw.full_name : "",
    phone_number: typeof raw.phone_number === "string" ? raw.phone_number : null,
    contact_preference: isContactPreference(raw.contact_preference)
      ? raw.contact_preference
      : "whatsapp",
    phone_verified_at:
      typeof raw.phone_verified_at === "string" ? raw.phone_verified_at : null,
    default_margin_pct: normalizeMargin(raw.default_margin_pct),
  };
}

export interface PhoneVerificationStart {
  code: string;
  phone_e164: string;
  expires_at: string;
}

// SELECT de la fila propia (users_select permite id = auth.uid() — 0006:202-204).
// .single(): si no hay fila, PGRST116 llega como { error } y la UI degrada
// amigablemente — nunca un crash (S7: RLS vacío ≠ error).
export async function fetchMyProfile(
  userId: string,
): Promise<{ row: ProfileRow | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("users")
    .select("full_name, phone_number, contact_preference, phone_verified_at, default_margin_pct")
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

/** 0045: margen de ganancia del usuario (porcentaje sobre el costo). */
export async function fetchMyMargin(userId: string): Promise<LoadResult<number | null>> {
  const { data, error } = await supabase
    .from("users")
    .select("default_margin_pct")
    .eq("id", userId)
    .maybeSingle();
  if (error !== null) return { data: null, error };
  const raw = data as { default_margin_pct?: unknown } | null;
  return { data: normalizeMargin(raw?.default_margin_pct), error: null };
}

/** 0045: guarda el margen propio (0–1000 % sobre el costo). null lo borra. */
export async function setMyMargin(
  margin: number | null,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.rpc("set_my_margin", { p_margin: margin });
  return { error };
}

/**
 * 0042: genera un código OTP y lo devuelve para mostrarlo. La RPC devuelve una
 * tabla (una fila); PostgREST la entrega como array. El código nunca se guarda
 * en claro en la base: solo su hash.
 */
export async function startPhoneVerification(
  phone: string,
): Promise<{ data: PhoneVerificationStart | null; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc("phone_verification_start", {
    p_phone: phone,
  });
  if (error !== null) return { data: null, error };

  const first = Array.isArray(data)
    ? (data[0] as Record<string, unknown> | undefined)
    : undefined;
  const code = typeof first?.code === "string" ? first.code : "";
  const phoneE164 = typeof first?.phone_e164 === "string" ? first.phone_e164 : "";
  const expiresAt = typeof first?.expires_at === "string" ? first.expires_at : "";

  if (code === "" || phoneE164 === "") {
    return { data: null, error: { message: "phone_verification: sin respuesta" } };
  }

  return { data: { code, phone_e164: phoneE164, expires_at: expiresAt }, error: null };
}
