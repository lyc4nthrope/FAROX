import { describe, expect, it } from "vitest";

import {
  CATALOG_DEFINITIONS,
  getCatalogDefinition,
  type CatalogDefinition,
} from "./definitions";
import { productCategorySchema } from "./schemas";
import type { CatalogKey } from "./types";

// sdd/admin-console T-C4: la config es el MOTOR (D-M1, design #599 §1) —
// cada definition debe traer TODO lo que las pantallas genéricas consumen
// (schema + columns + deleteMode + fields + toDbRow), y el deleteMode de
// cada tabla debe reflejar SU policy (0006:66-120), nunca una decisión de
// código.

const KEYS: CatalogKey[] = [
  "unit_types",
  "store_types",
  "brands",
  "product_categories",
];

function definitionDe(key: CatalogKey): CatalogDefinition {
  const found = CATALOG_DEFINITIONS.find((definition) => definition.key === key);
  expect(found, `definition de ${key}`).toBeDefined();
  return found as CatalogDefinition;
}

describe("CATALOG_DEFINITIONS — configs completas ×4 (T-C4)", () => {
  it("cubre exactamente las 4 claves del motor, sin duplicados", () => {
    expect(CATALOG_DEFINITIONS.map((definition) => definition.key)).toEqual(
      expect.arrayContaining(KEYS),
    );
    expect(CATALOG_DEFINITIONS).toHaveLength(4);
  });

  it.each(KEYS)(
    "%s: schema, columns, fields, deleteMode, select, emptyTitle y toDbRow completos",
    (key) => {
      const definition = definitionDe(key);
      expect(definition.schema).toBeDefined();
      expect(definition.columns.length).toBeGreaterThan(0);
      expect(definition.columns[0].key).toBe("name"); // la primera col SIEMPRE es el nombre
      expect(definition.fields.length).toBeGreaterThan(0);
      expect(definition.deleteMode === "hard" || definition.deleteMode === "soft-two-step").toBe(true);
      expect(definition.select.length).toBeGreaterThan(0);
      expect(definition.emptyTitle.length).toBeGreaterThan(0);
      expect(typeof definition.toDbRow).toBe("function");
      // Cada field tiene su columna de server en el select (D4): el form no
      // puede pedir un dato que el listado no trae.
      for (const field of definition.fields) {
        expect(definition.select).toContain(field.key);
      }
    },
  );

  it("deleteMode = el dictado por la POLICY de cada tabla (0006:66-120)", () => {
    // brands: DELETE admin SOLO sobre is_active = false (0006:95-97) ⇒ two-step.
    expect(definitionDe("brands").deleteMode).toBe("soft-two-step");
    // unit_types (0006:73-74), store_types (0006:83-84) y product_categories
    // (0006:119-120) son HARD admin — product_categories SIN is_active
    // (CORRECCIÓN de mandato: soft-delete SOLO en brands).
    expect(definitionDe("unit_types").deleteMode).toBe("hard");
    expect(definitionDe("store_types").deleteMode).toBe("hard");
    expect(definitionDe("product_categories").deleteMode).toBe("hard");
  });

  it("solo brands expone la columna is_active (las otras 3 no la tienen)", () => {
    const conIsActive = CATALOG_DEFINITIONS.filter((definition) =>
      definition.select.includes("is_active"),
    ).map((definition) => definition.key);
    expect(conIsActive).toEqual(["brands"]);
  });
});

describe("getCatalogDefinition — resolución de :catalogKey (design key-decision #4)", () => {
  it.each(KEYS)("resuelve la clave válida %s", (key) => {
    expect(getCatalogDefinition(key)?.key).toBe(key);
  });

  it("clave inválida ⇒ undefined (la página renderiza <NotFound/>)", () => {
    expect(getCatalogDefinition("no_existe")).toBeUndefined();
    expect(getCatalogDefinition("")).toBeUndefined();
  });
});

describe("toDbRow — conversión de vacío a NULL en columnas nullable (0002:63-64)", () => {
  it("product_categories: description y parent_id vacíos viajan NULL", () => {
    const definition = definitionDe("product_categories");
    expect(
      definition.toDbRow({ name: "Snacks", description: "", parent_id: "" }),
    ).toEqual({ name: "Snacks", description: null, parent_id: null });
  });

  it("product_categories: parent_id elegido viaja numérico", () => {
    const definition = definitionDe("product_categories");
    expect(
      definition.toDbRow({ name: "Refrescos", description: "Gaseosas", parent_id: "1" }),
    ).toEqual({ name: "Refrescos", description: "Gaseosas", parent_id: 1 });
  });

  it("unit_types: payload exacto de las 3 columnas NOT NULL (0002:31-33)", () => {
    const definition = definitionDe("unit_types");
    expect(
      definition.toDbRow({ name: "Galón", abbreviation: "gal", category: "volumen" }),
    ).toEqual({ name: "Galón", abbreviation: "gal", category: "volumen" });
  });
});

describe("schemas del motor — name vacío bloquea en las 4 (ADM-9.5)", () => {
  it.each(KEYS)("%s: nombre vacío ⇒ issues de Zod", (key) => {
    const definition = definitionDe(key);
    const vacios: Record<string, string> = {};
    for (const field of definition.fields) vacios[field.key] = "";
    const parsed = definition.schema.safeParse(vacios);
    expect(parsed.success).toBe(false);
  });

  it("product_categories: válidos ⇒ toDbRow recibe los datos parseados", () => {
    const parsed = productCategorySchema.safeParse({
      name: "  Snacks  ",
      description: "  Salados  ",
      parent_id: "1",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // trim de Zod: el payload viaja limpio (convención del repo).
    expect(parsed.data.name).toBe("Snacks");
    expect(parsed.data.description).toBe("Salados");
  });
});
