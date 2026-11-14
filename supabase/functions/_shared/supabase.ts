import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

function required(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === "") {
    throw new Error(`Falta el secret ${name}`);
  }
  return value;
}

export function userClient(authHeader: string): SupabaseClient {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
}

export function serviceClient(): SupabaseClient {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function authHeader(request: Request): string | null {
  const value = request.headers.get("Authorization");
  if (value === null || !value.startsWith("Bearer ")) return null;
  return value;
}
