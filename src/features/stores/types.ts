// Fila del listado: VIENE DE LA VISTA stores_geo (0004:1539-1548), la única
// fuente legal de lat/lng (Base:165 "los clientes solo necesitan coordenadas
// para el mapa ⇒ exponer la vista stores_geo"; STORE-2: el front NUNCA calcula
// ST_X/ST_Y). La vista expone id, name, city, country, is_active, lat, lng —
// st_x ⇒ lng y st_y ⇒ lat se evalúan EN SERVIDOR (0004:1546-1547). Se omiten
// country y address porque no se pintan en el listado (D4: select = solo lo
// que la UI muestra).
export interface StoreListRow {
  id: number;
  name: string;
  city: string | null;
  is_active: boolean;
  lat: number;
  lng: number;
}

// Fila para el formulario de edición: columna stores (0002:123-138). Se piden
// solo los campos del formulario — location se lee aparte vía stores_geo
// (STORE-2), created_by lo resuelve la policy en el backend (D4, igual que
// products) y country/website_url existen en la tabla (0002:129,132) pero
// NO están en idea:68 ni en el happy path STORE-1 ⇒ fuera del form (el server
// aplica 'CO'/NULL).
export interface StoreRow {
  id: number;
  name: string;
  store_type_id: number;
  address: string | null;
  city: string | null;
  phone: string | null;
}

// Coordenadas de la fila (stores_geo) para re-binddear los inputs numéricos
// del formulario con String() en el contenedor.
export interface StoreGeo {
  lat: number;
  lng: number;
}

// Catálogo store_types (solo lectura: catalogs_select USING true, 0006:76-77;
// sembrado con 1 fila — obs #485). Hace de opción del <select> de tipo en alta
// y edición (T7.2 "create via RPC" con store_type validado por el server).
export interface StoreTypeRef {
  id: number;
  name: string;
}
