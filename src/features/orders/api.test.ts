import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../shared/lib/supabase/client";
import { confirmDelivery, createCredit, createOrder, registerPayment, updateOrderStatus } from "./api";

vi.mock("../../shared/lib/supabase/client", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: 7, error: null });
});

describe("orders api — contrato exacto de las RPC", () => {
  it("create_order envía items como [{product_id, quantity}] y devuelve el id", async () => {
    const result = await createOrder({
      distributorId: 2,
      storeId: 3,
      items: [{ product_id: 10, quantity: 24 }],
      expectedAt: null,
      notes: null,
    });
    expect(rpc).toHaveBeenCalledWith("create_order", {
      p_distributor: 2,
      p_store: 3,
      p_items: [{ product_id: 10, quantity: 24 }],
      p_expected_at: null,
      p_notes: null,
    });
    expect(result).toEqual({ data: 7, error: null });
  });

  it("confirm_delivery envía received_quantity por producto", async () => {
    await confirmDelivery(5, [{ product_id: 10, received_quantity: 20 }]);
    expect(rpc).toHaveBeenCalledWith("confirm_delivery", {
      p_order: 5,
      p_items: [{ product_id: 10, received_quantity: 20 }],
    });
  });

  it("update_order_status pasa el motivo al cancelar", async () => {
    await updateOrderStatus(5, "cancelled", "sin stock");
    expect(rpc).toHaveBeenCalledWith("update_order_status", {
      p_order: 5,
      p_status: "cancelled",
      p_reason: "sin stock",
    });
  });

  it("devuelve el error crudo para que la UI lo traduzca con mapError", async () => {
    const error = { message: "sin precio activo para producto 10 en tienda 3" };
    rpc.mockResolvedValue({ data: null, error });
    expect((await createOrder({ distributorId: 1, storeId: 3, items: [], expectedAt: null, notes: null })).error).toBe(error);
  });

  it("fiado: create_credit y register_payment con sus parámetros", async () => {
    await createCredit(5, "2026-12-01");
    expect(rpc).toHaveBeenCalledWith("create_credit", { p_order: 5, p_due_date: "2026-12-01" });
    await registerPayment(9, 1000, "cash");
    expect(rpc).toHaveBeenCalledWith("register_payment", { p_credit: 9, p_amount: 1000, p_method: "cash" });
  });
});
