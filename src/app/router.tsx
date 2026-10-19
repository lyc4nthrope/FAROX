import { Route, Routes } from "react-router-dom";

import { LoginPage } from "../features/auth";
import { DistributorFormPage, DistributorsPage } from "../features/distributors";
import { ProfilePage } from "../features/profile";
import type { RoleName } from "../features/auth/types";
import { RequireAuth } from "./guards/RequireAuth";
import { RequireRole } from "./guards/RequireRole";
import { NotFound } from "./NotFound";
import { RoutePlaceholder } from "./RoutePlaceholder";
import { AppShell } from "./shell/AppShell";
import { HomePage } from "./shell/HomePage";

// Matriz de guards derivada de §S2 (obs #483):
// · /products y /profile son legibles por cualquier sesión autenticada (sin
//   RequireRole): la DB no gatea su lectura y el rol null ya no renderiza
//   controles privilegiados (V0-3).
// · /distributors/:id entra para operador (lectura, SEC-01 "read-only"); los
//   controles de escritura los oculta el feature distributors (B5, idea:119).
const ADMIN_ONLY: readonly RoleName[] = ["admin"];
const ADMIN_OR_OPERATOR: readonly RoleName[] = ["admin", "operador"];

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/distributors"
            element={
              <RequireRole roles={ADMIN_OR_OPERATOR}>
                <DistributorsPage />
              </RequireRole>
            }
          />
          <Route
            path="/distributors/new"
            element={
              <RequireRole roles={ADMIN_ONLY}>
                <DistributorFormPage />
              </RequireRole>
            }
          />
          <Route
            path="/distributors/:id"
            element={
              <RequireRole roles={ADMIN_OR_OPERATOR}>
                <DistributorFormPage />
              </RequireRole>
            }
          />
          <Route path="/products" element={<RoutePlaceholder title="Productos" batch="B6" />} />
          <Route
            path="/products/new"
            element={
              <RequireRole roles={ADMIN_OR_OPERATOR}>
                <RoutePlaceholder title="Nuevo producto" batch="B6" />
              </RequireRole>
            }
          />
          <Route
            path="/products/:id"
            element={
              <RequireRole roles={ADMIN_OR_OPERATOR}>
                <RoutePlaceholder title="Producto" batch="B6" />
              </RequireRole>
            }
          />
          <Route
            path="/stores"
            element={
              <RequireRole roles={ADMIN_OR_OPERATOR}>
                <RoutePlaceholder title="Tiendas" batch="B7" />
              </RequireRole>
            }
          />
          <Route
            path="/stores/new"
            element={
              <RequireRole roles={ADMIN_OR_OPERATOR}>
                <RoutePlaceholder title="Nueva tienda" batch="B7" />
              </RequireRole>
            }
          />
          <Route
            path="/stores/:id"
            element={
              <RequireRole roles={ADMIN_OR_OPERATOR}>
                <RoutePlaceholder title="Tienda" batch="B7" />
              </RequireRole>
            }
          />
          <Route
            path="/users"
            element={
              <RequireRole roles={ADMIN_ONLY}>
                <RoutePlaceholder title="Usuarios" batch="B4" />
              </RequireRole>
            }
          />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
