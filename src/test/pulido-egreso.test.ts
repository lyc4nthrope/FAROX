import fs from "node:fs";

import { describe, expect, it } from "vitest";

// La migración es la fuente de verdad y no hay Postgres en el gate: se fija el
// contrato exacto. El comportamiento se valida al aplicarla en Supabase.
const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname)
  .replace(/^\/[A-Za-z]:\/@fs\/([A-Za-z]:)\//, "$1/")
  .replace(/^\/@fs\//, "/")
  .replace(/^\/([A-Za-z]:)/, "$1")
  .replace(/\/$/, "");

function read(name: string): string {
  return fs.readFileSync(`${REPO_ROOT}/supabase/migrations/${name}`, "utf8").replace(/\s+/g, " ");
}

const M48 = "20261105000048_pulido_egreso_y_telefono.sql";

describe("0048 · egreso, teléfono y privilegios", () => {
  it("existe y declara pgcrypto antes de usarlo", () => {
    expect(fs.existsSync(`${REPO_ROOT}/supabase/migrations/${M48}`)).toBe(true);
    const sql = read(M48);
    expect(sql).toContain("SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'");
    expect(sql).toContain("CREATE EXTENSION pgcrypto WITH SCHEMA extensions");
  });

  it("cerró el EXECUTE público de las funciones internas de 0045", () => {
    const sql = read(M48);
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.internal_user_margin_pct(uuid) FROM PUBLIC, anon, authenticated",
    );
  });

  it("el cliente no puede leer chat_messages.payload (egreso)", () => {
    const sql = read(M48);
    expect(sql).toContain("REVOKE SELECT ON public.chat_messages FROM authenticated, anon;");
    expect(sql).toContain(
      "GRANT SELECT (id, conversation_id, role, content, created_at) ON public.chat_messages TO authenticated;",
    );
    expect(sql).not.toContain(
      "GRANT SELECT (id, conversation_id, role, content, created_at, payload)",
    );
  });

  it("el rate limit cuenta por created_at y no por conversación", () => {
    const sql = read(M48);
    expect(sql).toContain("DROP INDEX IF EXISTS public.idx_chat_messages_user_rate;");
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS idx_chat_messages_user_hour ON public.chat_messages (created_at) WHERE role = 'user';",
    );
    expect(sql).toContain(
      "AND cm.conversation_id IN ( SELECT cc.id FROM public.chat_conversations cc WHERE cc.user_id = auth.uid() )",
    );
  });

  it("un ticket hace UN upsert de dashboard_daily", () => {
    const sql = read(M48);
    expect(sql).toContain("IF current_setting('farox.batch_dashboard', true) = 'on' THEN RETURN;");
    expect(sql).toContain("PERFORM set_config('farox.batch_dashboard', 'on', true);");
    expect(sql).toContain("PERFORM set_config('farox.batch_dashboard', 'off', true);");
    expect(sql).toContain("WHERE m.id = ANY (v_ids);");
    expect(sql).toContain("PERFORM public.internal_dashboard_upsert(0, v_in_count, v_out_count,");
  });

  it("normaliza fijos 60x y respeta el prefijo explícito", () => {
    const sql = read(M48);
    expect(sql).toContain("IF left(v_raw, 1) = '+' THEN");
    expect(sql).toContain("AND (left(v_digits, 1) = '3' OR left(v_digits, 2) = '60') THEN");
    expect(sql).toContain("phone: falta el prefijo internacional");
  });

  it("un solo trigger normaliza y limpia la verificación", () => {
    const sql = read(M48);
    expect(sql).toContain(
      "DROP TRIGGER IF EXISTS trg_users_clear_phone_verification ON public.users;",
    );
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF phone_number ON public.users");
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.clear_phone_verification_on_change();");
  });
});

describe("0043-0047 · correcciones de lote y precios", () => {
  it("0043 valida el lote en una consulta y ordena los locks", () => {
    const sql = read("20261105000043_precios_masivos.sql");
    expect(sql).toContain("cada línea necesita product_id");
    expect(sql).toContain("SELECT x.product_id INTO v_missing");
    expect(sql).toContain("ORDER BY x.product_id");
  });

  it("0046 distingue costo aprendido de manual y no publica en merma", () => {
    const sql = read("20261105000046_margen_por_producto_y_costo_manual.sql");
    expect(sql).toContain("AND x.unit_cost = dp.purchase_price");
    expect(sql).toContain("v_restock := EXISTS (");
    expect(sql).toContain("IF v_restock THEN");
    expect(sql).toContain("internal_store_owner_is_premium(o.store_id)");
  });

  it("0047 ordena los locks y fija el origen de un costo confirmado", () => {
    const sql = read("20261105000047_precios_masivos_distribuidor.sql");
    expect(sql).toContain("ORDER BY x.product_id");
    expect(sql).toContain("WHEN dp.purchase_price_source IS NULL THEN 'manual'");
  });
});

describe("0053 · correcciones de PR review", () => {
  const M53 = "20261113125000_review_fixes.sql";

  it("serializa send_message por usuario con pg_advisory_xact_lock", () => {
    const sql = read(M53);
    expect(sql).toContain("pg_advisory_xact_lock(pg_catalog.hashtext(v_user::text))");
  });

  it("antepone '+' al wa_id en phone_verification_confirm_whatsapp", () => {
    const sql = read(M53);
    expect(sql).toContain("normalize_phone_e164('+' || ltrim(btrim(COALESCE(p_wa_id, '')), '+'))");
  });

  it("programa la purga diaria de whatsapp_inbound en pg_cron", () => {
    const sql = read(M53);
    expect(sql).toContain("farox_whatsapp_inbound_purge");
    expect(sql).toContain("DELETE FROM public.whatsapp_inbound");
  });
});
