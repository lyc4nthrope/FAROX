import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reverseGeocode } from "./nominatim";
import { REVERSE_GEOCODE_DEBOUNCE_MS, useReverseGeocode } from "./useReverseGeocode";

// El pipeline diferido del reverse geocode: debounce ~800ms, cancelable
// (schedule nuevo anula al anterior), best-effort (Nominatim null ⇒ sin
// callback) y seguro contra unmount.
vi.mock("./nominatim", () => ({
  reverseGeocode: vi.fn(),
}));

const PUNTO_A = { latitude: 4.6097, longitude: -74.0631 };
const PUNTO_B = { latitude: 4.711, longitude: -74.0721 };

describe("useReverseGeocode (pipeline diferido del pin)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(reverseGeocode).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resuelve después del debounce y entrega la dirección con su coordenada", async () => {
    vi.mocked(reverseGeocode).mockResolvedValue({
      latitude: PUNTO_A.latitude,
      longitude: PUNTO_A.longitude,
      address: "Calle 1 #2-3, Bogotá",
    });
    const onResolved = vi.fn();
    const { result } = renderHook(() => useReverseGeocode(onResolved));

    act(() => {
      result.current.schedule(PUNTO_A);
    });
    expect(reverseGeocode).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(REVERSE_GEOCODE_DEBOUNCE_MS);
    });

    expect(reverseGeocode).toHaveBeenCalledWith(PUNTO_A.latitude, PUNTO_A.longitude);
    expect(onResolved).toHaveBeenCalledWith("Calle 1 #2-3, Bogotá", PUNTO_A);
  });

  it("un schedule nuevo cancela al anterior: jamás se aplican dos fuera de orden", async () => {
    vi.mocked(reverseGeocode).mockImplementation(async (latitude, longitude) => ({
      latitude,
      longitude,
      address: `dir ${latitude}`,
    }));
    const onResolved = vi.fn();
    const { result } = renderHook(() => useReverseGeocode(onResolved));

    act(() => {
      result.current.schedule(PUNTO_A);
    });
    act(() => {
      vi.advanceTimersByTime(REVERSE_GEOCODE_DEBOUNCE_MS / 2);
    });
    act(() => {
      result.current.schedule(PUNTO_B);
    });
    await act(async () => {
      vi.advanceTimersByTime(REVERSE_GEOCODE_DEBOUNCE_MS);
    });

    // Solo el último pin llega a Nominatim y al form.
    expect(reverseGeocode).toHaveBeenCalledTimes(1);
    expect(reverseGeocode).toHaveBeenCalledWith(PUNTO_B.latitude, PUNTO_B.longitude);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith(`dir ${PUNTO_B.latitude}`, PUNTO_B);
  });

  it("Nominatim devuelve null (best-effort): onResolved NO se invoca", async () => {
    vi.mocked(reverseGeocode).mockResolvedValue(null);
    const onResolved = vi.fn();
    const { result } = renderHook(() => useReverseGeocode(onResolved));

    act(() => {
      result.current.schedule(PUNTO_A);
    });
    await act(async () => {
      vi.advanceTimersByTime(REVERSE_GEOCODE_DEBOUNCE_MS);
    });

    expect(onResolved).not.toHaveBeenCalled();
  });

  it("al desmontar cancela el timer pendiente y descarta la respuesta en vuelo", async () => {
    let resolveInFlight: (
      value: { latitude: number; longitude: number; address: string } | null,
    ) => void = () => {};
    vi.mocked(reverseGeocode).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInFlight = resolve;
        }),
    );
    const onResolved = vi.fn();
    const { result, unmount } = renderHook(() => useReverseGeocode(onResolved));

    act(() => {
      result.current.schedule(PUNTO_A);
    });
    await act(async () => {
      vi.advanceTimersByTime(REVERSE_GEOCODE_DEBOUNCE_MS);
    });
    expect(reverseGeocode).toHaveBeenCalledTimes(1);

    unmount();
    resolveInFlight({ latitude: PUNTO_A.latitude, longitude: PUNTO_A.longitude, address: "tarde" });
    await act(async () => {});

    expect(onResolved).not.toHaveBeenCalled();
  });
});
