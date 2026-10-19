import { pageRange, type ListQuery, type ListResult } from "../../shared/lib/list";
import { supabase } from "../../shared/lib/supabase/client";
import type { ProductFormValues } from "./schemas";
import type { CatalogRef, ProductListRow, ProductRow } from "./types";

// products tiene CRUD DIRECTO por tabla (T6.1 / PROD-1, spec #483 S5): la
// tabla NO está en el REVOKE RPC-only (0006:351-357) y no existe RPC propio.
// Políticas verificadas a mano en 0006:144-158: SELECT de todos los roles
// (USING true) · INSERT admin u operador con has_scope (D37) · UPDATE admin o
// creador con has_scope (D36, WITH CHECK impide transferir la propiedad) ·
// DELETE admin SOLO sobre filas ya inactivas (soft → purge).

// PostgREST NO rinde error cuando RLS filtra TODAS las filas de un
// UPDATE/DELETE: responde 0 filas afectadas. Sin esta guarda, una operación
// denegada parecería éxito (lección de B5 sobre DIST-1; PROD-2 exige "never a
// false success"). Se sintetiza el SQLSTATE real (42501) para que mapError()
// lo traduzca (HARD-1). Variable (no literal en el return) para no disparar
// el excess-property check de TS sobre { message }.
const RLS_NO_ROWS = {
  code: "42501",
  message: "permission denied for table products (0 rows affected)",
};

// created_by NOT NULL sin default ni trigger (0002:97): sin sesión activa no
// hay auth.uid() que enviar, y anon no tiene INSERT (idea:142-146; 0012:673-709).
// Se corta acá con el mismo SQLSTATE que el backend devolvería, para que
// mapError() lo muestre amigable.
const NO_SESSION = {
  code: "42501",
  message: "no session for products insert",
};

// Select explícito del listado (D4): sin description (Base:695) y sin la
// columna generada de búsqueda (Base:140); marca/unidad/categoría embebidas
// vía las FK NOT NULL en 1 request (Base:698) — cero N+1. count 'planned'
// NUNCA 'exact' + .range (Base:695, contrato useList). El error sale CRUDO
// acá: useList lo pasa por mapError() — jamás texto crudo al DOM (HARD-1).
const LIST_SELECT =
  "id, name, is_active, brand:brands(id, name), unit:unit_types(id, name), category:product_categories(id, name)";

// El formulario SÍ necesita description (solo los listados la excluyen,
// Base:695); created_by queda fuera (D4 — la policy resuelve el ownership).
const FORM_SELECT =
  "id, name, description, category_id, brand_id, unit_type_id, base_quantity, barcode";

// products.id / brands.id son bigint (0002:91,50): PostgREST los serializa
// como número, pero se tolera también la forma string por si el proyecto
// cambia la precisión int8.
function normalizeId(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeCatalogRef(value: unknown): CatalogRef | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.name !== "string") return null;
  return { id: normalizeId(raw.id), name: raw.name };
}

function normalizeListRow(raw: Record<string, unknown>): ProductListRow {
  return {
    id: normalizeId(raw.id),
    name: typeof raw.name === "string" ? raw.name : "",
    is_active: raw.is_active === true,
    brand: normalizeCatalogRef(raw.brand),
    unit: normalizeCatalogRef(raw.unit),
    category: normalizeCatalogRef(raw.category),
  };
}

// numeric(12,3) llega como número (a veces como string): se normaliza a
// number para re-binddear el input del formulario con String() (0002:98 —
// CHECK > 0 garantiza un valor válido en filas reales).
function normalizeQuantity(value: unknown): number {
  const quantity = typeof value === "number" ? value : Number(value);
  return Number.isFinite(quantity) ? quantity : 0;
}

function normalizeRow(raw: Record<string, unknown>): ProductRow {
  return {
    id: normalizeId(raw.id),
    name: typeof raw.name === "string" ? raw.name : "",
    description: typeof raw.description === "string" ? raw.description : null,
    category_id: normalizeId(raw.category_id),
    brand_id: normalizeId(raw.brand_id),
    unit_type_id: normalizeId(raw.unit_type_id),
    base_quantity: normalizeQuantity(raw.base_quantity),
    barcode: typeof raw.barcode === "string" ? raw.barcode : null,
  };
}

export async function fetchProducts(
  query: ListQuery,
): Promise<ListResult<ProductListRow>> {
  const { from, to } = pageRange(query);
  const { data, count, error } = await supabase
    .from("products")
    .select(LIST_SELECT, { count: "planned" })
    .order("name")
    .range(from, to);
  if (error !== null) {
    return { rows: [], count: null, error };
  }
  const rows = Array.isArray(data) ? data.map(normalizeListRow) : [];
  return { rows, count, error: null };
}

