// ESCAPE HATCH de coordenadas (progressive enhancement): si el chunk de
// Leaflet no carga, el mapa tira error de render o los tiles fallan por
// completo, el usuario NUNCA queda sin salida — se renderizan los inputs
// numéricos legacy con la misma validación Zod del form. Si el product owner
// quiere sacarlo después, es UN bloque.
export interface CoordinateFallbackProps {
  latitude: string;
  longitude: string;
  onCoordinateTextChange: (next: { latitude: string; longitude: string }) => void;
  disabled?: boolean;
  idPrefix: string;
}

export function CoordinateFallback({
  latitude,
  longitude,
  onCoordinateTextChange,
  disabled = false,
  idPrefix,
}: CoordinateFallbackProps) {
  return (
    <div className="flex flex-col gap-3">
      <p
        role="status"
        className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
      >
        No se pudo cargar el mapa. Ingresá las coordenadas manualmente.
      </p>
      <div>
        <label htmlFor={`${idPrefix}-lat`} className="block text-sm font-medium text-gray-700">
          Latitud (-90 a 90)
        </label>
        <input
          id={`${idPrefix}-lat`}
          type="number"
          step="any"
          min={-90}
          max={90}
          disabled={disabled}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={latitude}
          placeholder="ej. 4.6097"
          onChange={(event) => onCoordinateTextChange({ latitude: event.target.value, longitude })}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-lng`} className="block text-sm font-medium text-gray-700">
          Longitud (-180 a 180)
        </label>
        <input
          id={`${idPrefix}-lng`}
          type="number"
          step="any"
          min={-180}
          max={180}
          disabled={disabled}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          value={longitude}
          placeholder="ej. -74.0631"
          onChange={(event) => onCoordinateTextChange({ latitude, longitude: event.target.value })}
        />
      </div>
    </div>
  );
}
