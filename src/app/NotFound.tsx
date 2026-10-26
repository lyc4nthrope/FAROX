import { Link } from "react-router-dom";

// Ruta desconocida: placeholder explícito (V0-4).
export function NotFound() {
  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">Página no encontrada</h1>
      <p className="mt-2 text-sm text-gray-600">
        La ruta que pediste no existe.{" "}
        <Link to="/inicio" className="text-gray-900 underline">
          Volver al inicio
        </Link>
      </p>
    </section>
  );
}