// .single(): sin fila (o una policy que la oculta) ⇒ PGRST116, que la UI
// traduce vía mapError() — nunca un crash (D4).
export async function fetchProduct(
  id: number,
): Promise<{ row: ProductRow | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("products")
    .select(FORM_SELECT)
    .eq("id", id)
    .single();
  if (error !== null) {
    return { row: null, error };
  }
  return { row: normalizeRow(data), error: null };
}

export interface CatalogListResult {
  rows: CatalogRef[];
  error: { message: string } | null;
}

// Catálogos de solo lectura para los <select> del formulario (T6.2): sus
// policies son USING true para authenticated (0006:66-67 unit_types,
// :88-89 brands, :112-113 product_categories). Se piden TODAS las filas —
// también las inactivas — para no romper el value de un <select> en edición.
async function fetchCatalog(
  table: "brands" | "unit_types" | "product_categories",
): Promise<CatalogListResult> {
  const { data, error } = await supabase.from(table).select("id, name").order("name");
  if (error !== null) {
    return { rows: [], error };
  }
  const rows = Array.isArray(data)
    ? data
        .map(normalizeCatalogRef)
        .filter((ref): ref is CatalogRef => ref !== null)
    : [];
  return { rows, error: null };
}

export function fetchBrands(): Promise<CatalogListResult> {
  return fetchCatalog("brands");
}

export function fetchUnitTypes(): Promise<CatalogListResult> {
  return fetchCatalog("unit_types");
}

export function fetchProductCategories(): Promise<CatalogListResult> {
  return fetchCatalog("product_categories");
}

// created_by = auth.uid() (0002:97; PROD-2 "SHALL send created_by = auth.uid()
// on create"): el uid ES el user.id de la sesión de supabase-js — el mismo
// claim que lee auth.uid() en la policy. La policy products_insert (0006:146-149)
// deniega al operador sin alcance con 42501 REAL de la DB y la UI lo muestra
// amigable — nunca un falso éxito (PROD-2). Zod ya corrió en el contenedor
// (idea:198); acá solo se arma el INSERT.
export async function createProduct(
  values: ProductFormValues,
): Promise<{ error: { message: string } | null }> {
  const { data } = await supabase.auth.getSession();
  if (data.session === null) {
    return { error: NO_SESSION };
  }
  const { error } = await supabase.from("products").insert({
    name: values.name,
    description: values.description === "" ? null : values.description,
    category_id: Number(values.category_id),
    brand_id: Number(values.brand_id),
    unit_type_id: Number(values.unit_type_id),
    created_by: data.session.user.id,
    base_quantity: Number(values.base_quantity),
    barcode: values.barcode === "" ? null : values.barcode,
  });
  return { error };
}

// created_by NUNCA viaja en el update: el WITH CHECK de products_update
// (0006:154-155) exige que la propiedad siga siendo del operador (D36 — un
// operador no puede transferirse el registro). Un update denegado por RLS
// responde 0 filas ⇒ guarda RLS_NO_ROWS (nunca un falso éxito).
export async function updateProduct(
  id: number,
  values: ProductFormValues,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("products")
    .update({
      name: values.name,
      description: values.description === "" ? null : values.description,
      category_id: Number(values.category_id),
      brand_id: Number(values.brand_id),
      unit_type_id: Number(values.unit_type_id),
      base_quantity: Number(values.base_quantity),
      barcode: values.barcode === "" ? null : values.barcode,
    })
    .eq("id", id)
    .select("id");
  if (error !== null) {
    return { error };
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { error: RLS_NO_ROWS };
  }
  return { error: null };
}

// Paso 1 del borrado en dos pasos (PROD-2 "delete is admin soft-delete"): la
// policy products_delete exige is_active = false (0006:156-158, "soft →
// purge"), así que SIEMPRE se desactiva ANTES de borrar.
export async function deactivateProduct(
  id: number,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("products")
    .update({ is_active: false })
    .eq("id", id)
    .select("id");
  if (error !== null) {
    return { error };
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { error: RLS_NO_ROWS };
  }
  return { error: null };
}

// Paso 2: DELETE sobre la fila YA desactivada (0006:156-158). Un operador que
// lo fuerce recibe 0 filas ⇒ RLS_NO_ROWS amigable; el control ni se ofrece
// (SEC-01 idea:113 "✘ eliminar", idea:134 — ocultar es UX, la DB manda).
export async function deleteProduct(
  id: number,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .select("id");
  if (error !== null) {
    return { error };
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { error: RLS_NO_ROWS };
  }
  return { error: null };
}
