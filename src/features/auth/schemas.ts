import { z } from "zod";

// Validación del formulario de login antes de cualquier request (V0-2/PROD-3):
// sin datos válidos, cero llamadas a la red.
export const loginSchema = z.object({
  email: z.string().min(1, "Ingresá tu email").email("Ingresá un email válido"),
  password: z.string().min(1, "Ingresá tu contraseña"),
});

export type LoginInput = z.infer<typeof loginSchema>;

// Registro público (D1). Mismo criterio que stores/products: trim + min(1)
// para texto obligatorio (stores/schemas.ts:23), validación ANTES de cualquier
// request (idea:198).
// · full_name es OBLIGATORIO y no vacío: el trigger handle_new_user() lee
//   raw_user_meta_data ->> 'full_name' y, si viene vacío, degrada el nombre
//   visible al local-part del email (0004:336-338) — acá se corta ese caso.
// · password SIN .trim(): un espacio es parte del secreto; el trim lo decide
//   quien lo tipea, no el formulario (mismo tratamiento que loginSchema).
// · Mínimo 6 = por defecto de Supabase Auth (GoTrue PASSWORD_MIN_LENGTH,
//   default 6 — supabase/supabase docker/CONFIG.md): la DB es la autoridad y
//   rechaza cortas con weak_password; el cliente solo adelanta ese fallo.
// · privacy_policy_accepted es un literal true: un checkbox sin marcar rompe
//   el parse ANTES de cualquier request (mismo contrato "input inválido ⇒
//   CERO llamadas" que el resto del form). El consentimiento es REQUISITO
//   legal para el tratamiento de datos (Ley 1581 de 2012) y se versiona con
//   PRIVACY_VERSION (slice legal, definido en shared/lib/legal).
export const registerSchema = z.object({
  full_name: z.string().trim().min(1, "Ingresá tu nombre completo"),
  email: z.string().trim().min(1, "Ingresá tu email").email("Ingresá un email válido"),
  password: z
    .string()
    .min(1, "Ingresá tu contraseña")
    .min(6, "La contraseña debe tener al menos 6 caracteres"),
  privacy_policy_accepted: z.literal(true, {
    error: "Debés aceptar la Política de Privacidad para crear tu cuenta",
  }),
});

// Tipo del formulario ya VALIDADO (parsed.data): el consentimiento es true.
export type RegisterInput = z.infer<typeof registerSchema>;

// Estado del formulario ANTES de validar: el checkbox vive en booleano
// (desmarcado por defecto) — el literal true de arriba es el contrato del
// resultado del parse, no el del estado crudo del form.
export type RegisterFormValues = Omit<RegisterInput, "privacy_policy_accepted"> & {
  privacy_policy_accepted: boolean;
};
