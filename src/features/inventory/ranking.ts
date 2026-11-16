/**
 * 0040: ordena las opciones del ticket por unidades vendidas (desc). Los
 * productos sin ventas quedan al final, alfabéticos. Es una función pura para
 * poder probar el orden sin renderizar el chat de movimientos.
 */
export function sortBySalesRanking<T extends { id: number; name: string }>(
  options: readonly T[],
  ranking: ReadonlyMap<number, number>,
): T[] {
  return [...options].sort((a, b) => {
    const difference = (ranking.get(b.id) ?? 0) - (ranking.get(a.id) ?? 0);
    if (difference !== 0) return difference;
    return a.name.localeCompare(b.name, "es");
  });
}
