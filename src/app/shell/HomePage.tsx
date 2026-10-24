import { Link } from "react-router-dom";

import { useAuth } from "../providers/AuthProvider";
import { roleLabel, visibleNavItems } from "./navigation";

// Descripción corta de cada sección para las tarjetas del inicio.
const DESCRIPTIONS: Record<string, string> = {
  "/distributors": "Empresas que abastecen a las tiendas.",
  "/products": "Catálogo general de productos.",
  "/stores": "Tus tiendas y su ubicación.",
  "/inventario": "Stock, entradas, salidas y precios por tienda.",
  "/alertas": "Productos por agotarse o vencer y pedidos atrasados.",
  "/pedidos": "Pedidos a distribuidores y confirmación de entregas.",
  "/fiado": "Créditos de las tiendas y sus pagos.",
  "/rutas": "Planificación de rutas de entrega.",
  "/dashboard": "Entradas y salidas por distribuidor (Premium).",
  "/users": "Roles, Premium y alcance de cada usuario.",
  "/roles": "Descripción de los roles del sistema.",
  "/catalogs": "Marcas, categorías, unidades, tipos de tienda y motivos.",
  "/audit": "Quién cambió qué y cuándo.",
  "/mi-ruta": "Tu ruta de hoy, paradas y recorrido en el mapa.",
  "/vincular": "Escaneá el QR de una tienda para vincularte.",
};

export function HomePage() {
  const { role, email, premium } = useAuth();
  const items = visibleNavItems(role);

  return (
    <section>
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Bienvenido a FARØX</h1>
        <p className="mt-2 text-sm text-gray-600">
          Sesión iniciada como <span className="font-medium">{roleLabel(role)}</span>
          {email === null ? "" : ` · ${email}`}.
          {premium && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Premium</span>}
        </p>
        <p className="mt-1 text-sm text-gray-600">
          Inventario, pedidos y rutas de tiendas y distribuidores en un solo lugar.
        </p>
      </div>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className="block h-full rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:border-gray-900 focus:outline-2 focus:outline-gray-900"
            >
              <span className="block font-semibold text-gray-900">{item.label}</span>
              <span className="mt-1 block text-sm text-gray-600">{DESCRIPTIONS[item.to] ?? ""}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
