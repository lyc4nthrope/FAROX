import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadEnv } from "../env";

// Se inicializa al cargar el módulo: si el env falta o es inválido, el boot falla
// con ConfigError (V0-1). Único punto de creación del cliente en toda la app (D1).
const env = loadEnv(import.meta.env);

export const supabase: SupabaseClient = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
