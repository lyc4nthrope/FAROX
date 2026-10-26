import { describe, expect, it } from "vitest";

import { forgotPasswordSchema, resetPasswordSchema } from "./schemas";

describe("forgotPasswordSchema · pedir el link de recuperación", () => {
  it("exige el email", () => {
    const result = forgotPasswordSchema.safeParse({ email: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.email?.[0]).toBe("Ingresá tu email");
    }
  });

  it("rechaza un email inválido antes de cualquier request", () => {
    const result = forgotPasswordSchema.safeParse({ email: "no-es-email" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.email?.[0]).toBe("Ingresá un email válido");
    }
  });

  it("normaliza espacios alrededor del email", () => {
    const result = forgotPasswordSchema.safeParse({ email: "  demo@farox.app  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("demo@farox.app");
    }
  });
});

describe("resetPasswordSchema · elegir la nueva contraseña", () => {
  it("exige mínimo 6 caracteres", () => {
    const result = resetPasswordSchema.safeParse({
      password: "corta",
      confirm_password: "corta",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password?.[0]).toBe(
        "La contraseña debe tener al menos 6 caracteres",
      );
    }
  });

  it("exige repetir la contraseña", () => {
    const result = resetPasswordSchema.safeParse({
      password: "nueva123",
      confirm_password: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.confirm_password?.[0]).toBe(
        "Repetí tu contraseña",
      );
    }
  });

  it("rechaza contraseñas distintas", () => {
    const result = resetPasswordSchema.safeParse({
      password: "nueva123",
      confirm_password: "otra123",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.confirm_password?.[0]).toBe(
        "Las contraseñas no coinciden",
      );
    }
  });

  it("acepta una contraseña válida y confirmada", () => {
    const result = resetPasswordSchema.safeParse({
      password: "nueva123",
      confirm_password: "nueva123",
    });
    expect(result.success).toBe(true);
  });
});
