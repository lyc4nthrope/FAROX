import type { RoleName } from "../../features/auth/types";

export interface NavItem {
  to: string;
  label: string;
}

// Orden de la tabla de rutas §S2 (obs #483). Visibilidad SEC-01:
// admin OK · operador sin /users ni rutas admin nuevas · distribuidor solo
// productos (solo lectura). sdd/admin-console T-C5: +Roles y +Catálogos;
// T-D2: +Auditoría (ADM-12.1/12.2 — audit_read es solo-admin 0006:330-332,
// así que /audit entra a la matriz de solo-admin, como /users).
export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/distributors", label: "Distribuidores" },
  { to: "/products", label: "Productos" },
  { to: "/stores", label: "Tiendas" },
  { to: "/inventario", label: "Inventario" },
  { to: "/alertas", label: "Alertas" },
  { to: "/pedidos", label: "Pedidos" },
  { to: "/fiado", label: "Fiado" },
  { to: "/rutas", label: "Rutas" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/users", label: "Usuarios" },
  { to: "/roles", label: "Roles" },
  { to: "/catalogs", label: "Catálogos" },
  { to: "/audit", label: "Auditoría" },
];

// Entradas SOLO-admin del nav: el operador nunca ve usuarios, roles,
// catálogos, auditoría ni la planificación de rutas.
const ADMIN_ONLY_PATHS: ReadonlySet<string> = new Set([
  "/users",
  "/roles",
  "/catalogs",
  "/audit",
  "/rutas",
]);

// Navegación del distribuidor: productos (lectura), su ruta, sus pedidos,
// sus alertas y el dashboard de lo suyo.
const DISTRIBUTOR_ITEMS: readonly NavItem[] = [
  { to: "/mi-ruta", label: "Mi ruta" },
  { to: "/pedidos", label: "Mis pedidos" },
  { to: "/vincular", label: "Vincular tienda" },
  { to: "/alertas", label: "Alertas" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/products", label: "Productos" },
];

// Derivación rol → entradas de nav. Rol null (inactivo o fila ausente) ⇒
// cero controles privilegiados: solo lectura de productos.
export function visibleNavItems(role: RoleName | null): NavItem[] {
  if (role === "admin") return [...NAV_ITEMS];
  if (role === "operador") {
    return NAV_ITEMS.filter((item) => !ADMIN_ONLY_PATHS.has(item.to));
  }
  if (role === "distribuidor") return [...DISTRIBUTOR_ITEMS];
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
    return NAV_ITEMS[0] ?? { to: "/products", label: "Productos" };
  }
  if (role === "distribuidor") return { to: "/mi-ruta", label: "Mi ruta" };
  return { to: "/products", label: "Productos" };
}
