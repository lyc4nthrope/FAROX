import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
// Efecto secundario a propósito: valida el env y crea el cliente antes de renderizar.
import "./shared/lib/supabase/client";
import "./index.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Falta el elemento #root en index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
