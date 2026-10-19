// Estado de denegación amigable (§S2 / ADM-3): se renderiza ANTES de cualquier
// query — RequireRole decide sin montar la pantalla protegida.
export function AccessDenied() {
  return (
    <section
      aria-labelledby="access-denied-title"
      className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-amber-900"
    >
      <h1 id="access-denied-title" className="text-lg font-semibold">
        Acceso denegado
      </h1>
      <p className="mt-2 text-sm">
        No tenés permisos para ver esta sección. Si creés que es un error,
        contactá a un administrador.
      </p>
    </section>
  );
}
