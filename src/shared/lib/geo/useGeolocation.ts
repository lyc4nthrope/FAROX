import { useCallback, useEffect, useRef, useState } from "react";

// Hook de geolocalización con ESCALERA de fallback tipada (puerto del patrón
// useGeoLocation de NOSEE, sin los strings bilingües "\n"):
//   1) navigator.geolocation.getCurrentPosition (high accuracy);
//   2) última ubicación conocida cacheada en localStorage;
//   3) geolocalización por IP (https://ipwho.is/, aprobada por el product
//      owner como tercer fallback);
//   4) null.
// Los errores son CÓDIGOS (GeoErrorCode); el copy en español vive en el borde
// UI (LocationPicker), jamás acá.
export type GeoErrorCode =
  "PERMISSION_DENIED" | "POSITION_UNAVAILABLE" | "TIMEOUT" | "UNSUPPORTED" | "NETWORK" | "UNKNOWN";

export interface GeoCoords {
  latitude: number;
  longitude: number;
}

interface StoredLocation extends GeoCoords {
  accuracy: number | null;
  updatedAt: string;
}

export interface UseGeolocationResult {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  hasLocation: boolean;
  loading: boolean;
  error: GeoErrorCode | null;
  // Reintenta la escalera completa. Resuelve con las coordenadas finales o
  // null; NUNCA rechaza (el caller decide el copy del error vía `error`).
  refetch: () => Promise<GeoCoords | null>;
}

const LAST_LOCATION_STORAGE_KEY = "farox:last-known-location";

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 60000,
};

const IP_FALLBACK_TIMEOUT_MS = 5000;

function getPositionAsync(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    try {
      navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS);
    } catch (thrown) {
      // Algunos runtimes lanzan síncrono (contexto inseguro, etc.): se
      // traduce a un rechazo para no romper la escalera.
      reject(thrown);
    }
  });
}

function mapPositionError(thrown: unknown): GeoErrorCode {
  if (typeof thrown === "object" && thrown !== null && "code" in thrown) {
    const { code } = thrown as { code: unknown };
    // Códigos del spec W3C Geolocation: 1 PERMISSION_DENIED, 2
    // POSITION_UNAVAILABLE, 3 TIMEOUT.
    if (code === 1) return "PERMISSION_DENIED";
    if (code === 2) return "POSITION_UNAVAILABLE";
    if (code === 3) return "TIMEOUT";
    if (typeof code === "number") return "UNKNOWN";
  }
  // Lanzamiento síncrono sin código W3C (p. ej. contexto inseguro): el canal
  // de geolocalización no está disponible.
  return "NETWORK";
}

function readStoredLocation(): StoredLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_LOCATION_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Partial<StoredLocation>;
    if (typeof candidate.latitude !== "number" || typeof candidate.longitude !== "number") {
      return null;
    }
    if (!Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) {
      return null;
    }
    return {
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      accuracy: typeof candidate.accuracy === "number" ? candidate.accuracy : null,
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
    };
  } catch {
    // Storage corrupto o inaccesible (private mode): la escalera sigue.
    return null;
  }
}

function persistLocation(location: GeoCoords & { accuracy: number | null }): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LAST_LOCATION_STORAGE_KEY,
      JSON.stringify({
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // best-effort: sin storage la escalera simplemente empieza de cero.
  }
}

async function fetchIpLocation(): Promise<GeoCoords | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IP_FALLBACK_TIMEOUT_MS);
  try {
    const response = await fetch("https://ipwho.is/", { signal: controller.signal });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      success?: unknown;
      latitude?: unknown;
      longitude?: unknown;
    };
    if (
      data.success !== true ||
      typeof data.latitude !== "number" ||
      typeof data.longitude !== "number"
    ) {
      return null;
    }
    return { latitude: data.latitude, longitude: data.longitude };
  } catch {
    // IP geolocation es best-effort: nunca lanza.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function useGeolocation(): UseGeolocationResult {
  const cachedRef = useRef<StoredLocation | null>(readStoredLocation());
  const mountedRef = useRef(true);
  const [latitude, setLatitude] = useState<number | null>(cachedRef.current?.latitude ?? null);
  const [longitude, setLongitude] = useState<number | null>(cachedRef.current?.longitude ?? null);
  const [accuracy, setAccuracy] = useState<number | null>(cachedRef.current?.accuracy ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<GeoErrorCode | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runLadder = useCallback(async (): Promise<GeoCoords | null> => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      if (mountedRef.current) {
        setError("UNSUPPORTED");
        setLoading(false);
      }
      return null;
    }
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    // Paso 1: GPS del dispositivo.
    let position: GeolocationPosition | null = null;
    let failureCode: GeoErrorCode = "UNKNOWN";
    try {
      position = await getPositionAsync();
    } catch (thrown) {
      failureCode = mapPositionError(thrown);
    }

    if (position !== null) {
      const next = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy ?? null,
      };
      persistLocation(next);
      cachedRef.current = { ...next, updatedAt: new Date().toISOString() };
      if (mountedRef.current) {
        setLatitude(next.latitude);
        setLongitude(next.longitude);
        setAccuracy(next.accuracy);
        setError(null);
        setLoading(false);
      }
      return { latitude: next.latitude, longitude: next.longitude };
    }

    // Paso 2: última ubicación conocida (cacheada en un intento previo).
    const cached = readStoredLocation();
    if (cached !== null) {
      cachedRef.current = cached;
      if (mountedRef.current) {
        setLatitude(cached.latitude);
        setLongitude(cached.longitude);
        setAccuracy(cached.accuracy);
        setError(failureCode);
        setLoading(false);
      }
      return { latitude: cached.latitude, longitude: cached.longitude };
    }

    // Paso 3: aproximación por IP.
    const ipCoords = await fetchIpLocation();
    if (mountedRef.current) {
      if (ipCoords !== null) {
        persistLocation({ ...ipCoords, accuracy: null });
        cachedRef.current = { ...ipCoords, accuracy: null, updatedAt: new Date().toISOString() };
        setLatitude(ipCoords.latitude);
        setLongitude(ipCoords.longitude);
        setAccuracy(null);
      } else {
        // Paso 4: sin nada — coordenadas null.
        setLatitude(null);
        setLongitude(null);
        setAccuracy(null);
      }
      // El código expuesto sigue siendo el del fallo GOVERNER (p. ej.
      // PERMISSION_DENIED): la escalera degradó, la causa raíz no cambió.
      setError(failureCode);
      setLoading(false);
    }
    return ipCoords;
  }, []);

  // Auto-fetch al montar: el picker necesita la escalera viva para sembrar un
  // form vacío (guard hasInitializedWithGeo) y para el botón "Usar mi
  // ubicación".
  useEffect(() => {
    void runLadder();
  }, [runLadder]);

  return {
    latitude,
    longitude,
    accuracy,
    hasLocation: latitude !== null && longitude !== null,
    loading,
    error,
    refetch: runLadder,
  };
}
