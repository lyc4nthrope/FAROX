import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Aislamiento entre pruebas: nada de sessionStorage/localStorage compartido.
afterEach(() => {
  // Los tests de Edge Functions corren en entorno node (sin DOM).
  if (typeof window !== "undefined") {
    window.sessionStorage.clear();
  }
});
