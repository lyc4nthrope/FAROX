import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../shared/lib/supabase/client";
import {
  fetchStockOptions,
  registerMovement,
  reverseMovement,
  setPrice,
} from "./api";

vi.mock("../../shared/lib/supabase/client", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const from = supabase.from as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: null, error: null });
});

describe("inventory api — stock paginado", () => {
  it("fetchStockOptions trae marca, código y cantidad para el buscador", async () => {
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn().mockResolvedValue({
        data: [
          {
            product_id: 10,
            quantity: 12,
            product: { name: "Arroz Diana", brand: { name: "Diana" }, barcode: "770123" },
          },
        ],
        error: null,
      }),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.order.mockReturnValue(builder);
    from.mockReturnValue(builder);

    const result = await fetchStockOptions(3);

    expect(builder.select).toHaveBeenCalledWith(
      "product_id,quantity,product:products(name, barcode, brand:brands(name))",
    );
    expect(result.data).toEqual([
      {
        product_id: 10,
        product_name: "Arroz Diana",
        brand: "Diana",
        quantity: 12,
        barcode: "770123",
      },
    ]);
  });
});

describe("inventory api — contrato exacto de las RPC", () => {
  it("una entrada usa register_entry con vencimiento", async () => {
    await registerMovement({
      type: "entry",
      storeId: 3,
      productId: 10,
      quantity: 20,
      unitPrice: 4500,
      motiveId: 2,
      expiryDate: "2026-12-31",
    });
    expect(rpc).toHaveBeenCalledWith("register_entry", {
      p_product: 10,
      p_store: 3,
      p_qty: 20,
      p_motive_id: 2,
      p_order_id: null,
      p_expiry_date: "2026-12-31",
      p_unit_price: 4500,
    });
  });

  it("una salida usa register_exit y nunca envía vencimiento", async () => {
    await registerMovement({
      type: "exit",
      storeId: 3,
      productId: 10,
      quantity: 12,
      unitPrice: null,
      motiveId: 1,
      expiryDate: "2026-12-31",
    });
    expect(rpc).toHaveBeenCalledWith("register_exit", {
      p_product: 10,
      p_store: 3,
      p_qty: 12,
      p_motive_id: 1,
      p_order_id: null,
      p_unit_price: null,
    });
  });

  it("reverso y precio con sus parámetros", async () => {
    await reverseMovement(44, "error de digitación");
    expect(rpc).toHaveBeenCalledWith("register_reverse", {
      p_movement_id: 44,
      p_reason: "error de digitación",
    });
    await setPrice(3, 10, 2500);
    expect(rpc).toHaveBeenCalledWith("set_price", {
      p_product: 10,
      p_store: 3,
      p_price: 2500,
      p_currency: "COP",
    });
  });

  it("devuelve el error crudo (stock insuficiente) sin transformarlo", async () => {
    const error = { message: "stock insuficiente o fila inexistente (producto 10, tienda 3)" };
    rpc.mockResolvedValue({ data: null, error });
    const result = await registerMovement({
      type: "exit",
      storeId: 3,
      productId: 10,
      quantity: 99,
      unitPrice: null,
      motiveId: 1,
      expiryDate: null,
    });
    expect(result.error).toBe(error);
  });
});
