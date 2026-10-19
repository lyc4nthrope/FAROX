import { pageRange, type ListQuery, type ListResult } from "../../shared/lib/list";
import { supabase } from "../../shared/lib/supabase/client";
import { buildLocationEWKT } from "./geo";
import type { StoreFormValues } from "./schemas";
import type { StoreGeo, StoreListRow, StoreRow, StoreTypeRef } from "./types";

// stores es el ÚNICO caso RPC-only para el ALTA (T7.1 / STORE-1, spec #483
// S6): INSERT revocado para authenticated (0006:360) ⇒ create EXCLUSIVAMENTE
// vía rpc create_store (0004:635-666; GRANT 0006:398 + 0011:490) — el script
// check-scope.mjs falla ante cualquier alta directa por tabla (insert o
// upsert escritos sobre stores desde el front). El
// UPDATE/DELETE NO están revocados (0006:359 "UPDATE/DELETE vía policies"):
// · stores_select USING true (0006:164-165) — la lista NO está scopeada en la
//   DB; el scope del operador se aplica como UX con my_store_ids (§S2 "operador
//   own" + escenario STORE-2 "empty scope list"). Ocultar es UX nomás
//   (idea:134); el enforcement de escritura vive en stores_update/stores_delete.
// · stores_update admin o creador con has_scope (0006:166-171).
// · stores_delete admin SOLO sobre filas ya inactivas (0006:172-174).
// create_store NO tiene guard de admin (0004:649-657 solo valida sesión,
// nombre y store_type): el operador SÍ puede crear tiendas — es su ruta de
// bootstrap de alcance (D35; idea:114; README:38-39 dice lo contrario y está
// MAL, flag-only obs #480). El tope D34 lo aplican trg_stores_cap (0004:438-441
// sobre enforce_store_cap 0004:364-380: 1 activa; 3 con premium; admin exento)
// y trg_stores_cap_reactivate en reactivación (0009:503-507).

// PostgREST NO rinde error cuando RLS filtra TODAS las filas de un
// UPDATE/DELETE: responde 0 filas afectadas. Se sintetiza el SQLSTATE real
// (42501) para que mapError() lo traduzca — nunca un falso éxito (mismo
// precedente B5/B6). Variable (no literal en el return) para no disparar el
// excess-property check de TS sobre { message }.
const RLS_NO_ROWS = {
  code: "42501",
  message: "permission denied for table stores (0 rows affected)",
};

// Select explícito del listado (D4): SOLO desde la vista stores_geo — lat/lng
// calculados en servidor (st_x ⇒ lng, st_y ⇒ lat — 0004:1546-1547); el front
// jamás ejecuta ST_X/ST_Y (Base:165, STORE-2). count 'planned' NUNCA 'exact' +
// .range (Base:695, contrato useList). El error sale CRUDO acá: useList lo
// pasa por mapError() — jamás texto crudo al DOM (HARD-1).
const LIST_SELECT = "id, name, city, is_active, lat, lng";

// El formulario SÍ necesita address/phone (solo los listados los excluyen);
// location NO se pide de la tabla (STORE-2: las coordenadas se leen de
// stores_geo) y created_by queda fuera (D4 — la policy resuelve el ownership).
const FORM_SELECT = "id, name, store_type_id, address, city, phone";

// stores.id / store_types.id son bigint/integer (0002:124-125): PostgREST los
// serializa como número, pero se tolera también la forma string.
function normalizeId(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeId).filter((id) => id > 0);
}

// double precision llega como número (a veces como string): se normaliza a
// number para re-binddear los inputs con String().
function normalizeCoord(value: unknown): number {
  const coord = typeof value === "number" ? value : Number(value);
  return Number.isFinite(coord) ? coord : 0;
}

function normalizeListRow(raw: Record<string, unknown>): StoreListRow {
  return {
    id: normalizeId(raw.id),
    name: typeof raw.name === "string" ? raw.name : "",
    city: typeof raw.city === "string" ? raw.city : null,
    is_active: raw.is_active === true,
    lat: normalizeCoord(raw.lat),
    lng: normalizeCoord(raw.lng),
  };
}

function normalizeRow(raw: Record<string, unknown>): StoreRow {
  return {
    id: normalizeId(raw.id),
    name: typeof raw.name === "string" ? raw.name : "",
    store_type_id: normalizeId(raw.store_type_id),
    address: typeof raw.address === "string" ? raw.address : null,
    city: typeof raw.city === "string" ? raw.city : null,
    phone: typeof raw.phone === "string" ? raw.phone : null,
  };
}

// "all" = admin ve todas las filas visibles (stores_select USING true);
// "mine" = alcance del operador vía la helper en alcance my_store_ids()
// (00_foundation.sql:167-174; GRANT 0011:483). El filtro se aplica EN el
// query (.in sobre stores_geo), así paginación y count siguen siendo del
// servidor — nada de filtrar una página ya recortada en el cliente.
export type StoreListScope = "all" | "mine";

async function selectStorePage(
  from: number,
  to: number,
  scopeIds: number[] | null,
): Promise<ListResult<StoreListRow>> {
  const base = supabase.from("stores_geo").select(LIST_SELECT, { count: "planned" });
  const filtered = scopeIds === null ? base : base.in("id", scopeIds);
  const { data, count, error } = await filtered.order("name").range(from, to);
  if (error !== null) {
    return { rows: [], count: null, error };
  }
  const rows = Array.isArray(data) ? data.map(normalizeListRow) : [];
  return { rows, count, error: null };
}

