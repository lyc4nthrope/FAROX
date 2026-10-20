import { Component, Suspense, lazy, type ReactNode } from "react";

import { CoordinateFallback } from "./CoordinateFallback";

// Wrapper de lazy-loading del picker: Leaflet (~40KB + CSS) vive en su propio
// chunk via React.lazy. Si el chunk FALLA (red, CDN caído en dev, árbol de
// errores del propio Leaflet), el ErrorBoundary renderiza el ESCAPE HATCH
// numérico en vez de crashear el form — progressive enhancement de verdad.
const LazyLocationPicker = lazy(() =>
  import("./LocationPicker").then((module) => ({ default: module.LocationPicker })),
);

export interface MapLocationFieldProps {
  // Strings crudos del form ("" = sin pin): el escape hatch escribe sobre
  // ellos sin parsear, el mapa emite números redondeados a 6 decimales.
  latitude: string;
  longitude: string;
  // Dirección resuelta por reverse geocode (mejor esfuerzo), mostrada como
  // texto read-only debajo del mapa.
  address?: string;
  latitudeError?: string;
  longitudeError?: string;
  onLocationChange: (next: { latitude: number; longitude: number }) => void;
  onCoordinateTextChange: (next: { latitude: string; longitude: string }) => void;
  disabled?: boolean;
  label?: string;
  // Prefijo de ids de los inputs del escape hatch (evita duplicar ids entre
  // el form de onboarding y el de /stores).
  idPrefix?: string;
}

interface MapErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface MapErrorBoundaryState {
  hasError: boolean;
}

class MapErrorBoundary extends Component<MapErrorBoundaryProps, MapErrorBoundaryState> {
  override state: MapErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): MapErrorBoundaryState {
    return { hasError: true };
  }

  override render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function parseCoord(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function MapLocationField({
  latitude,
  longitude,
  address,
  latitudeError,
  longitudeError,
  onLocationChange,
  onCoordinateTextChange,
  disabled = false,
  label,
  idPrefix = "store-location",
}: MapLocationFieldProps) {
  const latitudeNumber = parseCoord(latitude);
  const longitudeNumber = parseCoord(longitude);
  const hasParsableCoords = latitudeNumber !== null && longitudeNumber !== null;

  return (
    <div className="flex flex-col gap-2">
      <MapErrorBoundary
        fallback={
          <CoordinateFallback
            latitude={latitude}
            longitude={longitude}
            onCoordinateTextChange={onCoordinateTextChange}
            disabled={disabled}
            idPrefix={idPrefix}
          />
        }
      >
        <Suspense fallback={<p className="text-sm text-gray-600">Cargando mapa…</p>}>
          <LazyLocationPicker
            latitude={hasParsableCoords ? latitudeNumber : null}
            longitude={hasParsableCoords ? longitudeNumber : null}
            address={address}
            onLocationChange={onLocationChange}
            disabled={disabled}
            label={label}
          />
        </Suspense>
      </MapErrorBoundary>
      {/* Errores de Zod de coordenadas SIEMPRE visibles (también con el mapa
          operativo): sin pin, el submit queda bloqueado y el usuario tiene que
          ver POR QUÉ. Un solo punto de render — ni el escape hatch ni acá a la
          vez (rompería los queries por texto duplicado de los tests). */}
      {latitudeError !== undefined && <p className="text-xs text-red-600">{latitudeError}</p>}
      {longitudeError !== undefined && <p className="text-xs text-red-600">{longitudeError}</p>}
    </div>
  );
}
