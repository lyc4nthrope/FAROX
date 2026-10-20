import { z } from "zod";

// Validación Zod ANTES de cualquier request (idea:198 "validación Zod en cada
// formulario" — STORE-1 exige bloquear coordenadas omitidas en el cliente).
// store_type_id y las coordenadas viajan como strings (valores crudos de
// <select>/<input>); la capa api los convierte al armar el RPC/UPDATE.

// Id de catálogo válido: dígito entero >= 1 (mismo criterio que products).
function esIdDeCatalogo(value: string): boolean {
  return Number.isInteger(Number(value)) && Number(value) >= 1;
}

// Rango válido de una coordenada en grados decimales (WGS84, SRID 4326).
function esRango(value: string, min: number, max: number): boolean {
  // value !== "" es OBLIGATORIO: Number("") === 0, y 0 cae dentro de ambos
  // rangos — sin esta guarda un campo vacío pasaría como coordenada (0,0).
  return (
    value !== "" && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max
  );
}

export const storeSchema = z.object({
  name: z.string().trim().min(1, "Ingresá el nombre de la tienda"),
  store_type_id: z.string().trim().refine(esIdDeCatalogo, "Elegí un tipo de tienda"),
  address: z.string().trim(),
  city: z.string().trim(),
  phone: z.string().trim(),
  // D3 (#486) SUPERSEDE: la ubicación ya no son campos numéricos manuales —
  // se elige en el MAPA (shared/ui/LocationPicker). Coordenadas
  // OBLIGATORIAS: stores.location NOT NULL (0002:131) mientras p_location es
  // DEFAULT NULL (0004:641) y create_store solo valida nombre/store_type
  // (0004:652-657) — omitirlas produciría un not_null_violation crudo
  // (STORE-1 escenario "coordinates omitted blocked client-side"). Los inputs
  // numéricos quedan SOLO en el escape hatch si el mapa no carga.
  lat: z.string().trim().refine(
    (value) => esRango(value, -90, 90),
    "Ingresá una latitud válida entre -90 y 90",
  ),
  lng: z.string().trim().refine(
    (value) => esRango(value, -180, 180),
    "Ingresá una longitud válida entre -180 y 180",
  ),
});

export type StoreFormValues = z.infer<typeof storeSchema>;
