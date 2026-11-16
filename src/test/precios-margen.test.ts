import fs from "node:fs";

import { describe, expect, it } from "vitest";

// La migración es la fuente de verdad: sin DB local no se puede ejecutar la RPC
// en el gate. Se verifica el contenido exacto; el comportamiento se valida al
// aplicarla en Supabase.
const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname)
  .replace(/^\/[A-Za-z]:\/@fs\/([A-Za-z]:)\//, "$1/")
  .replace(/^\/@fs\//, "/")
  .replace(/^\/([A-Za-z]:)/, "$1")
  .replace(/\/$/, "");

const MIGRATION_PATH = `${REPO_ROOT}/supabase/migrations/20261105000045_margen_ganancia.sql`;

function readMigration(): string {
  return fs.readFileSync(MIGRATION_PATH, "utf8").replace(/\s+/g, " ");
}

describe("0045 · margen de ganancia y precio de venta sugerido", () => {
  it("agrega el margen por usuario con rango válido", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    const sql = readMigration();
    expect(sql).toContain(
      "ALTER TABLE public.users ADD COLUMN IF NOT EXISTS default_margin_pct numeric(6,2) NULL",
    );
    expect(sql).toContain(
      "ADD CONSTRAINT users_default_margin_pct_check CHECK (default_margin_pct IS NULL OR (default_margin_pct >= 0 AND default_margin_pct <= 1000))",
    );
  });

  it("calcula el precio de venta sobre el costo con redondeo al peso", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.internal_sale_price_from_cost( p_cost numeric, p_margin numeric ) RETURNS numeric",
    );
    expect(sql).toContain("ELSE round(p_cost * (1 + p_margin / 100.0), 0)");
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.internal_user_margin_pct(p_user uuid) RETURNS numeric",
    );
    expect(sql).toContain("SELECT u.default_margin_pct FROM public.users u WHERE u.id = p_user;");
  });

  it("solo el dueño de la sesión puede cambiar su margen", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.set_my_margin(p_margin numeric) RETURNS void",
    );
    expect(sql).toContain(
      "UPDATE public.users SET default_margin_pct = p_margin WHERE id = auth.uid();",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.set_my_margin(numeric) TO authenticated",
    );
  });

  it("una entrada con costo sugiere el precio de venta si no hay uno activo", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "internal_sale_price_from_cost(v_cost, public.internal_user_margin_pct(auth.uid()))",
    );
    expect(sql).toContain("ON CONFLICT (store_id, product_id) WHERE is_active DO NOTHING");
  });

  it("la entrega de un pedido aprende el costo y usa el margen de quien lo pidió", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.confirm_delivery( p_order bigint, p_items jsonb ) RETURNS void",
    );
    expect(sql).toContain("INSERT INTO public.store_product_prices");
    expect(sql).toContain("internal_user_margin_pct(o.created_by)");
  });

  it("el distribuidor recibe el precio de venta sugerido sin pisar el suyo", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "sale_price = CASE WHEN dp.sale_price IS NULL THEN internal_sale_price_from_cost(v_line.unit_price, public.internal_user_margin_pct(auth.uid())) ELSE dp.sale_price END,",
    );
  });
});
