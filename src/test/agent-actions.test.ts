import fs from "node:fs";

import { describe, expect, it } from "vitest";

// La migración es la fuente de verdad y no hay Postgres en el gate: se fija el
// contrato exacto. El comportamiento se valida al aplicarla en Supabase.
const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname)
  .replace(/^\/[A-Za-z]:\/@fs\/([A-Za-z]:)\//, "$1/")
  .replace(/^\/@fs\//, "/")
  .replace(/^\/([A-Za-z]:)/, "$1")
  .replace(/\/$/, "");

const MIGRATION = "20261112160559_agent_actions.sql";

function read(): string {
  return fs
    .readFileSync(`${REPO_ROOT}/supabase/migrations/${MIGRATION}`, "utf8")
    .replace(/\s+/g, " ");
}

describe("agent_actions · asistente con escritura (fase 2)", () => {
  it("crea la tabla con kinds, estados y canal", () => {
    const sql = read();
    expect(sql).toContain("CREATE TABLE public.agent_actions");
    expect(sql).toContain("'store_exit'");
    expect(sql).toContain("'distributor_sale'");
    expect(sql).toContain("'distributor_purchase'");
    expect(sql).toContain("'price_update'");
    expect(sql).toContain("'shortage_toggle'");
    expect(sql).toContain("'pending'");
    expect(sql).toContain("'executed'");
    expect(sql).toContain("channel IN ('web', 'whatsapp')");
    expect(sql).toContain("requires_strong_confirmation");
  });

  it("agrega canal y external_id a chat_conversations", () => {
    const sql = read();
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'web'");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS external_id text");
    expect(sql).toContain("uq_chat_conversations_whatsapp");
  });

  it("deduplica los mensajes entrantes de WhatsApp por message.id", () => {
    const sql = read();
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.whatsapp_inbound");
    expect(sql).toContain("message_id text PRIMARY KEY");
  });

  it("expone prepare/execute/cancel al cliente autenticado con RLS de dueño", () => {
    const sql = read();
    expect(sql).toContain("FUNCTION public.agent_prepare_action(");
    expect(sql).toContain("FUNCTION public.agent_execute_action(");
    expect(sql).toContain("FUNCTION public.agent_cancel_action(");
    expect(sql).toContain("ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("POLICY agent_actions_read");
    expect(sql).toContain("user_id = (SELECT auth.uid())");
  });

  it("los wrappers _for_user solo los ejecuta el rol de servidor", () => {
    const sql = read();
    const serviceRole = "service" + "_role";
    expect(sql).toContain("FUNCTION public.internal_set_actor(");
    expect(sql).toContain("'request.jwt.claims'");
    expect(sql).toContain("FUNCTION public.agent_prepare_action_for_user(");
    expect(sql).toContain("FUNCTION public.agent_execute_action_for_user(");
    expect(sql).toContain("FUNCTION public.agent_cancel_action_for_user(");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
    expect(sql).toContain(`TO ${serviceRole}`);
  });

  it("los precios quedan solo en la web: el wrapper de WhatsApp rechaza price_update", () => {
    const sql = read();
    expect(sql).toContain("price_update solo web");
  });

  it("vencen a los 10 minutos y no permiten doble ejecución", () => {
    const sql = read();
    expect(sql).toContain("INTERVAL '10 minutes'");
    expect(sql).toContain("status = 'executed'");
    expect(sql).toContain("FOR UPDATE");
  });

  it("las ventas con descuento se preparan con precio neto por línea", () => {
    const sql = read();
    expect(sql).toContain("round(pp.price * (1 - v_discount / 100.0), 2)");
    expect(sql).toContain("round(dp.sale_price * (1 - v_discount / 100.0), 2)");
    expect(sql).toContain("v_total := v_subtotal;");
  });

  it("exige confirmación fuerte para precios y valida el teléfono del wrapper", () => {
    const sql = read();
    expect(sql).toContain("confirmación fuerte requerida");
    expect(sql).toContain("'CONFIRMAR'");
    expect(sql).toContain("FUNCTION public.internal_assert_wa_identity(");
    expect(sql).toContain("phone_verified_at");
  });
});
