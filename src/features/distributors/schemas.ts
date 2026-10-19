import { z } from "zod";

import { CONTACT_PREFERENCES } from "./types";

// Validación Zod ANTES de cualquier request (idea:198 "validación Zod en cada
// formulario" — DIST-01 cumple el mismo contrato que PROD-3). Los campos de
// contacto vacíos viajan como "" y la capa api los convierte en NULL
// (columnas nullable, 0003:18-19).
export const distributorSchema = z.object({
  name: z.string().trim().min(1, "Ingresá el nombre del distribuidor"),
  nit: z.string().trim().min(1, "Ingresá el NIT"),
  contact_name: z.string().trim(),
  phone: z.string().trim(),
  email: z
    .string()
    .trim()
    .refine((value) => value === "" || z.string().email().safeParse(value).success, {
      message: "Ingresá un email válido",
    }),
  contact_preference: z.enum(CONTACT_PREFERENCES),
});

export type DistributorFormValues = z.infer<typeof distributorSchema>;
