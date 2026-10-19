import { z } from "zod";

// Validación del formulario de login antes de cualquier request (V0-2/PROD-3):
// sin datos válidos, cero llamadas a la red.
export const loginSchema = z.object({
  email: z.string().min(1, "Ingresá tu email").email("Ingresá un email válido"),
  password: z.string().min(1, "Ingresá tu contraseña"),
});

export type LoginInput = z.infer<typeof loginSchema>;
