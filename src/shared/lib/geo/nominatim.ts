// Geocodificación vía Nominatim (OpenStreetMap) — módulo tipado que NUNCA
// lanza hacia la UI: todas las ramas de fallo devuelven null y el call site
// decide si es best-effort (p_address) o no.
export interface GeocodedPoint {
  latitude: number;
  longitude: number;
  address: string;
}

// Nominatim pide identificar la aplicación. En un entorno browser el header
// User-Agent lo fija el navegador y fetch NO puede setearlo (forbidden
// header-name); el Referer/Origin se adjunta solo. Usamos Accept y
// Accept-Language para la calidad de respuesta.
const NOMINATIM_HEADERS = {
  Accept: "application/json",
  "Accept-Language": "es,en;q=0.9",
} as const;

const NOMINATIM_TIMEOUT_MS = 5000;

// 6 decimales ≈ 0.11 m de precisión — más que suficiente para un pin y el
// mismo redondeo que aplica el pipeline de mutación del picker.
function round6(value: number): number {
  return Number(value.toFixed(6));
}

async function nominatimRequest(
  endpoint: "reverse" | "search",
  params: Record<string, string>,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
  try {
    const url = new URL(`https://nominatim.openstreetmap.org/${endpoint}`);
    url.searchParams.set("format", "jsonv2");
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      headers: NOMINATIM_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // Red caída, timeout u objeto JSON malformado: best-effort, sin throw.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isFiniteCoord(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readDisplayName(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { display_name: displayName } = raw as { display_name?: unknown };
  return typeof displayName === "string" && displayName !== "" ? displayName : null;
}

/** Dirección reversa para un punto; null si Nominatim no responde o no sabe. */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<GeocodedPoint | null> {
  const data = await nominatimRequest("reverse", {
    lat: String(round6(latitude)),
    lon: String(round6(longitude)),
  });
  const address = readDisplayName(data);
  if (address === null) return null;
  return { latitude: round6(latitude), longitude: round6(longitude), address };
}

/** Geocodificación directa de una dirección escrita; null si no hay resultados. */
export async function geocodeAddress(query: string): Promise<GeocodedPoint | null> {
  const trimmed = query.trim();
  if (trimmed === "") return null;
  const data = await nominatimRequest("search", { q: trimmed, limit: "1" });
  if (!Array.isArray(data)) return null;
  const [first] = data;
  if (typeof first !== "object" || first === null) return null;
  const { lat, lon } = first as { lat?: unknown; lon?: unknown };
  if (!isFiniteCoord(lat) || !isFiniteCoord(lon)) return null;
  return {
    latitude: round6(lat),
    longitude: round6(lon),
    address: readDisplayName(first) ?? trimmed,
  };
}
