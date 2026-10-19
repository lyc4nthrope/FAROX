import { describe, expect, it } from "vitest";

import { buildLocationEWKT } from "./geo";

// T7.3 ("EWKT lng-first") · trap #2 de B7: la latitud y la longitud se
// confunden sin error (los dos valores son números finitos válidos), así que
// el orden se prueba acá de forma explícita — 0012:848 usa
// ST_SetSRID(ST_MakePoint(x.lng, x.lat), 4326): LONGITUD primero.
describe("buildLocationEWKT (D3 · EWKT lng-first)", () => {
  it("coloca la LONGITUD primero: POINT(<lng> <lat>) con SRID=4326", () => {
    expect(buildLocationEWKT(4.6097, -74.0631)).toBe("SRID=4326;POINT(-74.0631 4.6097)");
  });

  it("el punto con lat/lng intercambiados es DISTINTO (el bug que previene)", () => {
    expect(buildLocationEWKT(4.6097, -74.0631)).not.toBe("SRID=4326;POINT(4.6097 -74.0631)");
  });
});
