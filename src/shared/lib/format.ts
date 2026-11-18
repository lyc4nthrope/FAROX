// Formatos de presentación (es-CO).

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 2,
});

/** 2500 → "$ 2.500" */
export function formatCOP(value: number): string {
  return COP.format(value);
}

/** Cantidades con hasta 3 decimales: 2.5 → "2,5" */
export function formatQty(value: number): string {
  return value.toLocaleString("es-CO", { maximumFractionDigits: 3 });
}

/**
 * Abreviatura visible de la unidad (0059). El catálogo siembra
 * Unidad/Kilogramo/Litro; se aceptan también las abreviaturas ya guardadas.
 */
export function unitAbbreviation(name: string | null | undefined): string {
  const normalized = (name ?? "").toLocaleLowerCase("es").trim();
  if (normalized.startsWith("kilogramo") || normalized === "kg") return "kg";
  if (normalized.startsWith("litro") || normalized === "lt" || normalized === "l") return "L";
  if (normalized.startsWith("unidad") || normalized === "und") return "und";
  return name ?? "";
}

/** 2.5 + "Kilogramo" → "2,5 kg"; 18 + "Unidad" → "18 und". */
export function formatQtyUnit(value: number, unitName: string | null | undefined): string {
  const unit = unitAbbreviation(unitName);
  return unit === "" ? formatQty(value) : `${formatQty(value)} ${unit}`;
}

/**
 * 0059: unidad visible según el modo de venta. Un producto por unidad se
 * cuenta en paquetes aunque su medida sea L o kg (agua 1 L = botellas), así
 * que se muestra "und". El granel conserva kg/L.
 */
export function saleUnit(
  isBulk: boolean | null | undefined,
  unitName: string | null | undefined,
): string {
  return isBulk === false ? "und" : unitAbbreviation(unitName);
}
