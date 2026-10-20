import { useCallback, useEffect, useRef } from "react";

import { reverseGeocode } from "./nominatim";
import type { GeoCoords } from "./useGeolocation";

// Pipeline ÚNICO y diferido de reverse-geocoding del pin (~800ms, cancellable)
// compartido por ambos formularios de tienda. El resultado es BEST-EFFORT:
// si Nominatim falla, onResolved simplemente no se invoca y el alta/edición
// sigue (p_address queda NULL en el RPC). Cada schedule nuevo cancela el
// timer anterior y anula la secuencia en vuelo: jamás dos geocodes aplicados
// fuera de orden.
export const REVERSE_GEOCODE_DEBOUNCE_MS = 800;

export interface UseReverseGeocodeResult {
  schedule: (coords: GeoCoords) => void;
}

export function useReverseGeocode(
  onResolved: (address: string, coords: GeoCoords) => void,
  debounceMs: number = REVERSE_GEOCODE_DEBOUNCE_MS,
): UseReverseGeocodeResult {
  const onResolvedRef = useRef(onResolved);
  const timerRef = useRef<number | null>(null);
  const sequenceRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    onResolvedRef.current = onResolved;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Cancela el timer pendiente Y cualquier respuesta en vuelo (el
      // sequence check descarta resultados de secuencias viejas).
      sequenceRef.current += 1;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const schedule = useCallback(
    (coords: GeoCoords): void => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      const sequence = ++sequenceRef.current;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void (async () => {
          const resolved = await reverseGeocode(coords.latitude, coords.longitude);
          if (!mountedRef.current || sequence !== sequenceRef.current) return;
          if (resolved === null) return; // best-effort: sin dirección no se bloquea nada
          onResolvedRef.current(resolved.address, coords);
        })();
      }, debounceMs);
    },
    [debounceMs],
  );

  return { schedule };
}
