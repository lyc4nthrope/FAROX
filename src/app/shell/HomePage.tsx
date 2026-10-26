import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { ExampleDashboard, type ExampleDashboardStat } from "../../shared/ui";
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
  "/users": "Roles, Premium y alcance de cada usuario.",
  "/roles": "Descripción de los roles del sistema.",
  "/catalogs": "Marcas, categorías, unidades, tipos de tienda y motivos.",
  "/audit": "Quién cambió qué y cuándo.",
  "/mi-ruta": "Tu ruta de hoy, paradas y recorrido en el mapa.",
  "/vincular": "Escaneá el QR de una tienda para vincularte.",
};

const ICONS: Record<string, ReactNode> = {
  "/distributors": (
    <>
      <path d="M3 7h11v9H3zM14 10h3.5l3.5 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17.5" cy="18" r="1.6" />
    </>
  ),
  "/products": (
    <>
      <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
      <path d="m4 7 8 4 8-4M12 11v10" />
    </>
  ),
  "/stores": (
    <>
      <path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9Z" />
      <path d="m3 9 1.6-4.4A1 1 0 0 1 5.5 4h13a1 1 0 0 1 .9.6L21 9M9 20v-5h6v5" />
    </>
  ),
  "/inventario": (
    <>
      <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" />
      <path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" />
    </>
  ),
  "/alertas": (
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-2 8-2 8h16s-2-1-2-8" />
      <path d="M10.3 21a2 2 0 0 0 3.4 0" />
    </>
  ),
  "/pedidos": (
    <>
      <path d="M9 5h6M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="m9 13 2 2 4-4" />
    </>
  ),
  "/faltantes": (
    <>
      <path d="M12 4 3 20h18L12 4Z" />
      <path d="M12 10v4m0 3h.01" />
    </>
  ),
  "/fiado": (
    <>
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z" />
      <path d="M8 4v16M12 9h4M12 13h4" />
    </>
  ),
  "/rutas": (
    <>
      <path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  "/dashboard": (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  "/users": (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0M4 14.5A3 3 0 0 0 7 17.5M20 14.5a3 3 0 0 1-3 3" />
    </>
  ),
  "/roles": (
    <>
      <path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  "/catalogs": (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" />
    </>
  ),
  "/audit": (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
  "/mi-ruta": (
    <>
      <path d="M12 21s6-4.6 6-10a6 6 0 1 0-12 0c0 5.4 6 10 6 10Z" />
      <circle cx="12" cy="11" r="2" />
    </>
  ),
  "/vincular": (
    <>
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
      <path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" />
    </>
  ),
};

// Vista de ejemplo del distribuidor: mismo panel visual que la landing, con
// pedidos y paradas en lugar de stock. No consulta datos reales.
const DISTRIBUTOR_PREVIEW_STATS: readonly [ExampleDashboardStat, ExampleDashboardStat] = [
  { label: "Pedidos", value: "12", hint: "3 en ruta" },
  { label: "Paradas", value: "3", hint: "2 pendientes" },
];

const DISTRIBUTOR_PREVIEW_STOPS = ["Tienda Central", "Mercado Norte", "Esquina Sur"] as const;

function SectionIcon({ to }: { to: string }) {
  return (
    <svg
      aria-hidden="true"
      className="h-4.5 w-4.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {ICONS[to] ?? <path d="M5 12h14m-6-6 6 6-6 6" />}
    </svg>
  );
}

export function HomePage() {
  const { role, email, premium } = useAuth();
  const items = visibleNavItems(role);

  return (
    <section>
      <div className="relative overflow-hidden rounded-2xl border border-gray-800/60 bg-gradient-to-br from-gray-900 via-gray-900 to-gray-700 px-6 py-8 text-white shadow-sm sm:px-8 sm:py-10">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">
            Panel de control
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {/* text-white explícito: la regla base `main h1` (index.css) gana a
                la herencia del contenedor y lo dejaba casi negro sobre oscuro. */}
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Bienvenido a FARØX
            </h1>
            {premium && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/40 bg-amber-300/15 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                <svg aria-hidden="true" className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2.5 14.6 9l6.9.5-5.3 4.5 1.7 6.7-5.9-3.6-5.9 3.6 1.7-6.7L2.5 9.5 9.4 9 12 2.5Z" />
                </svg>
                Premium
              </span>
            )}
          </div>
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
