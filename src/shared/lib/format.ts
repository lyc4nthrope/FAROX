// Formatos de presentación (es-CO).

const COP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 });

/** 2500 → "$ 2.500" */
export function formatCOP(value: number): string {
  return COP.format(value);
}

/** Cantidades con hasta 3 decimales: 2.5 → "2,5" */
export function formatQty(value: number): string {
  return value.toLocaleString("es-CO", { maximumFractionDigits: 3 });
}
