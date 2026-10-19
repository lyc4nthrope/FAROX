import { z } from "zod";

// Validación Zod ANTES de cualquier request (idea:198 "validación Zod en cada
// formulario" — PROD-3 lo exige para productos). Los FK y la cantidad viajan
// como strings (son valores crudos de <select>/<input>); la capa api los
// convierte a número al armar el INSERT/UPDATE (columnas NOT NULL con CHECK,
// 0002:94-98 / Base:121-125).

// Id de catálogo válido: dígito entero >= 1. "" ⇒ 0 ⇒ falla; "abc" ⇒ NaN ⇒
// falla. El catálogo sembrado existe (#485), pero un <select> vacío o
// manipulado no debe emitir request alguno.
function esIdDeCatalogo(value: string): boolean {
  return Number.isInteger(Number(value)) && Number(value) >= 1;
}

export const productSchema = z.object({
  name: z.string().trim().min(1, "Ingresá el nombre del producto"),
  description: z.string().trim(),
  brand_id: z.string().trim().refine(esIdDeCatalogo, "Elegí una marca"),
  unit_type_id: z.string().trim().refine(esIdDeCatalogo, "Elegí la unidad de medida"),
  category_id: z.string().trim().refine(esIdDeCatalogo, "Elegí una categoría"),
  base_quantity: z
    .string()
    .trim()
    .refine(
      (value) => Number.isFinite(Number(value)) && Number(value) > 0,
      "Ingresá una cantidad mayor a cero",
    ),
  // Columna nullable con CHECK de largo 4-64 (0002:107-108): vacío = sin
  // código; si se informa, se valida el mismo rango del lado cliente para
  // fallar temprano (el índice único normalizado de barcode es de la DB,
  // Base:137-138 — su colisión 23505 cae al fallback amigable de mapError).
  barcode: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || (value.length >= 4 && value.length <= 64),
      "El código debe tener entre 4 y 64 caracteres",
    ),
});

export type ProductFormValues = z.infer<typeof productSchema>;
