import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../shared/lib/supabase/client";
import {
  fetchLinkedDistributorOptions,
  fetchLinkedDistributors,
  fetchMyStoreOptions,
  fetchStoreDistributorProducts,
} from "./api";

vi.mock("../../shared/lib/supabase/client", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const from = supabase.from as unknown as ReturnType<typeof vi.fn>;

type Result = { data?: unknown; error?: unknown };
type Mock = ReturnType<typeof vi.fn>;

function chain(result: Result) {
  const stub = {} as Record<string, Mock> & {
    then: (ok?: (value: unknown) => unknown, err?: (reason: unknown) => unknown) => Promise<unknown>;
  };
  for (const method of ["select", "in", "eq", "order", "limit"]) {
    stub[method] = vi.fn(() => stub);
  }
  stub.then = (ok, err) => Promise.resolve(result).then(ok, err);
  return stub;
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [], error: null });
  from.mockImplementation(() => chain({ data: [], error: null }));
});

describe("store-links api · tiendas y distribuidores vinculados", () => {
  it("fetchMyStoreOptions usa my_store_ids y filtra las tiendas activas", async () => {
    rpc.mockResolvedValue({ data: [3, "5", null, 0], error: null });
    const stores = chain({
      data: [
        { id: 3, name: "Tienda Centro" },
        { id: 5, name: "Tienda Norte" },
      ],
      error: null,
    });
    from.mockReturnValue(stores);

    const result = await fetchMyStoreOptions();

    expect(rpc).toHaveBeenCalledWith("my_store_ids");
    expect(from).toHaveBeenCalledWith("stores");
    expect(stores.select).toHaveBeenCalledWith("id,name");
    expect(stores.in).toHaveBeenCalledWith("id", [3, 5]);
    expect(stores.eq).toHaveBeenCalledWith("is_active", true);
    expect(result).toEqual({
      data: [
        { id: 3, name: "Tienda Centro" },
        { id: 5, name: "Tienda Norte" },
      ],
      error: null,
    });
  });

  it("fetchMyStoreOptions sin tiendas no consulta stores", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await expect(fetchMyStoreOptions()).resolves.toEqual({ data: [], error: null });
    expect(from).not.toHaveBeenCalled();
  });

  it("fetchLinkedDistributors mapea la relación embebida y la fecha", async () => {
    const query = chain({
      data: [
        {
          distributor_id: 7,
          created_at: "2026-10-25T12:00:00Z",
          distributor: { name: "Distribuidora Andes" },
        },
      ],
      error: null,
    });
    from.mockReturnValue(query);

    const result = await fetchLinkedDistributors(3);

    expect(from).toHaveBeenCalledWith("store_distributors");
    expect(query.eq).toHaveBeenCalledWith("store_id", 3);
    expect(result.data).toEqual([
      {
        distributor_id: 7,
        name: "Distribuidora Andes",
        created_at: "2026-10-25T12:00:00Z",
      },
    ]);
  });

  it("fetchLinkedDistributorOptions reduce los vínculos a opciones id/nombre", async () => {
    const query = chain({
      data: [
        {
          distributor_id: 7,
          created_at: "2026-10-25T12:00:00Z",
          distributor: { name: "Distribuidora Andes" },
        },
      ],
      error: null,
    });
    from.mockReturnValue(query);

    await expect(fetchLinkedDistributorOptions(3)).resolves.toEqual({
      data: [{ id: 7, name: "Distribuidora Andes" }],
      error: null,
    });
  });

  it("fetchStoreDistributorProducts llama la RPC de intersección y conserva price null", async () => {
    rpc.mockResolvedValue({
      data: [
        { product_id: 10, name: "Arroz", price: 4500 },
        { product_id: 11, name: "Aceite", price: null },
      ],
      error: null,
    });

    const result = await fetchStoreDistributorProducts(3, 7);

    expect(rpc).toHaveBeenCalledWith("list_store_distributor_products", {
      p_store: 3,
      p_distributor: 7,
    });
    expect(result).toEqual({
      data: [
        { id: 10, name: "Arroz", price: 4500 },
        { id: 11, name: "Aceite", price: null },
      ],
      error: null,
    });
  });
});
