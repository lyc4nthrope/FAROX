import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGeolocation } from "./useGeolocation";

// Escalera de fallback del hook (GPS → caché local → IP → null) contra
// navigator.geolocation y fetch mockeados. La caché vive en la clave
// farox:last-known-location.
interface GeolocationSuccessCallback {
  (position: GeolocationPosition): void;
}
interface GeolocationErrorCallback {
  (error: GeolocationPositionError): void;
}

function stubGeolocation(): {
  succeed: (coords: { latitude: number; longitude: number; accuracy?: number }) => void;
  fail: (code: number) => void;
  getCurrentPosition: ReturnType<typeof vi.fn>;
} {
  let onSuccess: GeolocationSuccessCallback | null = null;
  let onError: GeolocationErrorCallback | null = null;
  const getCurrentPosition = vi.fn(
    (success: GeolocationSuccessCallback, failure: GeolocationErrorCallback) => {
      onSuccess = success;
      onError = failure;
    },
  );
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
  return {
    getCurrentPosition,
    succeed: (coords) => {
      onSuccess?.({
        coords: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy ?? 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition);
    },
    fail: (code) => {
      onError?.({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "" });
    },
  };
}

function stubFetch(
  implementation: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const CACHE_KEY = "farox:last-known-location";

describe("useGeolocation (escalera GPS → caché → IP → null)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("GPS disponible: expone coordenadas, sin error, y persiste la caché local", async () => {
    const geo = stubGeolocation();
    stubFetch(() => Promise.reject(new Error("no debería llamarse a IP")));

    const { result } = renderHook(() => useGeolocation());
    geo.succeed({ latitude: 4.6097, longitude: -74.0631, accuracy: 12 });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasLocation).toBe(true);
    expect(result.current.latitude).toBe(4.6097);
    expect(result.current.longitude).toBe(-74.0631);
    expect(result.current.accuracy).toBe(12);
    expect(result.current.error).toBeNull();
    expect(geo.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
    const cached = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "null");
    expect(cached).toMatchObject({ latitude: 4.6097, longitude: -74.0631, accuracy: 12 });
  });

  it("PERMISSION_DENIED con caché: usa la última ubicación conocida y NUNCA llama a IP", async () => {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ latitude: 4.5, longitude: -74.2, accuracy: 30, updatedAt: "ayer" }),
    );
    const geo = stubGeolocation();
    const fetchMock = stubFetch(() => Promise.reject(new Error("sin red")));

    const { result } = renderHook(() => useGeolocation());
    geo.fail(1);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("PERMISSION_DENIED");
    expect(result.current.hasLocation).toBe(true);
    expect(result.current.latitude).toBe(4.5);
    expect(result.current.longitude).toBe(-74.2);
    expect(result.current.accuracy).toBe(30);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PERMISSION_DENIED sin caché: cae a geolocalización por IP (ipwho.is)", async () => {
    const geo = stubGeolocation();
    stubFetch(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, latitude: 9.9, longitude: -74.5 }),
      }),
    );

    const { result } = renderHook(() => useGeolocation());
    geo.fail(1);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasLocation).toBe(true);
    expect(result.current.latitude).toBe(9.9);
    expect(result.current.longitude).toBe(-74.5);
    // La causa raíz gobernante sigue expuesta pese al fallback exitoso.
    expect(result.current.error).toBe("PERMISSION_DENIED");
  });

  it("IP también falla: coordenadas null y el código del fallo gobernante", async () => {
    const geo = stubGeolocation();
    stubFetch(() => Promise.reject(new Error("ipwho caído")));

    const { result } = renderHook(() => useGeolocation());
    geo.fail(1);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasLocation).toBe(false);
    expect(result.current.latitude).toBeNull();
    expect(result.current.longitude).toBeNull();
    expect(result.current.error).toBe("PERMISSION_DENIED");
  });

  it("sin navigator.geolocation: UNSUPPORTED, sin loading y sin coordenadas", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    stubFetch(() => Promise.reject(new Error("sin red")));

    const { result } = renderHook(() => useGeolocation());

    await waitFor(() => expect(result.current.error).toBe("UNSUPPORTED"));
    expect(result.current.loading).toBe(false);
    expect(result.current.hasLocation).toBe(false);
  });

  it("refetch re-intenta la escalera completa y resuelve con las coordenadas finales", async () => {
    const geo = stubGeolocation();
    stubFetch(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, latitude: 1.5, longitude: -75.5 }),
      }),
    );

    const { result } = renderHook(() => useGeolocation());
    geo.fail(3); // TIMEOUT en el mount
    await waitFor(() => expect(result.current.error).toBe("TIMEOUT"));

    const fetched = result.current.refetch();
    geo.succeed({ latitude: 4.2, longitude: -74.9 });
    await expect(fetched).resolves.toEqual({ latitude: 4.2, longitude: -74.9 });
    await waitFor(() => expect(result.current.error).toBeNull());
  });
});
