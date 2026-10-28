import { useEffect, useRef } from "react";

import "leaflet/dist/leaflet.css";
import * as L from "leaflet";

import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "../../../shared/lib/geo/constants";
import { addTileLayerWithFallback } from "../../../shared/ui/LocationPicker/tileFallback";
import type { RequestStore } from "../api";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Pin cuadrado (sin esquinas redondeadas) con el número de orden de la lista.
function markerIcon(index: number): L.DivIcon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">
    <rect x="1" y="1" width="28" height="28" fill="#111827" stroke="#ffffff" stroke-width="2"/>
    <text x="15" y="20" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#ffffff">${index}</text>
    <path d="M9 30h12L15 40z" fill="#111827"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [30, 40],
    iconAnchor: [15, 40],
    popupAnchor: [0, -36],
  });
}

/**
 * Mapa de solo lectura con las tiendas marcadas, numeradas en el mismo orden
 * de la lista. No calcula ni guarda rutas: solo ubica las tiendas.
 */
export function StoreRouteMap({ stores }: { stores: readonly RequestStore[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;

    const map = L.map(container, {
      zoomControl: true,
      // Un mapa de consulta no debe robar el scroll de la página.
      scrollWheelZoom: false,
    }).setView([DEFAULT_MAP_CENTER.latitude, DEFAULT_MAP_CENTER.longitude], DEFAULT_MAP_ZOOM);
    mapRef.current = map;
    const removeTiles = addTileLayerWithFallback(map, () => {});
    const layer = L.layerGroup().addTo(map);
    layerRef.current = layer;
    const timer = window.setTimeout(() => map.invalidateSize(), 0);

    return () => {
      window.clearTimeout(timer);
      removeTiles();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (map === null || layer === null) return;
    layer.clearLayers();
    const points: L.LatLngExpression[] = [];

    stores.forEach((store, index) => {
      const marker = L.marker([store.lat, store.lng], {
        icon: markerIcon(index + 1),
      }).addTo(layer);
      const meta = [store.address, store.city].filter((value) => value !== null && value !== "");
      const metaLine = meta.length > 0 ? `<br/>${escapeHtml(meta.join(" · "))}` : "";
      marker.bindPopup(
        `<strong>${escapeHtml(store.name)}</strong>${metaLine}<br/>${store.orderCount} ${
          store.orderCount === 1 ? "solicitud" : "solicitudes"
        }`,
      );
      points.push([store.lat, store.lng]);
    });

    if (points.length === 1) {
      const only = points[0];
      if (only !== undefined) map.setView(only, 14, { animate: false });
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 14 });
    } else {
      map.setView(
        [DEFAULT_MAP_CENTER.latitude, DEFAULT_MAP_CENTER.longitude],
        DEFAULT_MAP_ZOOM,
        { animate: false },
      );
    }
  }, [stores]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        role="region"
        aria-label="Mapa de tiendas seleccionadas"
        className="h-full w-full"
      />
      {stores.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/75 p-4">
          <p className="max-w-xs border border-gray-300 bg-white px-4 py-3 text-center text-sm text-gray-700">
            Marcá tiendas de la lista para verlas en el mapa.
          </p>
        </div>
      )}
    </div>
  );
}
