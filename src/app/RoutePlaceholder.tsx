interface RoutePlaceholderProps {
  title: string;
  batch: string;
}

// Placeholder V0-4: pantalla aún no implementada — siempre explícito, nunca
// una pantalla en blanco. B5-B7 lo reemplazan por la página real del feature.
export function RoutePlaceholder({ title, batch }: RoutePlaceholderProps) {
  return (
    <section>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-gray-600">
        Esta pantalla aún no está disponible: la implementa el lote {batch}.
      </p>
    </section>
  );
}
