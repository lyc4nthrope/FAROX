import { useEffect, useRef, useState } from "react";

/**
 * Ancho real del contenedor. Los gráficos SVG se dibujan en píxeles (no con
 * viewBox escalado) para que las etiquetas conserven un tamaño legible en
 * móvil. En jsdom no hay ResizeObserver: se conserva el ancho de respaldo.
 */
export function useElementWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    const measure = () => {
      const next = element.getBoundingClientRect().width;
      if (next > 0) setWidth(Math.round(next));
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
