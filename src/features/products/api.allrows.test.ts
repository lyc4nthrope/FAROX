import { describe, expect, it, vi } from "vitest";

// Una tienda con más de 500 productos con precio: el editor recibía solo los
// primeros 500 y mostraba el resto "sin precio" (auditoría S9). Cada tabla
// simula PostgREST: respeta .range() y nunca devuelve más de lo pedido.
const h = vi.hoisted(() => {
  const TOTAL = 501;
  function rowsFor(table: string, from: number, to: number) {
    const ids = Array.from({ length: TOTAL }, (_, i) => i + 1).slice(from, to + 1);
    if (table === "price_publications") return ids.map((id) => ({ product_id: id, price: 1000 }));
    if (table === "store_product_prices")
      return ids.map((id) => ({ product_id: id, purchase_price: 700 }));
    return [];
  }
  function makeQuery(table: string) {
    const query: Record<string, unknown> = {};
    for (const op of ["select", "eq", "order"]) query[op] = () => query;
    query.limit = (n: number) => Promise.resolve({ data: rowsFor(table, 0, n - 1), error: null });
    query.range = (from: number, to: number) =>
      Promise.resolve({ data: rowsFor(table, from, to), error: null });
    return query;
  }
  return { makeQuery };
});

vi.mock("../../shared/lib/supabase/client", () => ({
  supabase: { from: vi.fn((table: string) => h.makeQuery(table)), rpc: vi.fn() },
}));

import { fetchStorePurchasePrices, fetchStoreRelationPrices } from "./api";

describe("precios de tiendas con más de 500 productos", () => {
  it("fetchStoreRelationPrices trae el producto 501 con sus precios", async () => {
    const { data, error } = await fetchStoreRelationPrices(7);

    expect(error).toBeNull();
    expect(data).toHaveLength(501);
    expect(data?.find((row) => row.product_id === 501)).toMatchObject({
      sale_price: 1000,
      purchase_price: 700,
    });
  });

  it("fetchStorePurchasePrices trae el producto 501", async () => {
    const { data } = await fetchStorePurchasePrices(7);

    expect(data?.get(501)).toBe(700);
  });
});
