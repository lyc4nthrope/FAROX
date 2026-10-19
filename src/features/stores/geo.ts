// D3 · EWKT del argumento p_location (create_store, 0004:641 —
// public.geography(Point,4326) DEFAULT NULL).
//
// LONGITUD PRIMERO, SIEMPRE: PostGIS arma el punto como POINT(<lng> <lat>) —
// el mismo orden que ST_MakePoint(x.lng, x.lat) de 0012:848. Un swap lat/lng
// es SILENCIOSO (ambos rangos son números válidos): la tienda quedaría en el
// océano — Bogotá (4.6, -74.06) caería en el Índico. Este módulo es puro y no
// importa supabase: por eso es unit-testeable sin env (lección V0-1/B6).
export function buildLocationEWKT(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}
