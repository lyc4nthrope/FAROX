import fs from "node:fs";

import { describe, expect, it } from "vitest";

// La migración es la fuente de verdad del permiso: sin una DB local no hay
// forma de ejecutar la RPC en este gate, así que se verifica su contenido
// exacto. El comportamiento real se valida al aplicarla en Supabase.
const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname)
  .replace(/^\/[A-Za-z]:\/@fs\/([A-Za-z]:)\//, "$1/")
  .replace(/^\/@fs\//, "/")
  .replace(/^\/([A-Za-z]:)/, "$1")
  .replace(/\/$/, "");

const MIGRATION_PATH = `${REPO_ROOT}/supabase/migrations/20261025000020_store_link_store_users.sql`;

function readMigration(): string {
  return fs.readFileSync(MIGRATION_PATH, "utf8");
}

describe("0020 · vínculo QR para operadores con acceso a la tienda", () => {
  it("existe y reemplaza el helper con el alcance de user_stores", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);

    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.internal_can_manage_store(p_store bigint)",
    );
    expect(sql).toContain("public.my_role() = 'admin'");
    expect(sql).toContain("s.created_by = auth.uid()");
    expect(sql).toContain("public.my_role() = 'operador'");
    expect(sql).toContain("p_store = ANY (public.my_store_ids())");
  });

  it("mantiene SECURITY DEFINER, search_path fijo y no abre link_code por SELECT", () => {
    const sql = readMigration();
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog, public");
    expect(sql).not.toMatch(/GRANT\s+SELECT[\s\S]*public\.stores/i);
    expect(sql).not.toMatch(/REVOKE\s+SELECT\s+ON\s+public\.stores/i);
  });

  it("no deja pasar p_store NULL ni usuarios sin rol (regresión de tres valores)", () => {
    const flat = readMigration().replace(/\s+/g, " ");

    // NULL = ANY(array) es NULL y `IF NOT NULL` no entra: sin COALESCE el
    // guard se salta y la RPC responde éxito con un id inválido.
    expect(flat).toMatch(/COALESCE\s*\(/);
    expect(flat).toContain(
      "public.my_role() = 'operador' AND p_store = ANY (public.my_store_ids())",
    );
    expect(flat).not.toMatch(/OR p_store = ANY \(public\.my_store_ids\(\)\)/);
  });
});
