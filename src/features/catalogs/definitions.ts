import { z } from "zod";

import {
  brandSchema,
  productCategorySchema,
  storeTypeSchema,
  unitTypeSchema,
  type CatalogFormValues,
} from "./schemas";
import type { CatalogKey, CatalogRow } from "./types";

// sdd/admin-console T-C4 · D-M1 (design #599 §1): ESTE archivo es la
// decisión arquitectónica del lote — 4 pantallas de catálogo por el costo
// de UN motor. La variación entre tablas (columnas, zod, deleteMode) vive
// acá como DATOS; CatalogCrudPage/CatalogTable/CatalogForm son genéricos.
// Policies idénticas (0006:66-120: SELECT libre, DML solo-admin); la ÚNICA
// diferencia de comportamiento es el deleteMode:
// · "hard" — DELETE directo admin (unit_types 0006:73-74, store_types
//   0006:83-84, product_categories 0006:119-120).
// · "soft-two-step" — brands: la policy de DELETE exige is_active = false
//   (0006:95-97) ⇒ la UI primero DESACTIVA y el DELETE real solo purge filas
//   ya desactivadas (patrón STORE-3 / distributors two-step).

/** Cómo se borra en cada tabla — dictado por SU policy, nunca inventado. */
export type CatalogDeleteMode = "hard" | "soft-two-step";

/** Campo del form genérico. "parent" = picker de categoría padre (self-FK). */
export interface CatalogFieldDef {
  key: string;
  label: string;
  kind: "input" | "textarea" | "parent";
}

/** Columna de la tabla genérica. Sin render JSX: display puro (módulo .ts). */
export interface CatalogColumnDef {
  key: string;
  header: string;
  /** Presentación por defecto: String(valor ?? "—"). */
  display?: (row: CatalogRow) => string;
}

export interface CatalogDefinition {
  key: CatalogKey;
  /** Título del catálogo (nav, cabecera, form). */
  label: string;
  /** Columnas EXPLÍCITAS del select de listado (D4 — jamás "*"). */
  select: string;
  schema: z.ZodType<CatalogFormValues>;
  fields: CatalogFieldDef[];
  columns: CatalogColumnDef[];
  deleteMode: CatalogDeleteMode;
  emptyTitle: string;
  /** Fila del form (strings) → payload de DB ("" ⇒ NULL en cols nullable). */
  toDbRow: (values: CatalogFormValues) => Record<string, unknown>;
}

export const CATALOG_DEFINITIONS: readonly CatalogDefinition[] = [
  {
    key: "unit_types",
    label: "Tipos de unidad",
    select: "id, name, abbreviation, category",
    schema: unitTypeSchema,
    fields: [
      { key: "name", label: "Nombre", kind: "input" },
      { key: "abbreviation", label: "Abreviatura", kind: "input" },
      { key: "category", label: "Categoría", kind: "input" },
    ],
    columns: [
      { key: "name", header: "Nombre" },
      { key: "abbreviation", header: "Abreviatura" },
      { key: "category", header: "Categoría" },
    ],
    deleteMode: "hard",
    emptyTitle: "Todavía no hay tipos de unidad.",
    toDbRow: (values) => ({
      name: values.name,
      abbreviation: values.abbreviation,
      category: values.category,
    }),
  },
  {
    key: "store_types",
    label: "Tipos de tienda",
    select: "id, name",
    schema: storeTypeSchema,
    fields: [{ key: "name", label: "Nombre", kind: "input" }],
    columns: [{ key: "name", header: "Nombre" }],
    deleteMode: "hard",
    emptyTitle: "Todavía no hay tipos de tienda.",
    toDbRow: (values) => ({ name: values.name }),
  },
  {
    key: "brands",
    label: "Marcas",
    select: "id, name, is_active",
    schema: brandSchema,
    fields: [{ key: "name", label: "Nombre", kind: "input" }],
    columns: [
      { key: "name", header: "Nombre" },
      {
        key: "is_active",
        header: "Estado",
        display: (row) => (row.is_active ? "Activo" : "Inactivo"),
      },
    ],
    deleteMode: "soft-two-step",
    emptyTitle: "Todavía no hay marcas.",
    toDbRow: (values) => ({ name: values.name }),
  },
  {
    key: "product_categories",
    label: "Categorías de producto",
    select: "id, name, description, parent_id, parent:parent_id(name)",
    schema: productCategorySchema,
    fields: [
      { key: "name", label: "Nombre", kind: "input" },
      { key: "description", label: "Descripción", kind: "textarea" },
      { key: "parent_id", label: "Categoría padre", kind: "parent" },
    ],
    columns: [
      { key: "name", header: "Nombre" },
      { key: "description", header: "Descripción" },
      { key: "parent_name", header: "Categoría padre" },
    ],
    deleteMode: "hard",
    emptyTitle: "Todavía no hay categorías.",
    toDbRow: (values) => ({
      name: values.name,
      // description y parent_id son nullable (0002:63-64): "" viaja NULL.
      // Borrar un padre es seguro: los hijos quedan con parent_id NULL
      // (ON DELETE SET NULL, 0002:64 — ADM-9.4).
      description: values.description === "" ? null : values.description,
      parent_id: values.parent_id === "" ? null : Number(values.parent_id),
    }),
  },
];

/** Resuelve una key de URL (/:catalogKey) — inválida ⇒ undefined ⇒ <NotFound/>. */
export function getCatalogDefinition(
  key: string,
): CatalogDefinition | undefined {
  return CATALOG_DEFINITIONS.find((definition) => definition.key === key);
}
