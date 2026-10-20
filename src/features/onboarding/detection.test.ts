import { describe, expect, it } from "vitest";

import {
  deriveNeedsOnboarding,
  hasDistributorId,
  hasOwnedStores,
  hasStoreIds,
} from "./detection";

// Predicado puro de la pregunta (T2.1 · R-D3.2/R-D3.3 · design #538 §5.1):
// 4 combinaciones de señales + el ack de sesión de [Trabajo en tienda].
describe("detection · deriveNeedsOnboarding (T2.1)", () => {
  it("las 4 combinaciones: SOLO sin tienda y sin distributor necesita onboarding", () => {
    expect(deriveNeedsOnboarding({ hasDistributor: false, hasStore: false }, false)).toBe(true);
    expect(deriveNeedsOnboarding({ hasDistributor: true, hasStore: false }, false)).toBe(false);
    expect(deriveNeedsOnboarding({ hasDistributor: false, hasStore: true }, false)).toBe(false);
    expect(deriveNeedsOnboarding({ hasDistributor: true, hasStore: true }, false)).toBe(false);
  });

  it("ack de sesión suprime la pregunta aunque no haya señal (S-D3.C: re-preguntar es deseado en el próximo login, no en esta sesión)", () => {
    expect(deriveNeedsOnboarding({ hasDistributor: false, hasStore: false }, true)).toBe(false);
  });
});

describe("detection · normalizadores de las señales del server", () => {
  it("hasDistributorId: NULL ⇒ false; bigint serializado como número o string ⇒ true", () => {
    expect(hasDistributorId(null)).toBe(false);
    expect(hasDistributorId(undefined)).toBe(false);
    expect(hasDistributorId(7)).toBe(true);
    expect(hasDistributorId("7")).toBe(true);
    // 0 y "" no son ids — Number("") === 0 no puede contar como señal.
    expect(hasDistributorId(0)).toBe(false);
    expect(hasDistributorId("")).toBe(false);
  });

  it("hasStoreIds: '[]' (my_store_ids vacío) ⇒ false; con al menos un id ⇒ true", () => {
    expect(hasStoreIds([])).toBe(false);
    expect(hasStoreIds([3, 4])).toBe(true);
    expect(hasStoreIds(["3"])).toBe(true);
    expect(hasStoreIds([0])).toBe(false);
    expect(hasStoreIds("no-array")).toBe(false);
  });

  it("hasOwnedStores: filas de stores(created_by = uid) no vacías ⇒ true", () => {
    expect(hasOwnedStores([])).toBe(false);
    expect(hasOwnedStores([{ id: 9 }])).toBe(true);
    expect(hasOwnedStores(null)).toBe(false);
  });
});
