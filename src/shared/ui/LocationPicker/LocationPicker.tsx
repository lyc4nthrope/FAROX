import { useCallback, useEffect, useRef, useState } from "react";

import "leaflet/dist/leaflet.css";
import * as L from "leaflet";

import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "../../lib/geo/constants";
import { useGeolocation, type GeoErrorCode } from "../../lib/geo/useGeolocation";
import { addTileLayerWithFallback } from "./tileFallback";

// Picker de ubicación imperativo sobre Leaflet (npm, NO CDN — NOSEE tenía 5
// copias del loader de unpkg): el MAPA es el input principal de lat/lng de una
// tienda. Los inputs numéricos NO se renderizan mientras el mapa funciona;
// viven solo en el escape hatch (MapLocationField) por si el chunk de Leaflet
// no carga.
export interface LocationCoords {
  latitude: number;
  longitude: number;
}

export interface LocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  address?: string;
  // ÚNICA vía de mutación: click, drag y "Usar mi ubicación" emiten por acá
  // con coordenadas redondeadas a 6 decimales. Prop REQUERIDA (sin guards
  // `typeof === "function"` por todos lados, como en NOSEE).
  onLocationChange: (next: LocationCoords) => void;
  disabled?: boolean;
  label?: string;
}

// Copy amigable de los códigos de error del hook — el mapa de strings vive en
// el borde UI, jamás dentro del hook (que expone solo códigos tipados).
const GEO_ERROR_MESSAGES: Record<GeoErrorCode, string> = {
  PERMISSION_DENIED:
    "Permiso de ubicación denegado. Habilitá la ubicación en los ajustes del navegador.",
  POSITION_UNAVAILABLE: "No pudimos determinar tu ubicación.",
  TIMEOUT: "Se agotó el tiempo esperando tu ubicación.",
  UNSUPPORTED: "Tu navegador no soporta geolocalización.",
  NETWORK: "No pudimos obtener tu ubicación. Revisá tu conexión.",
  UNKNOWN: "No pudimos obtener tu ubicación.",
};

const LOCATE_BUTTON_LABEL = "Usar mi ubicación";
const LOCATE_PENDING_LABEL = "Obteniendo tu ubicación…";
const MAP_REGION_LABEL_DEFAULT = "Ubicación de la tienda";

function round6(value: number): number {
  return Number(value.toFixed(6));
}

function isValidCoord(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

// jsdom no implementa matchMedia; el guard también protege runtimes raros.
function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

// Icono propio (divIcon + SVG inline): evita resolver las rutas de assets
// marker-icon.png de Leaflet vía bundler (issue clásico) y hereda el tono de
// la app sin depender de CSS vars de otro proyecto.
function createPinIcon(): L.DivIcon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 28 38">
    <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 24 14 24S28 23.333 28 14C28 6.268 21.732 0 14 0z"
          fill="#1f2937" stroke="#ffffff" stroke-width="1.5"/>
    <circle cx="14" cy="14" r="5" fill="#ffffff" opacity="0.9"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [28, 38],
    iconAnchor: [14, 38],
    popupAnchor: [0, -38],
  });
}

