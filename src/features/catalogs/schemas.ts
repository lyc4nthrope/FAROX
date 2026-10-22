import { z } from "zod";

// sdd/admin-console T-C4 (design #599 §2.5). Zod valida ANTES de cualquier
// request: input inválido ⇒ CERO invocaciones de red (convención global,
// ProductFormPage.test.tsx:201-229). ADM-9.5: el name vacío en CUALQUIERA
// de las 4 pantallas bloquea el submit con cero llamadas.
// Campos FK/vaciables viajan como strings (valores crudos de <input>/<select>,
// convención productSchema); toDbRow de cada definition convierte "" ⇒ NULL
// en las columnas nullable (0002:63-64).

// ADM-9.5 · unit_types: name y abbreviation UNIQUE (0002:31/35), category
// NOT NULL (0002:33) — seeds 0005:28-32.
export const unitTypeSchema = z.object({
  name: z.string().trim().min(1, "Ingresá el nombre del tipo de unidad"),
  abbreviation: z.string().trim().min(1, "Ingresá la abreviatura"),
  category: z.string().trim().min(1, "Ingresá la categoría"),
});

// ADM-9.5 · store_types: name UNIQUE NOT NULL (0002:22) — seed 0005:36-38.
export const storeTypeSchema = z.object({
  name: z.string().trim().min(1, "Ingresá el nombre del tipo de tienda"),
});

// ADM-9.5 · brands: name UNIQUE NOT NULL (0002:51). is_active NO es campo
// del form: la alta nace activa y la baja es la acción «Desactivar» de la
// tabla (ADM-9.2, policy 0006:95-97).
export const brandSchema = z.object({
  name: z.string().trim().min(1, "Ingresá el nombre de la marca"),
});

// ADM-9.5 · product_categories: name UNIQUE NOT NULL (0002:62), description
// nullable, parent_id self-FK nullable ON DELETE SET NULL (0002:64) — SIN
// is_active (CORRECCIÓN de mandato: soft-delete SOLO en brands).
export const productCategorySchema = z.object({
  name: z.string().trim().min(1, "Ingresá el nombre de la categoría"),
  description: z.string().trim(),
  // "" = sin padre (válida: el catálogo plano es legítimo, 0002:64).
  parent_id: z.string().trim(),
});

/** Valores genéricos del form: todos los campos del motor son strings. */
export type CatalogFormValues = Record<string, string>;

/** Errores por campo del form genérico (flatten() de Zod). */
export type CatalogFormErrors = Record<string, string | undefined>;
