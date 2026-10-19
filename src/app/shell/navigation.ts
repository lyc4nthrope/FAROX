import type { RoleName } from "../../features/auth/types";

export interface NavItem {
  to: string;
  label: string;
}

// Orden de la tabla de rutas §S2 (obs #483). Visibilidad SEC-01:
// admin OK · operador sin /users · distribuidor solo productos (solo lectura).
export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/distributors", label: "Distribuidores" },
  { to: "/products", label: "Productos" },
  { to: "/stores", label: "Tiendas" },
  { to: "/users", label: "Usuarios" },
];

// Derivación rol → entradas de nav (V0-5). Rol null (my_role() = NULL por
// inactivo o fila ausente, V0-3) ⇒ cero controles privilegiados: solo lectura
// de productos, que no está scope-gateada en la DB (products_select USING true).
export function visibleNavItems(role: RoleName | null): NavItem[] {
  if (role === "admin") return [...NAV_ITEMS];
  if (role === "operador") return NAV_ITEMS.filter((item) => item.to !== "/users");
  return [{ to: "/products", label: "Productos" }];
}

export function roleLabel(role: RoleName | null): string {
  switch (role) {
    case "admin":
      return "Administrador";
    case "operador":
      return "Operador";
    case "distribuidor":
      return "Distribuidor";
    default:
      return "Sin rol";
  }
}

// Primera ruta permitida del mapa §S2 por rol (Home "/" la ofrece como entrada).
export function firstAllowedRoute(role: RoleName | null): NavItem {
  if (role === "admin" || role === "operador") {
    return NAV_ITEMS[0];
  }
  return { to: "/products", label: "Productos" };
}
