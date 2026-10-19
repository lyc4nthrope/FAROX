import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PAGE_SIZE } from "../lib/list";
import { EmptyState, ErrorBanner } from "../ui";
import { useList, type ListFetcher } from "./useList";

// D7 (componente, sin red/DB): el hook no importa supabase — el fetcher es un
// mock. Cero realtime por construcción (§S8-4, gate T1.4 lo greps igual).

interface Fila {
  id: number;
  nombre: string;
}

const FILAS: Fila[] = [
  { id: 1, nombre: "Almacén Centro" },
  { id: 2, nombre: "Almacén Norte" },
];

// Pantalla mínimo-hábitat para la discriminación vacío-vs-error (D4):
// error⇒ErrorBanner · vacío sin error⇒EmptyState · filas⇒contenido.
function PantallaListado({ fetcher }: { fetcher: ListFetcher<Fila> }) {
  const list = useList<Fila>(fetcher);
  if (list.error !== null) {
    return <ErrorBanner message={list.error} />;
  }
  if (!list.loading && list.rows.length === 0) {
    return <EmptyState title="No hay nada todavía" />;
  }
  return <p>{`${list.rows.length} filas`}</p>;
}

afterEach(cleanup);

describe("useList (D4 — fetch/refetch/mutate→refetch, sin realtime)", () => {
  it("pide la primera página (pageSize 25) y expone filas, count y loading", async () => {
    const fetcher = vi.fn<ListFetcher<Fila>>().mockResolvedValue({
      rows: FILAS,
      count: 30,
      error: null,
    });
    const { result } = renderHook(() => useList(fetcher));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith({ page: 0, pageSize: PAGE_SIZE });
    expect(result.current.rows).toEqual(FILAS);
    expect(result.current.count).toBe(30);
    expect(result.current.error).toBeNull();
  });

  it("setPage pide la página siguiente con el mismo pageSize", async () => {
    const fetcher = vi.fn<ListFetcher<Fila>>().mockResolvedValue({
      rows: FILAS,
      count: 30,
      error: null,
    });
    const { result } = renderHook(() => useList(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setPage(1);
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    expect(fetcher).toHaveBeenNthCalledWith(2, { page: 1, pageSize: PAGE_SIZE });
    expect(result.current.query.page).toBe(1);
  });

  it("refetch vuelve a pedir la MISMA página (HARD-3, sin realtime)", async () => {
    const fetcher = vi.fn<ListFetcher<Fila>>().mockResolvedValue({
      rows: FILAS,
      count: 30,
      error: null,
    });
    const { result } = renderHook(() => useList(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.refetch();
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    expect(fetcher).toHaveBeenNthCalledWith(2, { page: 0, pageSize: PAGE_SIZE });
  });

  it("mutate con éxito refetchea la lista (HARD-3)", async () => {
    const fetcher = vi.fn<ListFetcher<Fila>>().mockResolvedValue({
      rows: FILAS,
      count: 30,
      error: null,
    });
    const { result } = renderHook(() => useList(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const mutacion = vi.fn().mockResolvedValue({ error: null });
    await act(async () => {
      const { error } = await result.current.mutate(mutacion);
      expect(error).toBeNull();
    });

    expect(mutacion).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it("mutate con error NO refetchea y devuelve el error al caller", async () => {
    const fetcher = vi.fn<ListFetcher<Fila>>().mockResolvedValue({
      rows: FILAS,
      count: 30,
      error: null,
    });
    const { result } = renderHook(() => useList(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const mutacion = vi
      .fn()
      .mockResolvedValue({ error: { message: "update_user_role: solo admin" } });
    await act(async () => {
      const { error } = await result.current.mutate(mutacion);
      expect(error?.message).toBe("update_user_role: solo admin");
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("vacío sin error ⇒ EmptyState, NO banner (PROD-1/STORE-2: vacío ≠ error)", async () => {
    const fetcher = vi.fn<ListFetcher<Fila>>().mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    render(<PantallaListado fetcher={fetcher} />);

    expect(await screen.findByText("No hay nada todavía")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("error del backend ⇒ ErrorBanner amigable; el crudo NUNCA llega (HARD-1)", async () => {
    // Forma REAL de una denegación PostgREST/RLS: lleva SQLSTATE 42501 en
    // `code` (0012:700 assertea v_sqlstate='42501' + errm 'permission
    // denied…'). El trigger D5 de permisos matchea por CODE, no por
    // substring: sin el code no hay match y cae al fallback (mapError.ts:62).
    // Variable (no literal inline) porque ListResult.error es { message } y
    // el literal con `code` dispararía el excess-property check de TS.
    const errorRLS = {
      code: "42501",
      message: "permission denied for table stores_geo",
    };
    const fetcher = vi.fn<ListFetcher<Fila>>().mockResolvedValue({
      rows: [],
      count: null,
      error: errorRLS,
    });
    render(<PantallaListado fetcher={fetcher} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });

  it("un fetcher que rechaza (sin red) degrada a mensaje de conexión, sin crash", async () => {
    const fetcher = vi
      .fn<ListFetcher<Fila>>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useList(fetcher));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("No se pudo conectar, revisá tu conexión.");
    expect(result.current.rows).toEqual([]);
  });
});
