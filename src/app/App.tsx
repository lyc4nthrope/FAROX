import { BrowserRouter } from "react-router-dom";

import { AuthProvider } from "./providers/AuthProvider";
import { AppRoutes } from "./router";

// Raíz de la app: providers + router (T2.1). El cliente supabase se importa en
// main.tsx con efecto secundario — valida el env antes de renderizar (V0-1).
export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
