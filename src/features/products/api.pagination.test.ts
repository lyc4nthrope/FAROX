import { beforeEach, describe, expect, it, vi } from "vitest";

// Los tres fetchers del catálogo deben paginar con .range() + count 'planned':
// un .limit() fijo truncaría en silencio (S4 exige poder llegar a TODOS los
// productos del registro). Además, los filtros del catálogo del operador viajan
// al servidor (S3/S8): filtrar solo la página cargada escondería el resto.
// Este test pinea el contrato de red, no la UI.
const h = vi.hoisted(() => {
  const calls: Array<Record<string, unknown>> = [];
  const result = { data: [] as unknown[], count: 0, error: null };
  function makeQuery() {
    const query: Record<string, unknown> = {};
    query.select = (select: string, options?: unknown) => {
      calls.push({ op: "select", select, options });
      return query;
    };
    query.eq = (column: string, value: unknown) => {
      calls.push({ op: "eq", column, value });
      return query;
    };
    query.ilike = (column: string, value: unknown) => {
      calls.push({ op: "ilike", column, value });
      return query;
    };
    query.order = (column: string) => {
      calls.push({ op: "order", column });
      return query;
    };
    query.range = (from: number, to: number) => {
      calls.push({ op: "range", from, to });
      return Promise.resolve(result);
    };
    return query;
  }
  return { calls, makeQuery, result };
});

vi.mock("../../shared/lib/supabase/client", () => ({
  supabase: { from: vi.fn(() => h.makeQuery()), rpc: vi.fn() },
}));

import {
  fetchActiveProductsForCatalog,
  fetchDistributorCatalog,
  fetchStoreCatalog,
} from "./api";

const NO_FILTERS = { q: "", categoryId: null, onlyShortage: false };
const SECOND_PAGE = { page: 1, pageSize: 25 };

describe("catálogo: los tres fetchers paginan (S4)", () => {
  beforeEach(() => {
    h.calls.length = 0;
  });

  it("fetchStoreCatalog: filtra por tienda y pide el rango de la página", async () => {
    expect(await fetchStoreCatalog(7, { ...SECOND_PAGE, ...NO_FILTERS })).toEqual({
      rows: [],
      count: 0,
      error: null,
    });
    expect(h.calls).toContainEqual({
      op: "select",
      select: expect.stringContaining("product_id, quantity"),
      options: { count: "planned" },
    });
    expect(h.calls).toContainEqual({ op: "eq", column: "store_id", value: 7 });
    expect(h.calls).toContainEqual({ op: "range", from: 25, to: 49 });
  });

  it("fetchDistributorCatalog: pide el rango de la página", async () => {
    expect(await fetchDistributorCatalog(SECOND_PAGE)).toEqual({
      rows: [],
      count: 0,
      error: null,
    });
    expect(h.calls).toContainEqual({
      op: "select",
      select: expect.stringContaining("product_id"),
      options: { count: "planned" },
    });
    expect(h.calls).toContainEqual({ op: "range", from: 25, to: 49 });
  });

  it("fetchActiveProductsForCatalog: solo activos, en rango", async () => {
    expect(await fetchActiveProductsForCatalog({ ...SECOND_PAGE, ...NO_FILTERS })).toEqual({
      rows: [],
      count: 0,
      error: null,
    });
    expect(h.calls).toContainEqual({ op: "eq", column: "is_active", value: true });
    expect(h.calls).toContainEqual({ op: "range", from: 25, to: 49 });
    expect(h.calls.find((call) => call.op === "select")?.options).toEqual({
      count: "planned",
    });
  });

  it("el catálogo de tienda resuelve búsqueda, categoría y faltantes en el servidor", async () => {
    await fetchStoreCatalog(7, {
      page: 0,
      pageSize: 25,
      q: "  café  ",
      categoryId: 3,
      onlyShortage: true,
    });

    expect(h.calls).toContainEqual({
      op: "ilike",
      column: "product.name",
      value: "%café%",
    });
    expect(h.calls).toContainEqual({ op: "eq", column: "product.category_id", value: 3 });
    expect(h.calls).toContainEqual({ op: "eq", column: "is_shortage", value: true });
  });

  it("el registro global busca por nombre en el servidor y por categoría", async () => {
    await fetchActiveProductsForCatalog({
      page: 0,
      pageSize: 25,
      q: "arroz",
      categoryId: 5,
      onlyShortage: false,
    });

    expect(h.calls).toContainEqual({ op: "ilike", column: "name", value: "%arroz%" });
    expect(h.calls).toContainEqual({ op: "eq", column: "category_id", value: 5 });
  });

  it("escapa los comodines de LIKE para que la búsqueda sea literal", async () => {
    await fetchActiveProductsForCatalog({
      page: 0,
      pageSize: 25,
      q: "50%_off",
      categoryId: null,
      onlyShortage: false,
    });

    expect(h.calls).toContainEqual({
      op: "ilike",
      column: "name",
      value: "%50\\%\\_off%",
    });
  });

  it("sin filtros no agrega cláusulas ilike ni de categoría", async () => {
    await fetchStoreCatalog(7, { page: 0, pageSize: 25, ...NO_FILTERS });

    expect(h.calls.some((call) => call.op === "ilike")).toBe(false);
    expect(h.calls.some((call) => call.column === "product.category_id")).toBe(false);
    expect(h.calls.some((call) => call.column === "is_shortage")).toBe(false);
  });
});
