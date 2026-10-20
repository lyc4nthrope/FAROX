import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as L from "leaflet";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TILE_PROVIDERS } from "../../lib/geo/tiles";
import { MapLocationField } from "./MapLocationField";

// Leaflet MOCKEADO: el test ejercita el camino de escape hatch del WRAPPER
// (lazy + ErrorBoundary) sin tocar tiles reales. El fallo de tiles se
// dispara con el evento real `tileerror` en CADA proveedor resuelto por
// shared/lib/geo/tiles (OSM solo, o CARTO+OSM con VITE_CARTO_KEY) — los
// tests son agnósticos a cuántos haya.
interface TileLayerMock {
  addTo: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

interface LeafletMockState {
  tileLayers: TileLayerMock[];
}

vi.mock("leaflet", () => {
  const state: LeafletMockState = { tileLayers: [] };
  return {
    __state: state,
    map: vi.fn(() => {
      const map = {
        on: vi.fn(),
        setView: vi.fn(() => map),
        getZoom: vi.fn(() => 16),
        remove: vi.fn(),
        invalidateSize: vi.fn(),
        hasLayer: vi.fn(() => false),
        removeLayer: vi.fn(),
      };
      return map;
    }),
    tileLayer: vi.fn(() => {
      const layer: TileLayerMock = {
        addTo: vi.fn(() => layer),
        on: vi.fn(),
        once: vi.fn(),
        remove: vi.fn(),
      };
      state.tileLayers.push(layer);
      return layer;
    }),
    marker: vi.fn(() => {
      const marker = {
        addTo: vi.fn(() => marker),
        on: vi.fn(),
        setLatLng: vi.fn(),
        getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
      };
      return marker;
    }),
    divIcon: vi.fn(() => ({})),
  };
});

const leafletState = (L as unknown as { __state: LeafletMockState }).__state;

/** Dispara el `tileerror` registrado por la capa de tiles MÁS reciente. */
function fireTileErrorOnLastLayer(): void {
  const layer = leafletState.tileLayers.at(-1);
  if (layer === undefined) throw new Error("no hay capa de tiles creada");
  const handler = layer.once.mock.calls.find(
    (entry: unknown[]) => entry[0] === "tileerror",
  )?.[1] as (() => void) | undefined;
  if (handler === undefined) throw new Error("la capa no registró tileerror");
  act(() => {
    handler();
  });
}

/** Agota la lista de proveedores resuelta por geo/tiles (uno por capa). */
function fireTileErrorOnEveryProvider(): void {
  for (let index = 0; index < TILE_PROVIDERS.length; index += 1) {
    fireTileErrorOnLastLayer();
  }
}

function renderField() {
  return render(
    <MapLocationField
      latitude=""
      longitude=""
      onLocationChange={vi.fn()}
      onCoordinateTextChange={vi.fn()}
    />,
  );
}

describe("MapLocationField · escape hatch por TILES caídos", () => {
  beforeEach(() => {
    window.localStorage.clear();
    leafletState.tileLayers.length = 0;
    // jsdom no implementa geolocalización: se fija para que la escalera del
    // hook salte directo a UNSUPPORTED y NINGÚN test toque la red.
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    // El error que el ErrorBoundary captura se loguea por React: se silencia
    // para que la salida del suite quede limpia.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renderiza el mapa primero (lazy resuelve) y sus proveedores de tiles", async () => {
    renderField();

    expect(
      await screen.findByRole("region", { name: "Ubicación de la tienda" }),
    ).toBeInTheDocument();
    expect(leafletState.tileLayers).toHaveLength(1);
    expect(
      screen.queryByText("No se pudo cargar el mapa. Ingresá las coordenadas manualmente."),
    ).not.toBeInTheDocument();
  });

  it("todos los proveedores de la config caen ⇒ el ErrorBoundary pinta los inputs numéricos legacy + warning", async () => {
    renderField();
    await screen.findByRole("region", { name: "Ubicación de la tienda" });

    // Se agota la lista COMPLETA resuelta por geo/tiles (una capa por
    // proveedor): con VITE_CARTO_KEY, CARTO ⇒ OSM; sin key, solo OSM.
    fireTileErrorOnEveryProvider();
    expect(leafletState.tileLayers).toHaveLength(TILE_PROVIDERS.length);

    expect(
      await screen.findByText("No se pudo cargar el mapa. Ingresá las coordenadas manualmente."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Latitud (-90 a 90)")).toBeInTheDocument();
    expect(screen.getByLabelText("Longitud (-180 a 180)")).toBeInTheDocument();
    // El picker ya no está montado (un solo punto de render, sin duplicados).
    expect(
      screen.queryByRole("region", { name: "Ubicación de la tienda" }),
    ).not.toBeInTheDocument();
  });

  it("los inputs del escape hatch por tiles siguen siendo operativos (escriben al form)", async () => {
    const user = userEvent.setup();
    // Harness con estado REAL (mismo ciclo controlado que el form): el texto
    // escrito tiene que volver al input y quedar en values.lat del contenedor.
    function Harness() {
      const [coords, setCoords] = useState({ latitude: "", longitude: "" });
      return (
        <MapLocationField
          latitude={coords.latitude}
          longitude={coords.longitude}
          onLocationChange={vi.fn()}
          onCoordinateTextChange={setCoords}
        />
      );
    }
    render(<Harness />);
    await screen.findByRole("region", { name: "Ubicación de la tienda" });

    fireTileErrorOnEveryProvider();
    await screen.findByText("No se pudo cargar el mapa. Ingresá las coordenadas manualmente.");

    await user.type(screen.getByLabelText("Latitud (-90 a 90)"), "4.6097");
    await user.type(screen.getByLabelText("Longitud (-180 a 180)"), "-74.0631");

    expect(screen.getByLabelText("Latitud (-90 a 90)")).toHaveValue(4.6097);
    expect(screen.getByLabelText("Longitud (-180 a 180)")).toHaveValue(-74.0631);
  });
});
