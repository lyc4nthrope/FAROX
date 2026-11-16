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

const MIGRATION_PATH = `${REPO_ROOT}/supabase/migrations/20261105000044_autollenado_precios.sql`;

function readMigration(): string {
  return fs.readFileSync(MIGRATION_PATH, "utf8").replace(/\s+/g, " ");
}

describe("0044 · autollenado de precios desde movimientos", () => {
  it("existe y agrega los overloads con el precio a publicar", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.register_entry( p_product bigint, p_store bigint, p_qty numeric(12,3), p_motive_id bigint, p_order_id bigint, p_expiry_date date, p_unit_price numeric(12,2), p_fill_price numeric(12,2) ) RETURNS bigint",
    );
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.register_exit( p_product bigint, p_store bigint, p_qty numeric(12,3), p_motive_id bigint, p_order_id bigint, p_unit_price numeric(12,2), p_fill_price numeric(12,2) ) RETURNS bigint",
    );
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog, public");
  });

  it("la entrada solo aprende de un costo real (informado o de pedido)", () => {
    const sql = readMigration();
    // El fallback al precio de venta NO es un costo: no debe autollenarse.
    expect(sql).toContain(
      "IF v_fill IS NULL AND (p_unit_price IS NOT NULL OR p_order_id IS NOT NULL) THEN v_fill := v_price; END IF;",
    );
    expect(sql).toContain("m.name = 'reabastecimiento'");
    expect(sql).toContain("INSERT INTO public.store_product_prices");
    expect(sql).toContain("ON CONFLICT (store_id, product_id) DO NOTHING");
  });

  it("la salida solo publica en ventas y nunca pisa un precio activo", () => {
    const sql = readMigration();
    expect(sql).toContain("m.name = 'venta'");
    expect(sql).toContain("p_order_id IS NULL");
    expect(sql).toContain("INSERT INTO public.price_publications");
    expect(sql).toContain("ON CONFLICT (store_id, product_id) WHERE is_active DO NOTHING");
    expect(sql).toContain(
      "IF v_fill IS NULL AND p_unit_price IS NOT NULL THEN v_fill := v_price; END IF;",
    );
  });

  it("el ticket con descuento publica el precio de lista, no el neto", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "IF p_discount IS NOT NULL AND p_discount > 0 AND p_discount < 100 THEN v_fill := round(v_line.unit_price / (1 - p_discount / 100.0), 2);",
    );
    expect(sql).toContain("p_fill_price => v_fill");
  });

  it("conserva las firmas viejas delegando en las nuevas", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "RETURN public.register_entry(p_product, p_store, p_qty, p_motive_id, p_order_id, p_expiry_date, p_unit_price, NULL);",
    );
    expect(sql).toContain(
      "RETURN public.register_exit(p_product, p_store, p_qty, p_motive_id, p_order_id, p_unit_price, NULL);",
    );
  });

  it("las firmas nuevas traen su GRANT explícito (deny-by-default de 0011)", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.register_entry(bigint, bigint, numeric, bigint, bigint, date, numeric, numeric), public.register_exit(bigint, bigint, numeric, bigint, bigint, numeric, numeric) TO authenticated",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.register_entry(bigint, bigint, numeric, bigint, bigint, date, numeric, numeric), public.register_exit(bigint, bigint, numeric, bigint, bigint, numeric, numeric) FROM PUBLIC, anon",
    );
  });

  // El ON CONFLICT se resuelve al ejecutar, no al crear la función: el único
  // chequeo estático posible es que el target case con el índice real.
  it("los targets de ON CONFLICT coinciden con el PK y el índice parcial reales", () => {
    const read = (file: string): string =>
      fs.readFileSync(`${REPO_ROOT}/supabase/migrations/${file}`, "utf8").replace(/\s+/g, " ");

    expect(read("20261029000030_relaciones_precios.sql")).toContain(
      "PRIMARY KEY (store_id, product_id)",
    );
    expect(read("20261015000002_tables_reused.sql")).toContain(
      "CREATE UNIQUE INDEX uq_price_store_product_active ON public.price_publications (store_id, product_id) WHERE is_active;",
    );

    const sql = readMigration();
    expect(sql).toContain("ON CONFLICT (store_id, product_id) DO NOTHING");
    expect(sql).toContain("ON CONFLICT (store_id, product_id) WHERE is_active DO NOTHING");
  });

  it("los motivos que disparan el autollenado existen en el seed", () => {
    const seeds = fs
      .readFileSync(`${REPO_ROOT}/supabase/migrations/20261015000005_seeds.sql`, "utf8")
      .replace(/\s+/g, " ");
    expect(seeds).toContain("('venta', 'exit')");
    expect(seeds).toContain("('reabastecimiento', 'entry')");
  });
});
