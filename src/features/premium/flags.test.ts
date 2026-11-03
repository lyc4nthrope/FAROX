import { afterEach, describe, expect, it, vi } from "vitest";

import { isPremiumCheckoutEnabled } from "./flags";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isPremiumCheckoutEnabled (F6)", () => {
  it("en test queda habilitado por defecto", () => {
    expect(isPremiumCheckoutEnabled()).toBe(true);
  });

  it("en build de producción queda apagado por defecto", () => {
    vi.stubEnv("PROD", true);
    expect(isPremiumCheckoutEnabled()).toBe(false);
  });

  it("respeta el flag explícito", () => {
    vi.stubEnv("VITE_PREMIUM_CHECKOUT_ENABLED", "false");
    expect(isPremiumCheckoutEnabled()).toBe(false);
    vi.stubEnv("VITE_PREMIUM_CHECKOUT_ENABLED", "true");
    expect(isPremiumCheckoutEnabled()).toBe(true);
  });
});
