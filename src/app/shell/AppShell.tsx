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
    <div className="min-h-dvh bg-white text-gray-900">
      <header className="border-b border-gray-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link to="/" className="text-lg font-semibold">
            FAROX
          </Link>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            {roleLabel(role)}
          </span>
          {verInsigniaPremium && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Premium
            </span>
          )}
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link to="/profile" className="text-gray-700 hover:text-gray-900 hover:underline">
              Perfil
            </Link>
            <button
              type="button"
              className="text-gray-700 hover:text-gray-900 hover:underline"
              onClick={() => {
                void signOut();
              }}
            >
              Salir
            </button>
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="main-nav"
              className="rounded border border-gray-300 px-2 py-1 md:hidden"
              onClick={() => setMenuOpen((open) => !open)}
            >
              Menú
            </button>
          </div>
        </div>
        <nav
          id="main-nav"
          aria-label="Secciones"
          className={
            menuOpen
              ? "border-t border-gray-200 md:border-0"
              : "hidden border-t border-gray-200 md:block md:border-0"
          }
        >
          <ul className="mx-auto flex max-w-6xl flex-col gap-1 p-2 md:flex-row md:gap-2 md:pb-2">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `block rounded px-3 py-2 text-sm ${
                      isActive
                        ? "bg-gray-900 font-medium text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
