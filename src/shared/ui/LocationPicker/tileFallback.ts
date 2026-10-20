import type { Map as LeafletMap, TileLayer } from "leaflet";
import * as L from "leaflet";

import { TILE_PROVIDERS } from "../../lib/geo/tiles";

// Caché de tiles con fallback de proveedor (puerto tipado del patrón
// addTileLayerWithFallback de NOSEE). Los proveedores vienen de la ÚNICA
// config de tiles (shared/lib/geo/tiles): OSM por defecto, CARTO con key si
// VITE_CARTO_KEY está seteada. Acá se gestiona SOLO el fallo de RED real
// (`tileerror` sin cargar ningún tile, o timeout de 5s) — la watermark "API
// required" de CARTO keyless llega como HTTP 200 con un PNG válido y NUNCA
// emite `tileerror`, por eso ese caso se resuelve por config, jamás acá.

/**
 * Agrega el primer proveedor que funcione y devuelve la función de cleanup que
 * desconecta los timers pendientes y retira la capa activa del mapa.
 *
 * `onAllProvidersFailed` se invoca cuando TODOS los proveedores se agotaron
 * (tileerror sin cargar ningún tile o timeout) — el call site lo usa para
 * disparar el escape hatch numérico: sin tiles no hay input de ubicación.
 */
export function addTileLayerWithFallback(
  map: LeafletMap,
  onAllProvidersFailed?: () => void,
  timeoutMs = 5000,
): () => void {
  const timers: number[] = [];
  let activeLayer: TileLayer | null = null;

  const clearTimers = (): void => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.length = 0;
  };

  const removeLayer = (layer: TileLayer): void => {
    if (map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  };

  const tryProvider = (providerIndex: number): void => {
    if (providerIndex >= TILE_PROVIDERS.length) {
      onAllProvidersFailed?.();
      return;
    }
    const provider = TILE_PROVIDERS[providerIndex];
    const layer = L.tileLayer(provider.url, provider.options).addTo(map);
    activeLayer = layer;

    let loadedTile = false;
    layer.on("tileload", () => {
      loadedTile = true;
      clearTimers();
    });
    layer.once("tileerror", () => {
      if (loadedTile) return;
      removeLayer(layer);
      tryProvider(providerIndex + 1);
    });
    timers.push(
      window.setTimeout(() => {
        if (loadedTile) return;
        removeLayer(layer);
        tryProvider(providerIndex + 1);
      }, timeoutMs),
    );
  };

  tryProvider(0);

  return () => {
    clearTimers();
    if (activeLayer !== null) {
      removeLayer(activeLayer);
    }
  };
}
