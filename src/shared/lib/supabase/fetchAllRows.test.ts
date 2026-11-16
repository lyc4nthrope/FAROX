import { describe, expect, it, vi } from "vitest";

import { fetchAllRows, PAGE_SIZE } from "./fetchAllRows";

function pages(...sizes: number[]) {
  let next = 0;
  return vi.fn(async (from: number, to: number) => {
    const size = sizes[next] ?? 0;
    next += 1;
    expect(to - from + 1).toBe(PAGE_SIZE);
    return { data: Array.from({ length: size }, (_, i) => ({ id: from + i })), error: null };
  });
}

describe("fetchAllRows", () => {
  it("sigue pidiendo páginas hasta traer todas las filas", async () => {
    const page = pages(PAGE_SIZE, PAGE_SIZE, 3);

    const { data, error } = await fetchAllRows(page);

    expect(error).toBeNull();
    expect(data).toHaveLength(PAGE_SIZE * 2 + 3);
    expect(page).toHaveBeenCalledTimes(3);
    expect(page).toHaveBeenNthCalledWith(2, PAGE_SIZE, PAGE_SIZE * 2 - 1);
  });

  it("una página con error devuelve el error y ningún dato parcial", async () => {
    const page = vi
      .fn()
      .mockResolvedValueOnce({ data: Array(PAGE_SIZE).fill({}), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    expect(await fetchAllRows(page)).toEqual({ data: null, error: { message: "boom" } });
  });

  it("si llega al tope de páginas devuelve error en vez de datos incompletos", async () => {
    const page = vi.fn(async () => ({ data: Array(PAGE_SIZE).fill({}), error: null }));

    const { data, error } = await fetchAllRows(page);

    expect(data).toBeNull();
    expect(error?.message).toMatch(/demasiadas filas/i);
  });
});
