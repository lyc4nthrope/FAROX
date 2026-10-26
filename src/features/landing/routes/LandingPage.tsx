import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { ExampleDashboard, type ExampleDashboardStat } from "../../../shared/ui";

interface Feature {
  title: string;
  description: string;
  icon: ReactNode;
}

interface RoleCard {
  title: string;
  description: string;
  bullets: readonly string[];
}

const ROLES: readonly RoleCard[] = [
  {
    title: "Administrador",
    description: "Configura el sistema completo y supervisa la operación.",
    bullets: [
      "Usuarios, roles y Premium",
      "Catálogos, precios y auditoría",
      "Rutas y control total del negocio",
    ],
  },
  {
    title: "Operador de tienda",
    description: "El día a día de una o varias tiendas, sin hojas de cálculo.",
    bullets: [
      "Stock, umbrales y alertas",
      "Pedidos y confirmación de entregas",
      "Fiado, pagos y QR de vínculo",
    ],
  },
  {
    title: "Distribuidor",
    description: "Pedidos, entregas y la ruta del día desde el celular.",
    bullets: [
      "Pedidos dirigidos a tu empresa",
      "Ruta con paradas y Google Maps",
      "Vinculación con tiendas por QR",
    ],
  },
];

const FEATURES: readonly Feature[] = [
  {
    title: "Inventario y alertas",
    description:
      "Stock por tienda con umbrales y vencimientos. Lo que se agota o vence aparece antes de que sea un problema.",
    icon: (
      <path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7ZM3.3 8.5 12 13l8.7-4.5M12 13v8" />
    ),
  },
  {
    title: "Pedidos y entregas",
    description:
      "Del pedido a la entrega, con cantidades parciales y stock que se actualiza al confirmar.",
    icon: (
      <path d="M9 5h6M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 8 1.8 1.8L15 8.6" />
    ),
  },
  {
    title: "Rutas de entrega",
    description:
      "Planificá el recorrido, ordená las paradas y abrí el mapa para llegar sin desvíos.",
    icon: (
      <path d="M12 21s6-4.6 6-10a6 6 0 1 0-12 0c0 5.4 6 10 6 10Zm0-8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    ),
  },
  {
    title: "Fiado y créditos",
    description:
      "Ventas a crédito con vencimiento y pagos registrados. El saldo de cada tienda, siempre claro.",
    icon: (
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7.5Zm0 3.5h18M16 15h2" />
    ),
  },
  {
    title: "Catálogos",
    description:
      "Marcas, categorías, unidades y tipos de tienda en un solo lugar, listos para toda la red.",
    icon: (
      <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Zm9 9-9 4.5L3 12m18 4.5-9 4.5-9-4.5" />
    ),
  },
  {
    title: "Auditoría",
    description:
      "Quién cambió qué y cuándo. Historial legible para resolver dudas sin depender de la memoria.",
    icon: (
      <path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Zm0 5v4m0 3h.01" />
    ),
  },
];

const STEPS: readonly { title: string; description: string }[] = [
  {
    title: "Creá tu cuenta",
    description: "Nombre, email y contraseña. Aceptá la Política de Privacidad y listo.",
  },
  {
    title: "Confirmá tu email",
    description:
      "Te enviamos un email de verificación. Sin confirmarlo no vas a poder iniciar sesión.",
  },
  {
    title: "Configurá tu negocio",
    description:
      "Creá tu tienda, registrá tu distribuidora o esperá a que el admin te asigne acceso.",
  },
];

const PREVIEW_STATS: readonly [ExampleDashboardStat, ExampleDashboardStat] = [
  { label: "Pedidos", value: "12", hint: "3 en ruta" },
  { label: "Stock bajo", value: "4", hint: "productos" },
];

const PREVIEW_STOPS = ["Tienda Central", "Mercado Norte", "Esquina Sur"] as const;

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-white text-gray-900">
      <header className="sticky top-0 z-20 border-b border-gray-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <Link
            to="/"
            className="text-lg font-semibold tracking-[0.22em] text-gray-900"
            aria-label="FARØX, inicio"
          >
            FARØX
          </Link>
          <nav aria-label="Acceso" className="ml-auto flex items-center gap-1 text-sm">
            <Link
              to="/login"
              className="rounded px-3 py-2 text-gray-700 hover:bg-gray-100 hover:text-gray-900"
            >
              Iniciar sesión
            </Link>
            <Link
              to="/register"
              className="rounded bg-gray-900 px-3 py-2 font-medium text-white hover:bg-gray-700"
            >
              Registrarse
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-gray-200 bg-gradient-to-b from-gray-50 via-white to-white">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_0%,rgba(17,24,39,0.08),transparent_55%)]"
          />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:py-24 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                Tiendas · Distribuidores · Rutas
              </p>
              <h1 className="mt-4 max-w-xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
                Todo tu negocio, <span className="text-gray-400">en orden.</span>
              </h1>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-gray-600">
                FARØX conecta tiendas y distribuidores: inventario, pedidos, entregas,
                rutas y fiado en una sola app. Menos planillas, menos llamadas, más
                control.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/register"
                  className="rounded-lg bg-gray-900 px-8 py-4 text-base font-medium text-white shadow-sm transition hover:bg-gray-700 focus:outline-2 focus:outline-offset-2 focus:outline-gray-900"
                >
                  Empezar ahora
                </Link>
                <Link
                  to="/login"
                  className="rounded-lg border border-gray-300 bg-white px-5 py-4 text-sm font-medium text-gray-800 hover:bg-gray-50"
                >
                  Ya tengo cuenta
                </Link>
              </div>
              <p className="mt-4 text-xs text-gray-500">
                Creá tu cuenta y confirmá tu email para activar el acceso.
              </p>
            </div>

            <div aria-hidden="true" className="relative mx-auto w-full max-w-sm lg:max-w-none">
              <div className="absolute -inset-4 rounded-[2rem] bg-gray-200/50 blur-2xl" />
              <ExampleDashboard stats={PREVIEW_STATS} stops={PREVIEW_STOPS} />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Un sistema, tres formas de trabajar
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">
            Cada persona ve lo que necesita. La misma base de datos mantiene el stock,
            los pedidos y las rutas sincronizados.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {ROLES.map((role) => (
              <article
                key={role.title}
                className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
              >
                <h3 className="font-semibold text-gray-900">{role.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">
                  {role.description}
                </p>
                <ul className="mt-4 space-y-2 text-sm text-gray-700">
                  {role.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
                      {bullet}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-gray-200 bg-gray-50">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Todo lo que pasa en tu operación
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">
              De la entrada de mercancía al pago del fiado: cada movimiento queda
              registrado y cada rol ve solo lo que le corresponde.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <article
                  key={feature.title}
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-900">
                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {feature.icon}
                    </svg>
                  </span>
                  <h3 className="mt-4 font-semibold text-gray-900">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">
                    {feature.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="como-funciona" className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Empezá en tres pasos
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">
            Sin instalaciones ni configuraciones largas: tu cuenta queda lista para
            trabajar el mismo día.
          </p>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-xl border border-gray-200 bg-white p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white">
                  {index + 1}
                </span>
                <h3 className="mt-4 font-semibold text-gray-900">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-gray-200 bg-gray-900">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-12 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-semibold text-white">
                ¿Listo para ordenar tu operación?
              </h2>
              <p className="mt-1 text-sm text-gray-300">
                Creá tu cuenta, confirmá tu email y empezá a trabajar.
              </p>
            </div>
            <Link
              to="/register"
              className="rounded-lg bg-white px-6 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-100 focus:outline-2 focus:outline-offset-2 focus:outline-white"
            >
              Crear mi cuenta
            </Link>
          </div>
        </section>
      </main>

      <footer className="bg-gray-900 text-gray-400">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 border-t border-gray-800 px-4 py-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>FARØX · Inventario, pedidos y rutas.</p>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/privacidad" className="hover:text-white hover:underline">
              Política de Privacidad
            </Link>
            <Link to="/login" className="hover:text-white hover:underline">
              Iniciar sesión
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
