import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TILE_PROVIDERS } from "../../lib/geo/tiles";
import { LocationPicker } from "./LocationPicker";

// Leaflet MOCKEADO por completo: jsdom no puede correr el mapa real y así los
// tests verifican el pipeline imperativo (init, marker, click, drag, guards)
// sin tiles ni DOM real de Leaflet.
interface TileLayerMock {
  addTo: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

interface MarkerMock {
  addTo: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  setLatLng: ReturnType<typeof vi.fn>;
  getLatLng: ReturnType<typeof vi.fn>;
}

interface MapMock {
  on: ReturnType<typeof vi.fn>;
  setView: ReturnType<typeof vi.fn>;
  getZoom: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  invalidateSize: ReturnType<typeof vi.fn>;
  hasLayer: ReturnType<typeof vi.fn>;
  removeLayer: ReturnType<typeof vi.fn>;
}

interface LeafletMockState {
  maps: MapMock[];
  markers: MarkerMock[];
  tileLayers: TileLayerMock[];
  mapFactory: ReturnType<typeof vi.fn>;
  lastMapOptions: () => Record<string, unknown> | undefined;
}

vi.mock("leaflet", () => {
  const state: LeafletMockState = {
    maps: [],
    markers: [],
    tileLayers: [],
    mapFactory: vi.fn(),
    lastMapOptions: () => {
      const call = state.mapFactory.mock.calls.at(-1);
      return call === undefined ? undefined : (call[1] as Record<string, unknown>);
    },
  };
  state.mapFactory.mockImplementation(() => {
    const map: MapMock = {
      on: vi.fn(),
      setView: vi.fn(() => map),
      getZoom: vi.fn(() => 16),
      remove: vi.fn(),
      invalidateSize: vi.fn(),
      hasLayer: vi.fn(() => false),
      removeLayer: vi.fn(),
    };
    state.maps.push(map);
    return map;
  });
  return {
    __state: state,
    map: state.mapFactory,
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
      const marker: MarkerMock = {
        addTo: vi.fn(() => marker),
        on: vi.fn(),
        setLatLng: vi.fn(),
        getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
      };
      state.markers.push(marker);
      return marker;
    }),
    divIcon: vi.fn(() => ({})),
  };
});

const leafletState = (L as unknown as { __state: LeafletMockState }).__state;

