import type { AuthChangeEvent } from "@supabase/supabase-js";

import { supabase } from "../../shared/lib/supabase/client";
import { normalizeRole, type Privileges } from "./types";
import type { LoginInput } from "./schemas";

// Cada módulo features/*/api.ts es el ÚNICO punto que toca supabase (D1). El
// AuthProvider y los tests trabajan con tipos de dominio, nunca con Session/User.

// Sesión traducida a tipos de dominio.
export interface CurrentSession {
  userId: string;
  email: string | null;
}

export type AuthSessionListener = (
  event: AuthChangeEvent,
  session: CurrentSession | null,
) => void;

// Devolvemos solo { message } en errores: el texto crudo NUNCA se renderiza
// (la taxonomía completa mapError() es B3/T3.1 — D5).
export interface AuthOperationError {
  message: string;
}

// Restauración de sesión (D2): lee la sesión persistida; sin sesión → null.
export async function getSession(): Promise<CurrentSession | null> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (session === null) {
    return null;
  }
  return { userId: session.user.id, email: session.user.email ?? null };
}

// Devuelve el unsubscribe para que el provider limpie en su effect.
export function subscribeToAuthChanges(listener: AuthSessionListener): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    listener(
      event,
      session === null ? null : { userId: session.user.id, email: session.user.email ?? null },
    );
  });
  return () => {
    data.subscription.unsubscribe();
  };
}

export async function signInWithPassword(
  credentials: LoginInput,
): Promise<{ error: AuthOperationError | null }> {
  const { error } = await supabase.auth.signInWithPassword(credentials);
  return { error };
}

// Resultado del registro (D1). needsConfirmation = true cuando signUp NO
// devuelve sesión: con "Confirm email" activo (D44) el flujo primario es
// "esperar confirmación", no una sesión (instalado: auth-js GoTrueClient.d.ts
// 292-293 — "If Confirm email is enabled, a user is returned but session is
// null"). Si la confirmación la desactiva un humano, llega sesión y la
// página redirige al home.
export interface SignUpOutcome {
  needsConfirmation: boolean;
  error: AuthOperationError | null;
}

// ÚNICA vía de registro (no hay RPC custom): supabase.auth.signUp dispara el
// INSERT en auth.users y el trigger on_auth_user_created (0004:397-400) crea
// public.users con role operador ANTES de la confirmación de email.
// fullName viaja en options.data.full_name: handle_new_user() lo lee de
// raw_user_meta_data ->> 'full_name' (0004:336) — sin él, el nombre visible
// degrada silenciosamente al local-part del email.
//
// privacyConsent viaja igual, en options.data (user_metadata):
//   accepted_privacy_at      → ISO 8601 del momento del registro
//   accepted_privacy_version → PRIVACY_VERSION vigente (shared/lib/legal)
// Elegimos user_metadata y NO una tabla propia porque este cambio es sin
// migración: es AUDITABLE vía API (el propio usuario puede leer su metadata)
// pero NO a prueba de alteraciones — una tabla de consentimientos con RLS
// escrita server-side es la solución de largo plazo.
export interface SignUpPrivacyConsent {
  accepted_privacy_at: string;
  accepted_privacy_version: string;
}

export async function signUp(
  email: string,
  password: string,
  fullName: string,
  privacyConsent: SignUpPrivacyConsent,
): Promise<SignUpOutcome> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, ...privacyConsent } },
  });
  if (error !== null) {
    return { needsConfirmation: false, error };
  }
  return { needsConfirmation: data.session === null, error: null };
}

// Reenvío del email de confirmación (type "signup" es el único válido acá;
// ResendParams en auth-js lib/types.ts:747-749, VERIFICADO contra las types
// instaladas de @supabase/supabase-js 2.118.0 / auth-js).
export async function resendConfirmationEmail(
  email: string,
): Promise<{ error: AuthOperationError | null }> {
  const { error } = await supabase.auth.resend({ type: "signup", email });
  return { error };
}

// ── D2 · canje del código de confirmación de email (PKCE) ─────────────────────
// Tras confirmar el email, Supabase redirige a /auth/callback?code=... El
// código es de UN solo uso: sin canjearlo, confirmar NO otorga sesión.

export type ConfirmEmailOutcome =
  | { status: "ok" }
  | { status: "missing-code" }
  | { status: "error"; error: AuthOperationError };

// Método VERIFICADO contra las types instaladas (@supabase/supabase-js
// 2.118.0 → auth-js GoTrueClient.d.ts:856-858):
//   exchangeCodeForSession(authCode: string, options?: { flowId?: string })
// El flowId es optativo y solo importa con varios flujos PKCE en vuelo
// (GoTrueClient.d.ts:676-681); el flujo de email de confirmación trae uno
// solo, así que va sin opciones.
export async function confirmEmailConfirmationCode(): Promise<ConfirmEmailOutcome> {
  const code = new URLSearchParams(window.location.search).get("code");
  if (code === null || code === "") {
    return { status: "missing-code" };
  }
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error === null) {
    return { status: "ok" };
  }
  // Realidad del cliente instalado: el SDK auto-canjea el código en
  // _initialize() cuando detecta un callback PKCE con verifier en storage
  // (auth-js GoTrueClient.js:393 y 403-404 → 3285). Nuestro canje explícito
  // corre DESPUÉS (el wrapper público espera initializePromise,
  // GoTrueClient.js:1257); si el auto-canje ya consumió el código, el
  // explícito falla pero la sesión EXISTE — no es error para el usuario.
  // (Hoy, con el cliente en flowType implícito, el auto-canje no ocurre:
  // signUp nunca guarda verifier — GoTrueClient.js:738-741. Este fallback
  // además cubre el doble montaje en StrictMode.)
  const existing = await getSession();
  if (existing !== null) {
    return { status: "ok" };
  }
  return { status: "error", error };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error !== null) {
    // La sesión local se remueve igual; el AuthProvider limpia el estado en su finally.
    console.error("[FAROX] signOut reportó un error:", error.message);
  }
}

// Rol y premium = VERDAD DE LA DB vía my_role()/is_premium() (D2 — jamás del
// JWT, user_metadata o localStorage: escalada de privilegios, idea:137).
// Ante cualquier fallo se degrada a { role: null, premium: false } sin crash (V0-3).
export async function fetchPrivileges(): Promise<Privileges> {
  try {
    const [roleResult, premiumResult] = await Promise.all([
      supabase.rpc("my_role"),
      supabase.rpc("is_premium"),
    ]);
    if (roleResult.error !== null || premiumResult.error !== null) {
      console.error(
        "[FAROX] Privilegios no disponibles:",
        roleResult.error ?? premiumResult.error,
      );
      return { role: null, premium: false };
    }
    return { role: normalizeRole(roleResult.data), premium: premiumResult.data === true };
  } catch (error) {
    console.error("[FAROX] Sin conexión para leer privilegios:", error);
    return { role: null, premium: false };
  }
}
