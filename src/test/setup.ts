import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Aislamiento entre pruebas: nada de sessionStorage/localStorage compartido.
afterEach(() => {
  window.sessionStorage.clear();
});
