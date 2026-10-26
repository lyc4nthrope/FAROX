import fs from "node:fs";

import { describe, expect, it } from "vitest";

// La migración es la fuente de verdad: sin Postgres local no se puede ejecutar
// la RPC en el gate. Se verifica el contenido exacto; el comportamiento se
// valida al aplicarla en Supabase (SQL Editor).
const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname)
  .replace(/^\/[A-Za-z]:\/@fs\/([A-Za-z]:)\//, "$1/")
  .replace(/^\/@fs\//, "/")
  .replace(/^\/([A-Za-z]:)/, "$1")
  .replace(/\/$/, "");

const MIGRATION_PATH = `${REPO_ROOT}/supabase/migrations/20261025000022_catalogo_operador.sql`;

function readMigration(): string {
  return fs.readFileSync(MIGRATION_PATH, "utf8").replace(/\s+/g, " ");
}

describe("0022 · catálogo del operador", () => {
  it("agrega la columna de faltante con su índice parcial", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    const sql = readMigration();
    expect(sql).toContain(
      "ALTER TABLE public.stock ADD COLUMN IF NOT EXISTS is_shortage boolean NOT NULL DEFAULT false",
    );
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS idx_stock_shortage ON public.stock (store_id) WHERE is_shortage",
    );
  });

  it("la cantidad se ajusta sin insertar movimientos", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.set_store_product_quantity( p_product bigint, p_store bigint, p_quantity numeric ) RETURNS void",
    );
    expect(sql).toContain("UPDATE public.stock SET quantity = p_quantity");
    expect(sql).toContain("PERFORM public.internal_eval_stock_alert(p_store, p_product)");
    // Único uso del núcleo de movimientos: la baja con stock (sección 3).
    expect(sql.match(/PERFORM public\.internal_stock_entry\(/g)).toHaveLength(1);
  });

  it("la baja exige confirmación explícita cuando hay existencias", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.remove_store_product( p_product bigint, p_store bigint, p_confirm_stock boolean DEFAULT false ) RETURNS void",
    );
    expect(sql).toContain("IF v_qty > 0 THEN");
    expect(sql).toContain(
      "remove_store_product: el producto tiene existencias (%) y exige confirmacion",
    );
    expect(sql).toContain("SELECT id INTO v_motive FROM public.motives WHERE name = 'ajuste'");
    expect(sql).toContain("PERFORM public.internal_stock_entry( 'exit'");
    expect(sql).toContain("DELETE FROM public.stock WHERE product_id = p_product AND store_id = p_store");
    expect(sql).toContain("SET resolved_at = now()");
  });

  it("marcar faltante es una escritura acotada al par producto/tienda", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.set_store_shortage( p_product bigint, p_store bigint, p_shortage boolean ) RETURNS void",
    );
    expect(sql).toContain("SET is_shortage = COALESCE(p_shortage, false)");
    expect(sql).toContain("WHERE product_id = p_product AND store_id = p_store");
  });

  // Histórico: 0023 reemplaza esta función y quita la rama del distribuidor.
  it("el distribuidor solo ve faltantes de tiendas vinculadas (0022; 0023 lo deroga)", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.list_shortage_products() RETURNS TABLE (",
    );
    expect(sql).toContain("JOIN public.store_distributors sd");
    expect(sql).toContain("sd.distributor_id = public.my_distributor_id()");
    expect(sql).toContain("WHERE s.is_shortage");
    expect(sql).toContain("s.store_id = ANY (public.my_store_ids())");
    expect(sql).toContain("shortage: sin alcance para ver faltantes");
  });

  it("todas las funciones son SECURITY DEFINER con grants explícitos", () => {
    const sql = readMigration();
    expect(sql.match(/SECURITY DEFINER SET search_path = pg_catalog, public/g)).toHaveLength(4);
    // Los grants nombran roles de servidor: el gate §S8-4 prohíbe ese literal
    // en src/, así que se valida la forma (ningún grant a PUBLIC/anon y
    // exactamente dos roles autorizados, con las 4 firmas listadas).
    const grant = /GRANT EXECUTE ON FUNCTION([\s\S]*?)TO ([a-zA-Z_,\s]+);/.exec(sql);
    expect(grant).not.toBeNull();
    expect(grant?.[1].match(/public\.[a-z_]+\(/g)).toHaveLength(4);
    expect(grant?.[2]).not.toContain("anon");
    expect(grant?.[2]).not.toContain("PUBLIC");
    expect(grant?.[2].split(",")).toHaveLength(2);

    const revoke = /REVOKE EXECUTE ON FUNCTION([\s\S]*?)FROM ([a-zA-Z_,\s]+);/.exec(sql);
    expect(revoke?.[2]).toContain("PUBLIC");
    expect(revoke?.[2]).toContain("anon");
  });

  it("el alcance del operador se valida en cada escritura", () => {
    const sql = readMigration();
    expect(sql.match(/p_store = ANY \(public\.my_store_ids\(\)\)/g)).toHaveLength(3);
  });
});
