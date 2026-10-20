import { describe, expect, it } from "vitest";

import { resolveTileProviders } from "./tiles";

// Regresión del watermark "API key required": CARTO raster SIN key devuelve
// HTTP 200 con un PNG válido que tiene el texto pintado DENTRO de la imagen
// — indetectable por status o `tileerror`. Por eso la selección del
// basemap es CONFIG (VITE_CARTO_KEY), nunca detección runtime.
describe("resolveTileProviders (config de tiles)", () => {
  it("sin VITE_CARTO_KEY ⇒ OSM: sin host cartocdn en toda la config", () => {
    const providers = resolveTileProviders({
      VITE_SUPABASE_URL: "https://example.supabase.co",
    });

    expect(providers).toHaveLength(1);
    expect(providers[0].url).toBe("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(providers[0].url).not.toContain("cartocdn");
    expect(providers[0].options).toEqual({
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
      subdomains: "abc",
    });
    // NADA de CARTO keyless en la lista: sería fallback muerto (tileerror
    // jamás se dispara contra la watermark) con tiles pintados.
    expect(JSON.stringify(providers)).not.toContain("cartocdn");
  });

  it("con VITE_CARTO_KEY ⇒ CARTO primario con ?key= + OSM como fallback de red", () => {
    const providers = resolveTileProviders({ VITE_CARTO_KEY: "abc123" });

    expect(providers).toHaveLength(2);
    expect(providers[0].url).toBe(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=abc123",
    );
    expect(providers[0].url).toContain("key=");
    expect(providers[0].options).toEqual({
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
      subdomains: "abcd",
    });
    expect(providers[1].url).toBe("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png");
  });

  it("key vacía o solo espacios ⇒ OSM (una key faltante NUNCA tumbar el arranque)", () => {
    expect(resolveTileProviders({ VITE_CARTO_KEY: "" })[0].url).not.toContain("cartocdn");
    expect(resolveTileProviders({ VITE_CARTO_KEY: "   " })[0].url).not.toContain("cartocdn");
    expect(resolveTileProviders({})[0].url).not.toContain("cartocdn");
  });

  it("la key viaja encodeada en la URL (caracteres raros no rompen el template)", () => {
    const providers = resolveTileProviders({ VITE_CARTO_KEY: "a b&c" });

    expect(providers[0].url).toContain("key=a%20b%26c");
  });
});
