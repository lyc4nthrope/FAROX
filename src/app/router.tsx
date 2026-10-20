import { Route, Routes } from "react-router-dom";

import { LoginPage, RegisterPage } from "../features/auth";
import { DistributorFormPage, DistributorsPage } from "../features/distributors";
import { ProductFormPage, ProductsPage } from "../features/products";
import { ProfilePage } from "../features/profile";
import { StoreFormPage, StoresPage } from "../features/stores";
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
// · /products/:id entra también para distribuidor (§S2 "distribuidor
//   read-only"; products_select USING true, 0006:144-145): el formulario se
//   pinta en modo solo lectura y los controles los oculta el feature products
//   (B6, SEC-01 idea:113); /products/new SÍ lo deniega (PROD-2 escenario
//   "distribuidor read-only" ⇒ denied en la ruta de alta).
// · /distributors/:id entra para operador (lectura, SEC-01 "read-only"); los
//   controles de escritura los oculta el feature distributors (B5, idea:119).
// · /stores (lista y form) exige admin|operador en las TRES rutas (B7): en
//   tiendas el distribuidor es ✘ total (SEC-01 idea:114, §S2 "distribuidor
//   NO — ruta oculta"); stores_select es USING true (0006:164-165), así que
//   ahí el guard es UX — el enforcement es de RLS en escritura (idea:134).
//   RequireRole además garantiza el role resuelto ANTES de montar StoresPage,
//   cuyo scope "mine"/"all" depende del rol (§S2 "operador own").
const ADMIN_ONLY: readonly RoleName[] = ["admin"];
const ADMIN_OR_OPERATOR: readonly RoleName[] = ["admin", "operador"];

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* /register: ruta PÚBLICA (D1) — el registro no exige sesión; queda
          FUERA del layout RequireAuth/AppShell como /login. */}
      <Route path="/register" element={<RegisterPage />} />
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
          <Route path="/products" element={<ProductsPage />} />
          <Route
            path="/products/new"
            element={
              <RequireRole roles={ADMIN_OR_OPERATOR}>
                <ProductFormPage />
              </RequireRole>
            }
          />
          <Route path="/products/:id" element={<ProductFormPage />} />
          <Route
            path="/stores"
            element={
              <RequireRole roles={ADMIN_OR_OPERATOR}>
                <StoresPage />
              </RequireRole>
            }
          />
          <Route
            path="/stores/new"
            element={
              <RequireRole roles={ADMIN_OR_OPERATOR}>
                <StoreFormPage />
              </RequireRole>
            }
          />
          <Route
            path="/stores/:id"
            element={
              <RequireRole roles={ADMIN_OR_OPERATOR}>
                <StoreFormPage />
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
