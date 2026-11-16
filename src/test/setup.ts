import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/dom";
import { afterEach } from "vitest";

// findBy*/waitFor esperan 1 s por defecto. Con la suite completa en paralelo
// (120 entornos jsdom) eso a veces no alcanza y fallaba una prueba distinta
// en ~1 de cada 3 corridas. 5 s solo alarga las pruebas que de verdad fallan.
configure({ asyncUtilTimeout: 5000 });

// Aislamiento entre pruebas: nada de sessionStorage/localStorage compartido.
afterEach(() => {
  // Los tests de Edge Functions corren en entorno node (sin DOM).
  if (typeof window !== "undefined") {
    window.sessionStorage.clear();
  }
});