export function LocationPicker({
  latitude,
  longitude,
  address,
  onLocationChange,
  disabled = false,
  label = MAP_REGION_LABEL_DEFAULT,
}: LocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const removeTilesRef = useRef<(() => void) | null>(null);
  const hasInitializedWithGeo = useRef(false);
  const lastExternalSyncRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const onLocationChangeRef = useRef(onLocationChange);
  const disabledRef = useRef(disabled);
  const [status, setStatus] = useState("");
  // Escape hatch por TILES caídos: si TODOS los proveedores configurados
  // (shared/lib/geo/tiles) se agotan, el mapa no puede ser el input ⇒ se
  // propaga al ErrorBoundary de MapLocationField y se pintan los inputs
  // numéricos legacy (camino exigido por el spec, nunca un crash silencioso
  // con un recto gris).
  const [tilesFailed, setTilesFailed] = useState(false);

  useEffect(() => {
    onLocationChangeRef.current = onLocationChange;
  });
  useEffect(() => {
    disabledRef.current = disabled;
  });

  const {
    latitude: geoLatitude,
    longitude: geoLongitude,
    loading: geoLoading,
    error: geoError,
    hasLocation,
    refetch,
  } = useGeolocation();

  const hasCoords = isValidCoord(latitude) && isValidCoord(longitude);

  const emitCoords = useCallback((nextLat: number, nextLon: number): void => {
    onLocationChangeRef.current({ latitude: round6(nextLat), longitude: round6(nextLon) });
  }, []);

  // Toda mutación del pin pasa por acá: marca la firma para que el sync de
  // coordenadas externas no re-centre el mapa con lo que el propio mapa emitió
  // (evita el ping-pong setView <-> onChange de NOSEE 325-337).
  const setMarkerPosition = useCallback(
    (nextLat: number, nextLon: number, options: { panTo?: boolean } = {}): void => {
      const map = mapRef.current;
      if (map === null) return;
      lastExternalSyncRef.current = `${round6(nextLat).toFixed(6)}:${round6(nextLon).toFixed(6)}`;
      let marker = markerRef.current;
      if (marker === null) {
        const newMarker = L.marker([nextLat, nextLon], {
          draggable: !disabledRef.current,
          icon: createPinIcon(),
        }).addTo(map);
        newMarker.on("dragend", () => {
          if (disabledRef.current) return;
          const position = newMarker.getLatLng();
          emitCoords(position.lat, position.lng);
        });
        markerRef.current = newMarker;
        marker = newMarker;
      } else {
        marker.setLatLng([nextLat, nextLon]);
      }
      if (options.panTo !== false) {
        map.setView([nextLat, nextLon], map.getZoom(), { animate: false });
      }
    },
    [emitCoords],
  );

  // ─── Inicialización imperativa — UNA sola vez por mount ────────────────────
  useEffect(() => {
    mountedRef.current = true;
    const container = containerRef.current;
    if (container === null) return undefined;

    // Captura el primer center (coords existentes en edición, o Bogotá): los
    // cambios posteriores de props los sincroniza el efecto de abajo.
    const initLat = isValidCoord(latitude) ? latitude : DEFAULT_MAP_CENTER.latitude;
    const initLon = isValidCoord(longitude) ? longitude : DEFAULT_MAP_CENTER.longitude;

    const map = L.map(container, {
      zoomControl: true,
      // Decisión de producto explícita: un mapa DENTRO de un form no roba el
      // scroll de la página. Los controles de zoom se mantienen.
      scrollWheelZoom: false,
      // Puntero grueso/touch: el mapa no intercepta el drag para que la
      // página scrollee; el marker sigue siendo draggable y el tap-to-place
      // funciona igual.
      dragging: !isCoarsePointer() && !disabledRef.current,
    }).setView([initLat, initLon], DEFAULT_MAP_ZOOM);

    mapRef.current = map;
    removeTilesRef.current = addTileLayerWithFallback(map, () => {
      // Todos los proveedores configurados agotados (ver shared/lib/geo/tiles):
      // sin tiles no hay input usable ⇒ escape hatch numérico vía el
      // ErrorBoundary contenedor.
      if (mountedRef.current) setTilesFailed(true);
    });

    // Leaflet dentro de contenedores flex/grid necesita invalidateSize tras
    // el layout real.
    const invalidateTimer = window.setTimeout(() => {
      map.invalidateSize();
    }, 0);

    map.on("click", (event: L.LeafletMouseEvent) => {
      if (disabledRef.current) return;
      const nextLat = round6(event.latlng.lat);
      const nextLon = round6(event.latlng.lng);
      setMarkerPosition(nextLat, nextLon, { panTo: false });
      emitCoords(nextLat, nextLon);
    });

    // El marker solo existe si HAY coordenadas: un pin pintado en el centro
    // sin valor en el form mentiría sobre lo que se va a guardar (Zod bloquea
    // el submit sin marker). Click/GPS lo crean.
    if (isValidCoord(latitude) && isValidCoord(longitude)) {
      setMarkerPosition(latitude, longitude, { panTo: false });
    }

    return () => {
      mountedRef.current = false;
      window.clearTimeout(invalidateTimer);
      if (removeTilesRef.current !== null) {
        removeTilesRef.current();
        removeTilesRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Inicialización única a propósito: Leaflet se monta UNA vez con el
    // primer center; la sincronia posterior vive en los efectos de abajo
    // (mismo patrón que NOSEE StoreMapPicker).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── GPS del dispositivo: UNA vez y SOLO si aún no hay coordenadas ─────────
  // Guard de NOSEE (StoreMapPicker.jsx:310-323): el GPS NUNCA pisa
  // coordenadas existentes (edición de una tienda con ubicación ya guardada).
  useEffect(() => {
    if (hasInitializedWithGeo.current) return;
    if (!hasLocation) return;
    if (hasCoords) return;
    hasInitializedWithGeo.current = true;
    if (geoLatitude === null || geoLongitude === null) return;
    const nextLat = round6(geoLatitude);
    const nextLon = round6(geoLongitude);
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLon)) return;
    setMarkerPosition(nextLat, nextLon);
    if (!disabledRef.current) {
      emitCoords(nextLat, nextLon);
    }
  }, [hasLocation, hasCoords, geoLatitude, geoLongitude, setMarkerPosition, emitCoords]);

  // ─── Sync coords externas -> marker, con de-dupe por firma ────────────────
  // (NOSEE StoreMapPicker.jsx:325-337): la firma evita el loop
  // setView -> onChange -> setView.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;
    if (!isValidCoord(latitude) || !isValidCoord(longitude)) return;
    const signature = `${round6(latitude).toFixed(6)}:${round6(longitude).toFixed(6)}`;
    if (lastExternalSyncRef.current === signature) return;
    lastExternalSyncRef.current = signature;
    if (markerRef.current !== null) {
      markerRef.current.setLatLng([latitude, longitude]);
    }
    map.setView([latitude, longitude], map.getZoom(), { animate: false });
  }, [latitude, longitude]);

  const handleUseMyLocation = useCallback(async (): Promise<void> => {
    setStatus(LOCATE_PENDING_LABEL);
    const result = await refetch();
    if (!mountedRef.current) return;
    if (result === null) {
      setStatus(
        "No se pudo obtener tu ubicación. Probá de nuevo o tocá el mapa para poner el pin.",
      );
      return;
    }
    const nextLat = round6(result.latitude);
    const nextLon = round6(result.longitude);
    setMarkerPosition(nextLat, nextLon);
    if (!disabledRef.current) {
      emitCoords(nextLat, nextLon);
    }
    setStatus("");
  }, [refetch, setMarkerPosition, emitCoords]);

  const resolvedText =
    address !== undefined && address !== ""
      ? address
      : hasCoords
        ? `${latitude}, ${longitude}`
        : "Tocá el mapa para ubicar la tienda";

  // TODOS los hooks de arriba corrieron sin condiciones: si los tiles murieron
  // por completo se propaga el error al MapErrorBoundary de MapLocationField
  // (React captura errores de render en la fase de commit/estado) y el usuario
  // cae en el escape hatch numérico con su warning. No es un crash: es el
  // camino de progressive enhancement exigido por el spec.
  if (tilesFailed) {
    throw new Error("LocationPicker: ningún proveedor de tiles respondió (escape hatch).");
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="region"
        aria-label={label}
        className="relative h-64 w-full overflow-hidden rounded border border-gray-300 sm:h-80"
      >
        <div ref={containerRef} className="h-full w-full" />
        {!disabled && (
          <div className="absolute bottom-2 right-2 z-[1000] flex flex-col gap-1">
            <button
              type="button"
              aria-label={LOCATE_BUTTON_LABEL}
              title={LOCATE_BUTTON_LABEL}
              disabled={geoLoading}
              className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 shadow disabled:opacity-50"
              onClick={() => {
                void handleUseMyLocation();
              }}
            >
              <span aria-hidden="true">📍</span>
              {geoLoading ? "…" : "Usar mi ubicación"}
            </button>
          </div>
        )}
      </div>
      <p className="text-xs text-gray-600">{resolvedText}</p>
      {status !== "" && <p className="text-xs text-gray-600">{status}</p>}
      {geoError !== null && (
        <p className="text-xs text-amber-700">{GEO_ERROR_MESSAGES[geoError]}</p>
      )}
    </div>
  );
}
