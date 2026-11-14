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
//
// /asistente ya NO es una entrada de nav: el chat vive en el widget flotante
// (AssistantWidget) y la ruta /asistente sigue existiendo para enlaces
// directos. Tenerlo en los dos lugares duplicaba la misma pantalla.
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
  { to: "/planes", label: "Planes" },
  { to: "/pagos", label: "Pagos" },
  { to: "/roles", label: "Roles" },
  { to: "/catalogs", label: "Catálogos" },
  { to: "/audit", label: "Auditoría" },
];

// Operador: orden por frecuencia de uso real. Primero el día a día
// (inventario, pedidos, alertas, faltantes, fiado); después la configuración
// de la red (tiendas, distribuidores) y al final la analítica.
// Entradas SOLO-admin: usuarios, roles, catálogos, auditoría, planificación de
// rutas y la administración de planes/pagos. Nunca aparecen acá.
const OPERATOR_ITEMS: readonly NavItem[] = [
  { to: "/inventario", label: "Inventario" },
  { to: "/pedidos", label: "Pedidos" },
  { to: "/alertas", label: "Alertas" },
  { to: "/fiado", label: "Fiado" },
  { to: "/distributors", label: "Mis distribuidores" },
  { to: "/dashboard", label: "Dashboard" },
];

// Navegación del distribuidor: primero lo que usa a diario (ruta, pedidos,
// movimientos, catálogo), después el seguimiento (alertas, dashboard).
// «Vincular tienda» es una acción de configuración: vive en Perfil y en los
// estados vacíos de pedidos/ruta, no como entrada permanente del nav. Los
// faltantes NO van acá: el distribuidor solo se entera del faltante cuando el
// operador le crea un pedido (0023).
const DISTRIBUTOR_ITEMS: readonly NavItem[] = [
  { to: "/mi-ruta", label: "Mi ruta" },
  { to: "/pedidos", label: "Mis pedidos" },
  { to: "/movimientos", label: "Movimientos" },
  { to: "/products", label: "Productos" },
  { to: "/alertas", label: "Alertas" },
  { to: "/dashboard", label: "Dashboard" },
];

// Derivación rol → entradas de nav. Rol null (inactivo o fila ausente) ⇒
// cero controles privilegiados: solo lectura de productos.
export function visibleNavItems(role: RoleName | null): NavItem[] {
  if (role === "admin") return [...NAV_ITEMS];
  if (role === "operador") return [...OPERATOR_ITEMS];
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
  return visibleNavItems(role)[0] ?? { to: "/products", label: "Productos" };
}
