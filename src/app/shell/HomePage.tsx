import { Link } from "react-router-dom";

import { ExampleDashboard, SectionIcon, type ExampleDashboardStat } from "../../shared/ui";
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
  "/faltantes": "Lo que falta en cada tienda, listo para pedir.",
  "/rutas": "Planificación de rutas de entrega.",
  "/dashboard": "Entradas y salidas por distribuidor (Premium).",
  "/movimientos": "Tus ventas a tiendas y tus compras a proveedor.",
  "/asistente": "Preguntá por stock y por el último pedido de un producto.",
  "/users": "Roles, Premium y alcance de cada usuario.",
  "/roles": "Descripción de los roles del sistema.",
  "/catalogs": "Marcas, categorías, unidades, tipos de tienda y motivos.",
  "/audit": "Quién cambió qué y cuándo.",
  "/mi-ruta": "Tu ruta de hoy, paradas y recorrido en el mapa.",
  "/vincular": "Escaneá el QR de una tienda para vincularte.",
};

// Vista de ejemplo del distribuidor: mismo panel visual que la landing, con
// pedidos y paradas en lugar de stock. No consulta datos reales.
const DISTRIBUTOR_PREVIEW_STATS: readonly [ExampleDashboardStat, ExampleDashboardStat] = [
  { label: "Pedidos", value: "12", hint: "3 en ruta" },
  { label: "Paradas", value: "3", hint: "2 pendientes" },
];

const DISTRIBUTOR_PREVIEW_STOPS = ["Tienda Central", "Mercado Norte", "Esquina Sur"] as const;

export function HomePage() {
  const { role, email, premium } = useAuth();
  const items = visibleNavItems(role);

  return (
    <section>
      <div className="relative overflow-hidden rounded-2xl border border-gray-800/60 bg-gradient-to-br from-gray-900 via-gray-900 to-gray-700 px-6 py-8 text-white shadow-sm sm:px-8 sm:py-10">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative">
          {/* La píldora Premium vive en la fila del rótulo y no junto al título:
              al compartir fila con el h1 no entraba en móviles de 360px y la
              cabecera se partía en dos filas. */}
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">
              Panel de control
            </p>
            {premium && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300/40 bg-amber-300/15 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                <svg aria-hidden="true" className="h-3 w-3 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2.5 14.6 9l6.9.5-5.3 4.5 1.7 6.7-5.9-3.6-5.9 3.6 1.7-6.7L2.5 9.5 9.4 9 12 2.5Z" />
                </svg>
                Premium
              </span>
            )}
          </div>
          {/* text-white explícito: la regla base `main h1` (index.css) gana a
              la herencia del contenedor y lo dejaba casi negro sobre oscuro. */}
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Bienvenido a FARØX
          </h1>
          <p className="mt-3 text-sm text-gray-300">
            Sesión iniciada como <span className="font-medium text-white">{roleLabel(role)}</span>
            {email === null ? "" : ` · ${email}`}.
          </p>
          <p className="mt-1 max-w-xl text-sm text-gray-400">
            Inventario, pedidos y rutas de tiendas y distribuidores en un solo lugar.
          </p>
        </div>
      </div>

      {role === "distribuidor" && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight">Tu día, de un vistazo</h2>
          <p className="mt-1 max-w-xl text-sm text-gray-600">
            Esta es una vista de ejemplo. Cuando tengas pedidos y ruta, vas a ver tus datos reales
            acá.
          </p>
          <div className="mt-4 max-w-sm">
            <ExampleDashboard stats={DISTRIBUTOR_PREVIEW_STATS} stops={DISTRIBUTOR_PREVIEW_STOPS} />
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Tus secciones</h2>
          <p className="mt-1 text-sm text-gray-500">
            Accesos rápidos según tu rol, sin pasos de más.
          </p>
        </div>
        <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-500">
          {items.length} {items.length === 1 ? "sección" : "secciones"}
        </span>
      </div>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className="group flex h-full items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition group-hover:bg-gray-900 group-hover:text-white">
                <SectionIcon to={item.to} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-medium text-gray-900">
                    {item.label}
                    {item.to === "/dashboard" && !premium && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        Premium
                      </span>
                    )}
                  </span>
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-gray-900"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <path d="M5 12h14m-6-6 6 6-6 6" />
                  </svg>
                </span>
                <span className="mt-1 block text-[13px] leading-snug text-gray-500">
                  {DESCRIPTIONS[item.to] ?? ""}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
