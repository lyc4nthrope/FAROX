import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../providers/AuthProvider";
import { roleLabel, visibleNavItems } from "./navigation";

// Shell mobile-first (V0-5): las entradas de entidad obedecen a SEC-01 vía
// visibleNavItems(role). Perfil y Salir son utilidades de cuenta en el header
// (no entradas de entidad), así el "solo productos" del distribuidor se
// cumple literalmente en el nav.
export function AppShell() {
  const { role, premium, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = visibleNavItems(role);
  // sdd/admin-console T-E1 (ADM-11): primer branch de UI que CONSUME el
  // `premium` ya cargado en el contexto (AuthProvider:183). D7 — is_premium()
  // = premium OR admin (0004:39-48) ⇒ un admin sin premium TAMBIÉN ve la
  // insignia: está exento del gate premium.
  const verInsigniaPremium = premium || role === "admin";

  return (
    <div className="min-h-dvh bg-gray-50 text-gray-900">
      <a
        href="#contenido"
        className="sr-only rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50"
      >
        Saltar al contenido
      </a>

      <header className="sticky top-0 z-30 border-b border-gray-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2.5 gap-y-2 px-4 py-2.5">
          <Link
            to="/inicio"
            aria-label="FARØX, inicio"
            className="flex shrink-0 items-center gap-2.5 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-900 text-[11px] font-semibold tracking-[0.08em] text-white shadow-sm"
            >
              FX
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-sm font-semibold tracking-[0.2em] text-gray-900">
                FARØX
              </span>
              <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-gray-400">
                Operación en orden
              </span>
            </span>
          </Link>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600">
            <svg
              aria-hidden="true"
              className="h-3 w-3 text-gray-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" />
            </svg>
            {roleLabel(role)}
          </span>

          {verInsigniaPremium && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
              <svg aria-hidden="true" className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.5 14.6 9l6.9.5-5.3 4.5 1.7 6.7-5.9-3.6-5.9 3.6 1.7-6.7L2.5 9.5 9.4 9 12 2.5Z" />
              </svg>
              Premium
            </span>
          )}

          <div className="ml-auto flex items-center gap-1 text-sm">
            <Link
              to="/profile"
              aria-label="Perfil"
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
            >
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="8" r="3.5" />
                <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
              </svg>
              <span className="hidden sm:inline">Perfil</span>
            </Link>
            <button
              type="button"
              aria-label="Salir"
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
              onClick={() => {
                void signOut();
              }}
            >
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
              >
                <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l4 4-4 4M14 12H3" />
              </svg>
              <span className="hidden sm:inline">Salir</span>
            </button>
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="main-nav"
              className="ml-1 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-gray-700 shadow-sm transition hover:bg-gray-50 md:hidden"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                viewBox="0 0 24 24"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              Menú
            </button>
          </div>
        </div>
      </header>

      <nav
        id="main-nav"
        aria-label="Secciones"
        className={
          menuOpen
            ? "border-b border-gray-200/80 bg-white"
            : "hidden border-b border-gray-200/80 bg-white md:block"
        }
      >
        <ul className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-2 md:flex-row md:flex-wrap md:items-center">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `inline-flex items-center rounded-full px-3 py-1.5 text-sm transition ${
                    isActive
                      ? "bg-gray-900 font-medium text-white shadow-sm"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <main id="contenido" className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
