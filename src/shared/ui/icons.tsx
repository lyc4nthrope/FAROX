import type { ReactNode } from "react";

// Iconografía compartida por la navegación, el inicio y los accesos rápidos.
// Es la MISMA clave (`to`) en todos lados para que el usuario reconozca una
// sección por su forma, no solo por su texto.
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
  "/asistente": (
    <>
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-5.5A8 8 0 1 1 21 12Z" />
      <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
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
  // Movimientos: flechas opuestas (compra entra, venta sale).
  "/movimientos": (
    <>
      <path d="M7 4v12m0 0-3-3m3 3 3-3M17 20V8m0 0-3 3m3-3 3 3" />
    </>
  ),
  // Plan / Premium: estrella.
  "/premium": (
    <>
      <path d="M12 3.5 14.4 9l6 .5-4.6 4 1.5 5.9L12 16.2 6.7 19.4l1.5-5.9L3.6 9.5l6-.5L12 3.5Z" />
    </>
  ),
};

/** Icono de una sección de la app, identificado por su ruta. */
export function SectionIcon({ to, className = "h-4.5 w-4.5" }: { to: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
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
