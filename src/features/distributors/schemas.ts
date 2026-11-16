import { z } from "zod";

import { LIMITS } from "../../shared/lib/limits";
import { CONTACT_PREFERENCES } from "./types";

// Validación Zod ANTES de cualquier request (idea:198 "validación Zod en cada
// formulario" — DIST-01 cumple el mismo contrato que PROD-3). Los campos de
// contacto vacíos viajan como "" y la capa api los convierte en NULL
// (columnas nullable, 0003:18-19).
export const distributorSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Ingresá el nombre del distribuidor")
    .max(LIMITS.distributorName, `Máximo ${LIMITS.distributorName} caracteres`),
  nit: z
    .string()
    .trim()
    .min(1, "Ingresá el NIT")
    .max(LIMITS.distributorNit, `Máximo ${LIMITS.distributorNit} caracteres`),
  contact_name: z
    .string()
    .trim()
    .max(LIMITS.distributorContactName, `Máximo ${LIMITS.distributorContactName} caracteres`),
  phone: z
    .string()
    .trim()
    .max(LIMITS.distributorPhone, `Máximo ${LIMITS.distributorPhone} caracteres`),
  email: z
    .string()
    .trim()
    .max(LIMITS.distributorEmail, `Máximo ${LIMITS.distributorEmail} caracteres`)
    .refine((value) => value === "" || z.string().email().safeParse(value).success, {
      message: "Ingresá un email válido",
    }),
  contact_preference: z.enum(CONTACT_PREFERENCES),
});

export type DistributorFormValues = z.infer<typeof distributorSchema>;
