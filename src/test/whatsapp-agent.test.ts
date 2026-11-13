import fs from "node:fs";

import { describe, expect, it } from "vitest";

// Sin Postgres en el gate: se fija el contrato del webhook y del fix de índice.
// El comportamiento se valida con el mensaje real de WhatsApp.
const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname)
  .replace(/^\/[A-Za-z]:\/@fs\/([A-Za-z]:)\//, "$1/")
  .replace(/^\/@fs\//, "/")
  .replace(/^\/([A-Za-z]:)/, "$1")
  .replace(/\/$/, "");

const WEBHOOK = `${REPO_ROOT}/supabase/functions/whatsapp-webhook/index.ts`;
const MIGRATION = `${REPO_ROOT}/supabase/migrations/20261112205203_agent_whatsapp_fix.sql`;

describe("whatsapp assistant", () => {
  it("la conversación se busca por canal + wa_id + usuario, no solo wa_id", () => {
    const source = fs.readFileSync(WEBHOOK, "utf8");
    const body = source.slice(
      source.indexOf("async function getOrCreateConversation"),
      source.indexOf("async function loadHistory"),
    );
    expect(body.match(/\.eq\("user_id", userId\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(body).toContain('.eq("external_id", waId)');
  });

  it("el índice único incluye user_id y el rate limit tiene índice", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8").replace(/\s+/g, " ");
    expect(sql).toContain("(channel, external_id, user_id)");
    expect(sql).toContain("idx_whatsapp_inbound_wa_received");
  });

  it("el webhook corre el asistente por el canal whatsapp con el actor resuelto", () => {
    const source = fs.readFileSync(WEBHOOK, "utf8");
    expect(source).toContain('channel: "whatsapp"');
    expect(source).toContain("actorWaId: from");
    expect(source).toContain("whatsapp_inbound");
    expect(source).toContain("agent_execute_action_for_user");
  });
});
