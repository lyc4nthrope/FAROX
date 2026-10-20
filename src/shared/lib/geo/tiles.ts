import { z } from "zod";

// Configuración de tiles del mapa — el ÚNICO módulo que conoce las URLs de
// basemaps (LocationPicker + tileFallback la consumen; nada de literals
// repartidos por la UI).
//
// Por qué CONFIG y no detección runtime: CARTO raster exige API key gratuita
// y, SIN la key, devuelve HTTP 200 con un PNG VÁLIDO que tiene "API key
// required" pintado DENTRO de la imagen. Es indetectable desde el cliente:
// ni status, ni content-type, ni el evento `tileerror` de Leaflet (que solo
// se dispara en fallo de red real). La única defensa es elegir el proveedor
// por env var: `VITE_CARTO_KEY` presente ⇒ CARTO con `?key=`; ausente ⇒
// OpenStreetMap, que no necesita ninguna key.

export interface TileProvider {
  url: string;
  options: {
    attribution: string;
    maxZoom: number;
    subdomains?: string;
  };
}

// OSM como primario por defecto (el único que funciona sin key).
const OSM_TILE_PROVIDER: TileProvider = {
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  options: {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    subdomains: "abc",
  },
};

function cartoTileProvider(apiKey: string): TileProvider {
  return {
    url: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(apiKey)}`,
    options: {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
      subdomains: "abcd",
    },
  };
}

// A diferencia de loadEnv() (env.ts), VITE_CARTO_KEY es OPCIONAL: una key
// faltante o vacía NO puede tumbar el arranque — el default OSM no requiere
// ninguna. Mismo patrón Zod + safeParse, pero sin ConfigError.
const tilesEnvSchema = z.object({
  VITE_CARTO_KEY: z.string().nullish(),
});

/**
 * Resuelve la lista de proveedores de tiles (primario primero) según el env.
 * Fuente pura y testeable: la app la llama con `import.meta.env`.
 */
export function resolveTileProviders(
  source: Record<string, unknown>,
): readonly TileProvider[] {
  const parsed = tilesEnvSchema.safeParse(source);
  const key = parsed.success ? parsed.data.VITE_CARTO_KEY?.trim() : undefined;
  if (key === undefined || key === "") return [OSM_TILE_PROVIDER];
  // Con key: CARTO primario + OSM como fallback de RED (tileerror/timeout).
  // Sin key: OSM es el ÚNICO proveedor — meter CARTO keyless como fallback
  // reinstalaría el bug (tileerror jamás se dispara contra la watermark).
  return [cartoTileProvider(key), OSM_TILE_PROVIDER];
}

// Resolución única para la app (se lee al importar el módulo, igual que el
// resto del env de Vite).
export const TILE_PROVIDERS: readonly TileProvider[] = resolveTileProviders(
  import.meta.env,
);