export async function fetchStores(
  query: ListQuery,
  scope: StoreListScope,
): Promise<ListResult<StoreListRow>> {
  const { from, to } = pageRange(query);
  if (scope === "mine") {
    const { data: ids, error } = await supabase.rpc("my_store_ids");
    if (error !== null) {
      return { rows: [], count: null, error };
    }
    const scopeIds = normalizeIdList(ids);
    if (scopeIds.length === 0) {
      // Alcance vacío ⇒ lista vacía SIN error (vacío ≠ error, D4/STORE-2:
      // "empty scope list is not an error").
      return { rows: [], count: 0, error: null };
    }
    return selectStorePage(from, to, scopeIds);
  }
  return selectStorePage(from, to, null);
}

// .single(): sin fila (o una policy que la oculta) ⇒ PGRST116, que la UI
// traduce vía mapError() — nunca un crash (D4).
export async function fetchStore(
  id: number,
): Promise<{ row: StoreRow | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("stores")
    .select(FORM_SELECT)
    .eq("id", id)
    .single();
  if (error !== null) {
    return { row: null, error };
  }
  return { row: normalizeRow(data), error: null };
}

// Coordenadas del formulario SIEMPRE desde stores_geo (STORE-2): ni el
// select del form trae location ni el front parsea EWKT/binario (Base:165).
export async function fetchStoreGeo(
  id: number,
): Promise<{ geo: StoreGeo | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("stores_geo")
    .select("lat, lng")
    .eq("id", id)
    .single();
  if (error !== null || data === null) {
    return { geo: null, error };
  }
  const raw = data as Record<string, unknown>;
  return {
    geo: { lat: normalizeCoord(raw.lat), lng: normalizeCoord(raw.lng) },
    error: null,
  };
}

// Catálogo store_types para el <select> del formulario (T7.2): policies
// catalogs_select USING true (0006:76-77). Se piden TODAS las filas — también
// las "inactivas" (la tabla no tiene is_active, pero se respeta el patrón) —
// para no romper el value de un <select> en edición.
export async function fetchStoreTypes(): Promise<{
  rows: StoreTypeRef[];
  error: { message: string } | null;
}> {
  const { data, error } = await supabase.from("store_types").select("id, name").order("name");
  if (error !== null) {
    return { rows: [], error };
  }
  const rows = Array.isArray(data)
    ? data
        .map((raw) => {
          const record = raw as Record<string, unknown>;
          if (typeof record.name !== "string") return null;
          return { id: normalizeId(record.id), name: record.name };
        })
        .filter((ref): ref is StoreTypeRef => ref !== null)
    : [];
  return { rows, error: null };
}

// Alta SOLO por la RPC (STORE-1 "Creation only through create_store"): el
// INSERT directo está revocado (0006:360) y created_by lo fija el server con
// auth.uid() (0004:658-659 — sin suplantación); el server también auto-asocia
// al dueño en user_stores (D35, 0004:661-663) y valida nombre/store_type
// (0004:652-657). Zod ya corrió en el contenedor (idea:198); acá solo se arma
// el call. country/website_url no viajan: p_country DEFAULT 'CO' y website
// DEFAULT NULL (0004:642-643). p_location viaja EWKT lng-first (geo.ts/D3).
// Un operador sin tope tiene éxito; el tope D34 y los demás RAISE llegan como
// error de PostgREST y el contenedor los pasa por mapError() (HARD-1).
export async function createStore(
  values: StoreFormValues,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.rpc("create_store", {
    p_name: values.name,
    p_store_type_id: Number(values.store_type_id),
    p_address: values.address === "" ? null : values.address,
    p_city: values.city === "" ? null : values.city,
    p_phone: values.phone === "" ? null : values.phone,
    p_location: buildLocationEWKT(Number(values.lat), Number(values.lng)),
  });
  return { error };
}

// Edición directa por policy stores_update: admin, o el creador con has_scope
// (0006:166-171 — WITH CHECK impide transferir la propiedad). NO se envía
// created_by (D4/D36, igual que products). location SÍ viaja en el UPDATE:
// los campos lat/lng del form son editables y no persistirlos sería una UI
// que miente — mismo EWKT lng-first que el create. Un update denegado por RLS
// responde 0 filas ⇒ RLS_NO_ROWS (nunca un falso éxito, STORE-3).
export async function updateStore(
  id: number,
  values: StoreFormValues,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("stores")
    .update({
      name: values.name,
      store_type_id: Number(values.store_type_id),
      address: values.address === "" ? null : values.address,
      city: values.city === "" ? null : values.city,
      phone: values.phone === "" ? null : values.phone,
      location: buildLocationEWKT(Number(values.lat), Number(values.lng)),
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

// Paso 1 del borrado en dos pasos (STORE-3 "deactivate-then-delete"): la
// policy stores_delete exige is_active = false (0006:172-174), así que SIEMPRE
// se desactiva ANTES de borrar.
export async function deactivateStore(
  id: number,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("stores")
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

// Paso 2: DELETE sobre la fila YA desactivada (0006:172-174, admin-only). Un
// operador que lo fuerce recibe 0 filas ⇒ RLS_NO_ROWS amigable; el control ni
// se ofrece (SEC-01 idea:114 operador sin eliminar, idea:130 "sin destruir" —
// ocultar es UX, la DB manda).
export async function deleteStore(
  id: number,
): Promise<{ error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("stores")
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