function stubMatchMedia(coarse: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function stubGeolocation(): {
  succeed: (latitude: number, longitude: number) => void;
  fail: (code: number) => void;
} {
  let onSuccess: ((position: GeolocationPosition) => void) | null = null;
  let onError: ((error: GeolocationPositionError) => void) | null = null;
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn(
        (
          success: (position: GeolocationPosition) => void,
          failure: (error: GeolocationPositionError) => void,
        ) => {
          onSuccess = success;
          onError = failure;
        },
      ),
    },
  });
  return {
    succeed: (latitude, longitude) => {
      onSuccess?.({
        coords: {
          latitude,
          longitude,
          accuracy: 8,
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

function findMapClickHandler(): (event: { latlng: { lat: number; lng: number } }) => void {
  const call = leafletState.maps[0].on.mock.calls.find((entry: unknown[]) => entry[0] === "click");
  if (call === undefined) throw new Error("el mapa no registró handler de click");
  return call[1] as (event: { latlng: { lat: number; lng: number } }) => void;
}

describe("LocationPicker (mapa imperativo Leaflet)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubMatchMedia(false);
    stubGeolocation();
    vi.clearAllMocks();
    leafletState.maps.length = 0;
    leafletState.markers.length = 0;
    leafletState.tileLayers.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("la capa de tiles se crea con la config resuelta de geo/tiles (cero URLs hardcodeadas)", () => {
    render(<LocationPicker latitude={null} longitude={null} onLocationChange={vi.fn()} />);

    expect(L.tileLayer).toHaveBeenCalledTimes(1);
    expect(L.tileLayer).toHaveBeenCalledWith(TILE_PROVIDERS[0].url, TILE_PROVIDERS[0].options);
    // En el env de test no hay VITE_CARTO_KEY ⇒ el primario resuelto es OSM
    // (sin host cartocdn): el watermark "API key required" es imposible.
    expect(TILE_PROVIDERS[0].url).toBe(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    );
  });

  it("la vista inicial usa las coordenadas existentes (edición) y pinta el marker", () => {
    const onLocationChange = vi.fn();
    render(
      <LocationPicker latitude={4.6097} longitude={-74.0631} onLocationChange={onLocationChange} />,
    );

    expect(screen.getByRole("region", { name: "Ubicación de la tienda" })).toBeInTheDocument();
    expect(leafletState.maps[0].setView).toHaveBeenNthCalledWith(1, [4.6097, -74.0631], 16);
    // Ya hay marker en el punto guardado…
    expect(leafletState.markers).toHaveLength(1);
    // …y el GPS jamás lo mueve (guard hasInitializedWithGeo).
    expect(onLocationChange).not.toHaveBeenCalled();
    // Sin pin nuevo ⇒ sin reverse geocode: nunca se emitió ubicación.
    expect(leafletState.maps[0].setView).toHaveBeenCalledTimes(1);
  });

  it("sin coordenadas: el mapa arranca en el default SIN marker (Zod bloquearía el submit)", () => {
    render(<LocationPicker latitude={null} longitude={null} onLocationChange={vi.fn()} />);

    expect(leafletState.maps[0].setView).toHaveBeenNthCalledWith(1, [4.711, -74.0721], 16);
    expect(leafletState.markers).toHaveLength(0);
  });

  it("el GPS del dispositivo aplica el pin UNA sola vez cuando no hay coordenadas", async () => {
    const geo = stubGeolocation();
    const onLocationChange = vi.fn();
    render(<LocationPicker latitude={null} longitude={null} onLocationChange={onLocationChange} />);

    act(() => {
      geo.succeed(4.5, -74.25);
    });

    await waitFor(() =>
      expect(onLocationChange).toHaveBeenCalledWith({ latitude: 4.5, longitude: -74.25 }),
    );
    // El hook persistió la caché (señal de que la escalera corrió completa) y
    // el pin se aplicó exactamente una vez.
    await waitFor(() =>
      expect(window.localStorage.getItem("farox:last-known-location")).toContain("4.5"),
    );
    expect(onLocationChange).toHaveBeenCalledTimes(1);
    expect(leafletState.markers).toHaveLength(1);
  });

  it("el GPS NUNCA pisa coordenadas existentes (guard hasInitializedWithGeo de NOSEE 310-323)", async () => {
    const geo = stubGeolocation();
    const onLocationChange = vi.fn();
    render(
      <LocationPicker latitude={4.6097} longitude={-74.0631} onLocationChange={onLocationChange} />,
    );

    act(() => {
      geo.succeed(9.9, -9.9);
    });

    // La escalera del hook corrió (la caché se actualizó)…
    await waitFor(() =>
      expect(window.localStorage.getItem("farox:last-known-location")).toContain("9.9"),
    );
    // …pero las coordenadas GUARDADAS de la tienda quedan intactas.
    expect(onLocationChange).not.toHaveBeenCalled();
    expect(leafletState.markers[0].setLatLng).not.toHaveBeenCalled();
  });

  it("click en el mapa: emite coordenadas redondeadas a 6 decimales y mueve el marker", () => {
    const onLocationChange = vi.fn();
    render(
      <LocationPicker latitude={4.6097} longitude={-74.0631} onLocationChange={onLocationChange} />,
    );

    act(() => {
      findMapClickHandler()({ latlng: { lat: 4.1234567, lng: -74.0631999 } });
    });

    expect(onLocationChange).toHaveBeenCalledWith({
      latitude: 4.123457,
      longitude: -74.0632,
    });
    expect(leafletState.markers[0].setLatLng).toHaveBeenCalledWith([4.123457, -74.0632]);
  });

  it("dragend del marker: emite la posición final redondeada", () => {
    const onLocationChange = vi.fn();
    render(
      <LocationPicker latitude={4.6097} longitude={-74.0631} onLocationChange={onLocationChange} />,
    );
    leafletState.markers[0].getLatLng.mockReturnValue({ lat: 4.61, lng: -74.0629999 });
    const dragEnd = leafletState.markers[0].on.mock.calls.find(
      (entry: unknown[]) => entry[0] === "dragend",
    )?.[1] as () => void;

    act(() => {
      dragEnd();
    });

    expect(onLocationChange).toHaveBeenCalledWith({ latitude: 4.61, longitude: -74.063 });
  });

  it("puntero grueso: dragging desactivado en el mapa; scrollWheelZoom false SIEMPRE", () => {
    stubMatchMedia(true);
    const { unmount } = render(
      <LocationPicker latitude={null} longitude={null} onLocationChange={vi.fn()} />,
    );

    expect(leafletState.lastMapOptions()).toMatchObject({
      dragging: false,
      scrollWheelZoom: false,
    });
    unmount();

    stubMatchMedia(false);
    render(<LocationPicker latitude={null} longitude={null} onLocationChange={vi.fn()} />);
    expect(leafletState.lastMapOptions()).toMatchObject({
      dragging: true,
      scrollWheelZoom: false,
    });
  });

  it("disabled: el mapa no arranca arrastrable y el click no emite", () => {
    render(<LocationPicker latitude={null} longitude={null} onLocationChange={vi.fn()} disabled />);

    expect(leafletState.lastMapOptions()).toMatchObject({ dragging: false });
    expect(screen.queryByRole("button", { name: "Usar mi ubicación" })).not.toBeInTheDocument();
  });

  it("botón flotante [Usar mi ubicación]: refetch → aplica el pin y emite por el mismo pipeline", async () => {
    const user = userEvent.setup();
    const geo = stubGeolocation();
    // Sin caché: tras el fallo del mount la escalera cae a IP ⇒ se corta la
    // red para que termine en null y el botón quede habilitado.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("sin red"))),
    );
    const onLocationChange = vi.fn();
    render(<LocationPicker latitude={null} longitude={null} onLocationChange={onLocationChange} />);

    // La escalera de montaje termina (GPS no responde ⇒ PERMISSION_DENIED).
    act(() => {
      geo.fail(1);
    });
    const boton = await screen.findByRole("button", { name: "Usar mi ubicación" });
    await waitFor(() => expect(boton).toBeEnabled());

    await user.click(boton);
    expect(screen.getByText("Obteniendo tu ubicación…")).toBeInTheDocument();

    act(() => {
      geo.succeed(4.9, -74.1);
    });

    await waitFor(() =>
      expect(onLocationChange).toHaveBeenCalledWith({ latitude: 4.9, longitude: -74.1 }),
    );
    // El botón no tiene canal propio: pin nuevo + setView + emit redondeado.
    expect(leafletState.markers).toHaveLength(1);
    expect(leafletState.maps[0].setView).toHaveBeenLastCalledWith([4.9, -74.1], 16, {
      animate: false,
    });
    await waitFor(() =>
      expect(screen.queryByText("Obteniendo tu ubicación…")).not.toBeInTheDocument(),
    );
  });

  it("el desmonte retira el mapa y desconecta los observers (sin fugas)", () => {
    const { unmount } = render(
      <LocationPicker latitude={4.6097} longitude={-74.0631} onLocationChange={vi.fn()} />,
    );

    unmount();

    expect(leafletState.maps[0].remove).toHaveBeenCalledTimes(1);
  });
});
