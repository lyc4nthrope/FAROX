import { Link } from "react-router-dom";

// /login y /register viven FUERA del AppShell (rutas públicas, sin chrome de
// la app). Este enlace les devuelve la salida hacia la landing pública, que es
// el único camino de vuelta al inicio cuando todavía no hay sesión.
export function BackToHomeLink() {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 transition hover:text-gray-900"
    >
      <svg
        aria-hidden="true"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 24 24"
      >
        <path d="M15 6l-6 6 6 6" />
      </svg>
      Volver al inicio
    </Link>
  );
}
