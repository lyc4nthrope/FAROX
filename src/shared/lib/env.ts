import { z } from "zod";

/** Error tipado de configuración: el arranque falla si el env es inválido (V0-1). */
export class ConfigError extends Error {
  constructor(issues: readonly string[]) {
    super(`Configuración inválida: ${issues.join("; ")}`);
    this.name = "ConfigError";
  }
}

const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().url("VITE_SUPABASE_URL debe ser una URL válida"),
  VITE_SUPABASE_ANON_KEY: z.string().min(1, "VITE_SUPABASE_ANON_KEY no puede estar vacía"),
});

export type AppEnv = z.infer<typeof envSchema>;

/** Valida el env en el arranque. Sin fallback silencioso: si falta algo, lanza ConfigError. */
export function loadEnv(source: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => issue.message));
  }
  return result.data;
}
