import { z } from "zod";

import { LIMITS } from "../../shared/lib/limits";
import { CONTACT_PREFERENCES } from "./types";

// Validación antes de cualquier request (PROD-3 aplicado al perfil).
// Los .max espejan los CHECK de 0040 (users.full_name / users.phone_number).
export const profileSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, "Ingresá tu nombre")
    .max(LIMITS.userName, `Máximo ${LIMITS.userName} caracteres`),
  phone_number: z.string().trim().max(LIMITS.userPhone, `Máximo ${LIMITS.userPhone} caracteres`),
  contact_preference: z.enum(CONTACT_PREFERENCES),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
