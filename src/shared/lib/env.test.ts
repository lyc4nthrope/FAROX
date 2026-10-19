import { describe, expect, it } from "vitest";

import { ConfigError, loadEnv } from "./env";

const VALID_ENV = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_ANON_KEY: "anon-key-de-ejemplo",
};

describe("loadEnv (V0-1: env config enforced)", () => {
  it("lanza ConfigError tipado si faltan las variables", () => {
    expect(() => loadEnv({})).toThrow(ConfigError);
  });

  it("rechaza valores vacíos — sin fallback silencioso", () => {
    const emptyEnv = { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" };
    expect(() => loadEnv(emptyEnv)).toThrow(ConfigError);
  });

  it("acepta una configuración válida", () => {
    expect(loadEnv(VALID_ENV)).toEqual(VALID_ENV);
  });
});
