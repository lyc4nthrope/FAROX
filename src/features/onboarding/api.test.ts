import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../shared/lib/supabase/client";
import {
  createStore,
  fetchOnboardingSignals,
  fetchStoreTypes,
  registerDistributor,
} from "./api";

// Capa api contra el cliente supabase MOCKEADO (mismo aislamiento que el
// resto de la suite: el cliente real valida el env al importar, V0-1).
// Se prueba el CONTRATO exacto que viaja al server:
// · los 3 reads del onboarding derivado (my_distributor_id / my_store_ids /
//   stores.created_by — R-D3.2);
// · register_distributor con la firma EXACTA de design #538 §2.1 (los 6
//   args p_*, enum incluido);
// · create_store con EWKT lng-first (geo.ts) — nunca a mano.
vi.mock("../../shared/lib/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

// Los builders encadenados de supabase-js no se satisfacen estructuralmente
// con objetos planos: se castea a vi.fn() para stubbear la cadena
// from().select().eq() / .order() y tipar libremente los valores.
const rpcMock = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>;
const storesEq = vi.fn();
const storeTypesOrder = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fromMock.mockImplementation((table: string) => {
    if (table === "stores") {
      return { select: () => ({ eq: storesEq }) };
    }
    if (table === "store_types") {
      return { select: () => ({ order: storeTypesOrder }) };
    }
    throw new Error(`tabla inesperada: ${table}`);
  });
  storesEq.mockResolvedValue({ data: [], error: null });
  storeTypesOrder.mockResolvedValue({ data: [], error: null });
});

// Señales del server preparadas por test (los helper devuelven bigint /
// bigint[] / filas [{ id }], según 0009:60-73).
function prepararSeñales(options: {
  distributor?: unknown;
  storeIds?: unknown;
  owned?: unknown[];
  rpcError?: { message: string } | null;
}) {
  const error = options.rpcError ?? null;
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "my_distributor_id") {
      return Promise.resolve({ data: options.distributor ?? null, error });
    }
    if (fn === "my_store_ids") {
      return Promise.resolve({ data: options.storeIds ?? [], error });
    }
    throw new Error(`rpc inesperada: ${fn}`);
  });
  storesEq.mockResolvedValue({ data: options.owned ?? [], error: null });
}

describe("onboarding api · fetchOnboardingSignals (detección derivada, T2.1)", () => {
  it("lee SOLO los helpers whitelisteados + stores.created_by — 3 reads, cero columna privilegiada", async () => {
    prepararSeñales({});

    const result = await fetchOnboardingSignals("u1");

    expect(result).toEqual({
      signals: { hasDistributor: false, hasStore: false },
      error: null,
    });
    expect(rpcMock).toHaveBeenCalledWith("my_distributor_id");
    expect(rpcMock).toHaveBeenCalledWith("my_store_ids");
    expect(fromMock).toHaveBeenCalledWith("stores");
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("my_distributor_id con id ⇒ hasDistributor true", async () => {
    prepararSeñales({ distributor: 7 });

    const result = await fetchOnboardingSignals("u1");

    expect(result.signals).toEqual({ hasDistributor: true, hasStore: false });
  });

  it("my_store_ids no vacío (tienda asignada) ⇒ hasStore true", async () => {
    prepararSeñales({ storeIds: [3, 4] });

    const result = await fetchOnboardingSignals("u1");

    expect(result.signals).toEqual({ hasDistributor: false, hasStore: true });
  });

  it("stores propias por created_by (tienda dueña sin asignación) ⇒ hasStore true", async () => {
    prepararSeñales({ owned: [{ id: 9 }] });

    const result = await fetchOnboardingSignals("u1");

    expect(result.signals).toEqual({ hasDistributor: false, hasStore: true });
    // El filtro va EN el query (no post-filtrado en cliente).
    expect(storesEq).toHaveBeenCalledWith("created_by", "u1");
  });

  it("error en cualquier read ⇒ sale CRUDO (mapError en el call site, HARD-1)", async () => {
    prepararSeñales({ rpcError: { message: "raw del backend" } });

    const result = await fetchOnboardingSignals("u1");

    expect(result.signals).toBeNull();
    expect(result.error).toEqual({ message: "raw del backend" });
  });
});

describe("onboarding api · registerDistributor (terminal [Distribuidor], contrato #538 §2.1)", () => {
  it("llama a register_distributor con los 6 args p_* EXACTOS — nombre + NIT + contacto + enum", async () => {
    rpcMock.mockResolvedValue({ data: 42, error: null });

    const result = await registerDistributor({
      name: "Distribuidora Sur",
      nit: "900123456-7",
      contact_name: "Ana Pérez",
      phone: "300 555 0101",
      email: "ana@sur.co",
      contact_preference: "whatsapp",
    });

    expect(rpcMock).toHaveBeenCalledWith("register_distributor", {
      p_name: "Distribuidora Sur",
      p_nit: "900123456-7",
      p_contact_name: "Ana Pérez",
      p_phone: "300 555 0101",
      p_email: "ana@sur.co",
      p_contact_preference: "whatsapp",
    });
    // Devuelve el id del distributor creado (bigint → número).
    expect(result).toEqual({ id: 42, error: null });
  });

  it("los opcionales vacíos viajan NULL (DEFAULT NULL de la firma)", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });

    await registerDistributor({
      name: "Distribuidora Norte",
      nit: "800999888",
      contact_name: "",
      phone: "",
      email: "",
      contact_preference: "phone",
    });

    expect(rpcMock).toHaveBeenCalledWith("register_distributor", {
      p_name: "Distribuidora Norte",
      p_nit: "800999888",
      p_contact_name: null,
      p_phone: null,
      p_email: null,
      p_contact_preference: "phone",
    });
  });

  it("error server (NIT duplicado, cap-1, inactivo) ⇒ { id: null, error } CRUDO para mapError", async () => {
    const serverError = { code: "23505", message: "duplicate key (raw)" };
    rpcMock.mockResolvedValue({ data: null, error: serverError });

    const result = await registerDistributor({
      name: "Otra",
      nit: "900123456-7",
      contact_name: "",
      phone: "",
      email: "",
      contact_preference: "whatsapp",
    });

    expect(result).toEqual({ id: null, error: serverError });
  });
});

