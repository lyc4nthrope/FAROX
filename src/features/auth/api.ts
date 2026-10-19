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
