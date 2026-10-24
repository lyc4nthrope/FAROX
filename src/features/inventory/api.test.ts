import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../shared/lib/supabase/client";
import { assignProduct, registerMovement, reverseMovement, setPrice } from "./api";

vi.mock("../../shared/lib/supabase/client", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: null, error: null });
});

describe("inventory api — contrato exacto de las RPC", () => {
  it("assign_product_to_store con umbral nulo cuando no se indica", async () => {
    await assignProduct(3, 10, null);
    expect(rpc).toHaveBeenCalledWith("assign_product_to_store", {
      p_product: 10,
      p_store: 3,
      p_threshold: null,
    });
  });

  it("una entrada usa register_entry con vencimiento", async () => {
    await registerMovement({ type: "entry", storeId: 3, productId: 10, quantity: 20, motiveId: 2, expiryDate: "2026-12-31" });
    expect(rpc).toHaveBeenCalledWith("register_entry", {
      p_product: 10,
      p_store: 3,
      p_qty: 20,
      p_motive_id: 2,
      p_order_id: null,
      p_expiry_date: "2026-12-31",
    });
  });

  it("una salida usa register_exit y nunca envía vencimiento", async () => {
    await registerMovement({ type: "exit", storeId: 3, productId: 10, quantity: 12, motiveId: 1, expiryDate: "2026-12-31" });
    expect(rpc).toHaveBeenCalledWith("register_exit", {
      p_product: 10,
      p_store: 3,
      p_qty: 12,
      p_motive_id: 1,
      p_order_id: null,
    });
  });

  it("reverso y precio con sus parámetros", async () => {
    await reverseMovement(44, "error de digitación");
    expect(rpc).toHaveBeenCalledWith("register_reverse", { p_movement_id: 44, p_reason: "error de digitación" });
    await setPrice(3, 10, 2500);
    expect(rpc).toHaveBeenCalledWith("set_price", { p_product: 10, p_store: 3, p_price: 2500, p_currency: "COP" });
  });

  it("devuelve el error crudo (stock insuficiente) sin transformarlo", async () => {
    const error = { message: "stock insuficiente o fila inexistente (producto 10, tienda 3)" };
    rpc.mockResolvedValue({ data: null, error });
    const result = await registerMovement({ type: "exit", storeId: 3, productId: 10, quantity: 99, motiveId: 1, expiryDate: null });
    expect(result.error).toBe(error);
  });
});
