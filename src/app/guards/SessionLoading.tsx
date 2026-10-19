// Mientras se resuelve la sesión (restore o privilegios en vuelo) no se
// redirige a /login: eso provocaría un parpadeo con sesión válida (V0-2).
export function SessionLoading() {
  return (
    <p role="status" className="p-6 text-sm text-gray-500">
      Cargando sesión…
    </p>
  );
}
