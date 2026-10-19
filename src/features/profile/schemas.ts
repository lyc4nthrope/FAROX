import { z } from "zod";

import { CONTACT_PREFERENCES } from "./types";

// Validación antes de cualquier request (PROD-3 aplicado al perfil).
export const profileSchema = z.object({
  full_name: z.string().trim().min(1, "Ingresá tu nombre"),
  phone_number: z.string().trim(),
  contact_preference: z.enum(CONTACT_PREFERENCES),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
