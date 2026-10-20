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
export const registerSchema = z.object({
  full_name: z.string().trim().min(1, "Ingresá tu nombre completo"),
  email: z.string().trim().min(1, "Ingresá tu email").email("Ingresá un email válido"),
  password: z
    .string()
    .min(1, "Ingresá tu contraseña")
    .min(6, "La contraseña debe tener al menos 6 caracteres"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
