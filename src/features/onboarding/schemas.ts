import { z } from "zod";

import { storeSchema } from "../stores/schemas";
import { CONTACT_PREFERENCES } from "./types";

// Validación Zod ANTES de cualquier request (idea:198 — mismo contrato que
// todos los forms de la app). Distribuidor: name y NIT son UNIQUE NOT NULL en
// la tabla (0003:16); el NIT es el campo fiscal que la RPC register_distributor
// valida server-side (design #538 §2.2 paso 4). Los campos de contacto vacíos
// viajan como "" y la capa api los convierte en NULL (columnas nullable,
// 0003:18-19).
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

export type DistributorRegistrationValues = z.infer<typeof distributorSchema>;

// [Mi tienda] = alta MÍNIMA: reusa el storeSchema de B7 vía pick (mismos
// refinamientos de nombre/tipo/coordenadas, sin duplicarlos — T2.5 "reusar
// stores/schemas.ts como building block"). address/city/phone NO se piden en
// este alta mínima: la capa api los envía NULL (p_address/p_city/p_phone son
// DEFAULT NULL, 0004:641-643). Coordenadas OBLIGATORIAS: stores.location
// NOT NULL (0002:131) — Zod bloquea el request en el cliente (STORE-1
// "coordinates omitted blocked client-side", defense-in-depth con el guard
// server de 0013(a)).
export const myStoreSchema = storeSchema.pick({
  name: true,
  store_type_id: true,
  lat: true,
  lng: true,
});

export type MyStoreValues = z.infer<typeof myStoreSchema>;
