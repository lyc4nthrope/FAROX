import { Link } from "react-router-dom";

import { useAuth } from "../providers/AuthProvider";
import { firstAllowedRoute, roleLabel } from "./navigation";

// Home §S2: "redirect to first allowed route; show session role". El rol se
// muestra en una tarjeta con enlace destacado a la primera ruta permitida (en
// lugar de un Navigate instantáneo, que haría el rol invisible) y además
// permanece visible en el badge del header del shell.
export function HomePage() {
  const { role, email } = useAuth();
  const target = firstAllowedRoute(role);

  return (
    <section className="mx-auto max-w-lg rounded-lg border border-gray-200 p-6">
      <h1 className="text-xl font-semibold">FAROX</h1>
      <p className="mt-2 text-sm text-gray-600">
        Sesión iniciada como <span className="font-medium">{roleLabel(role)}</span>
        {email === null ? "" : ` · ${email}`}.
      </p>
      <Link
        to={target.to}
        className="mt-4 inline-block rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
      >
        Ir a {target.label}
      </Link>
    </section>
  );
}
