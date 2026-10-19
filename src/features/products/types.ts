// Referencia mínima de catálogo (brands / unit_types / product_categories —
// catálogos de solo lectura, policies 0006:66-120). En el listado llega
// embebida en 1 request (Base:698) y en el formulario hace de opción de los
// <select> de FK (T6.2 "catalog FK selects").
export interface CatalogRef {
  id: number;
  name: string;
}

// Fila del listado (§S2 /products: nombre + marca/unidad/categoría + estado).
// El select explícito excluye description (Base:695, "sin description en
// listados") y la columna generada de búsqueda (Base:140 — el front nunca la
// trae). Las FK son NOT NULL (0002:94-96) pero el tipo las deja nullable: el
// JSON de PostgREST puede traer el embed ausente y la UI degrada a "—".
export interface ProductListRow {
  id: number;
  name: string;
  is_active: boolean;
  brand: CatalogRef | null;
  unit: CatalogRef | null;
  category: CatalogRef | null;
}

// Fila para el formulario de edición (tabla products, 0002:90-100). NO se pide
// created_by (D4: select = solo lo que la UI muestra; la policy de escritura
// 0006:150-155 resuelve el ownership en el backend). base_quantity normaliza a
// number para re-binddear el <input> con String() en el contenedor.
export interface ProductRow {
  id: number;
  name: string;
  description: string | null;
  category_id: number;
  brand_id: number;
  unit_type_id: number;
  base_quantity: number;
  barcode: string | null;
}