describe("onboarding api · createStore (terminal [Mi tienda], RPC-only STORE-1)", () => {
  it("arma p_location EWKT lng-first con stores/geo.buildLocationEWKT — el swap lat/lng es imposible", async () => {
    rpcMock.mockResolvedValue({ data: 5, error: null });

    const result = await createStore({
      name: "Tienda Centro",
      store_type_id: "1",
      lat: "4.6097",
      lng: "-74.0631",
    });

    expect(rpcMock).toHaveBeenCalledWith("create_store", {
      p_name: "Tienda Centro",
      p_store_type_id: 1,
      p_address: null,
      p_city: null,
      p_phone: null,
      // POINT(lng lat) — PostGIS es x primero (0004:641 geography Point).
      p_location: "SRID=4326;POINT(-74.0631 4.6097)",
    });
    expect(result).toEqual({ error: null });
  });

  it("el error de la RPC sale CRUDO para mapError en el call site (HARD-1)", async () => {
    const serverError = { code: "P0001", message: "create_store: ubicación requerida" };
    rpcMock.mockResolvedValue({ data: null, error: serverError });

    const result = await createStore({
      name: "Tienda Centro",
      store_type_id: "1",
      lat: "4.6097",
      lng: "-74.0631",
    });

    expect(result).toEqual({ error: serverError });
  });
});

describe("onboarding api · fetchStoreTypes (catálogo del form [Mi tienda])", () => {
  it("trae id+name ordenado por nombre y normaliza las filas", async () => {
    storeTypesOrder.mockResolvedValue({
      data: [
        { id: 1, name: "Minimercado" },
        { id: "2", name: "Tienda" },
      ],
      error: null,
    });

    const result = await fetchStoreTypes();

    expect(storeTypesOrder).toHaveBeenCalled();
    expect(result).toEqual({
      rows: [
        { id: 1, name: "Minimercado" },
        { id: 2, name: "Tienda" },
      ],
      error: null,
    });
  });

  it("error del catálogo ⇒ sale CRUDO para mapError (HARD-1)", async () => {
    storeTypesOrder.mockResolvedValue({ data: null, error: { message: "raw" } });

    const result = await fetchStoreTypes();

    expect(result).toEqual({ rows: [], error: { message: "raw" } });
  });
});
