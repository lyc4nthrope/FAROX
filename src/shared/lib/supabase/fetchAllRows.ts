// Trae TODAS las filas de una consulta, página por página.
//
// Un .limit(500) fijo cortaba en silencio: los editores de precios recibían
// solo los primeros 500 productos, mostraban el resto "sin precio" y al
// guardar podían pisar precios reales. PAGE_SIZE queda por debajo del
// max_rows de PostgREST (1000 en supabase/config.toml), así que una página
// corta siempre significa que no hay más.

export const PAGE_SIZE = 500;
/** Tope de seguridad: 40 páginas (20 000 filas) por consulta. */
const MAX_PAGES = 40;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<PageResult<T>> {
  const rows: T[] = [];
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const from = index * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error !== null) return { data: null, error };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}
