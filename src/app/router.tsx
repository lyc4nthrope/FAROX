import { Navigate, Route, Routes } from "react-router-dom";

import { CallbackPage, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from "../features/auth";
import { AuditPage } from "../features/audit";
import { CatalogCrudPage, CatalogsPage } from "../features/catalogs";
import { DistributorFormPage, DistributorsPage } from "../features/distributors";
import { AlertsPage, InventoryPage, InventoryStoresPage } from "../features/inventory";
import { LandingPage } from "../features/landing";
import { DashboardPage, MyRoutePage, RouteDetailPage, RoutesPage } from "../features/logistics";
import { CreditsPage, NewOrderPage, OrderDetailPage, OrdersPage } from "../features/orders";
import { LinkStorePage, StoreQrPage } from "../features/store-links";
import { PrivacyPage } from "../features/legal";
import { ProductFormPage, ProductsPage, ShortagePage } from "../features/products";
import { OnboardingGate, OnboardingPage } from "../features/onboarding";
import { ProfilePage } from "../features/profile";
import { RoleFormPage, RolesPage } from "../features/roles";
import { StoreFormPage, StoresPage } from "../features/stores";
import { UserDetailPage, UsersPage } from "../features/users";
import type { RoleName } from "../features/auth/types";
import { RequireAuth } from "./guards/RequireAuth";
import { RequireRole } from "./guards/RequireRole";
import { SessionLoading } from "./guards/SessionLoading";
import { NotFound } from "./NotFound";
import { useAuth } from "./providers/AuthProvider";
import { AppShell } from "./shell/AppShell";
import { HomePage } from "./shell/HomePage";

// Matriz de guards derivada de §S2 (obs #483) + catálogo por entidad (0019):
// · /products y /profile son legibles por cualquier sesión autenticada (sin
//   RequireRole): /products decide DENTRO qué mostrar (admin ⇒ catálogo
//   global; tienda/distribuidor ⇒ catálogo de sus entidades). El rol null ya
//   no renderiza controles privilegiados (V0-3).
// · /products/:id entra también para no-admin (products_select USING true,
//   0006:144-145): el formulario se pinta en modo solo lectura y los
//   controles los oculta el feature products (B6, SEC-01 idea:113).
// · /products/new es SOLO admin (0019/S7): el catálogo global no lo editan
//   las tiendas ni los distribuidores.
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
const DISTRIBUTOR_ONLY: readonly RoleName[] = ["distribuidor"];

// La landing es la primera impresión y vive en la raíz PÚBLICA. Una sesión ya
// activa no ve marketing: vuelve al inicio de la app, el mismo destino al que
// llegan login, registro y el callback de confirmación de email.
function LandingRoute() {
  const { status } = useAuth();
  if (status === "loading") return <SessionLoading />;
  if (status === "authenticated") return <Navigate to="/inicio" replace />;
  return <LandingPage />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/login" element={<LoginPage />} />
      {/* Recuperación de contraseña: públicas, fuera de RequireAuth/AppShell.
          /recuperar pide el email; /restablecer canjea el link y elige la
          nueva contraseña. */}
      <Route path="/recuperar" element={<ForgotPasswordPage />} />
      <Route path="/restablecer" element={<ResetPasswordPage />} />
      {/* /register: ruta PÚBLICA (D1) — el registro no exige sesión; queda
          FUERA del layout RequireAuth/AppShell como /login. */}
      <Route path="/register" element={<RegisterPage />} />
      {/* /privacidad: ruta PÚBLICA — la Política de Privacidad se lee sin
          sesión (enlace del checkbox de consentimiento del registro, que la
          abre en pestaña nueva); hermana de /login y /register, fuera de
          RequireAuth. */}
      <Route path="/privacidad" element={<PrivacyPage />} />
      {/* /auth/callback: ruta PÚBLICA (D2) — el usuario llega del link de
          confirmación de email SIN sesión todavía; queda FUERA de
          RequireAuth/AppShell como /login y /register. */}
      <Route path="/auth/callback" element={<CallbackPage />} />
      <Route element={<RequireAuth />}>
        {/* OnboardingGate (D3, R-D3.1): layout DERIVADO post-RequireAuth —
            RequireAuth/RequireRole quedan intactos. Si la sesión no tiene
            tienda NI distributor (señales my_store_ids/my_distributor_id +
            stores.created_by), cualquier ruta autenticada intercepta hacia
            /onboarding; con señal presente, la pregunta jamás aparece
            (S-D3.0). D2 llega de /auth/callback a /inicio y el guard intercepta
            acá (design #538 §8). */}
        <Route element={<OnboardingGate />}>
          {/* /onboarding: pantalla full-screen SIN chrome de app — hermana
              del bloque AppShell DENTRO del gate (v2). Mientras la sesión
              necesite onboarding el guard solo deja pasar esta ruta (cualquier
              otra redirige acá), así que header (Perfil/Salir) y nav de
              entidades NUNCA montan; con señal, el propio gate rebota
              /onboarding a /inicio (S-D3.0). React Router la resuelve limpia:
              el segmento estático "/onboarding" rankea por encima del
              splat "*" que vive dentro del AppShell. */}
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route element={<AppShell />}>
            <Route path="/inicio" element={<HomePage />} />
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
            {/* Alta del catálogo GLOBAL: solo admin (0019/S7). Operador y
                distribuidor ya no crean productos globales: eligen del
                registro existente en su propio catálogo. */}
            <Route
              path="/products/new"
              element={
                <RequireRole roles={ADMIN_ONLY}>
                  <ProductFormPage />
                </RequireRole>
              }
            />
            {/* Detalle/edición: legible por cualquier sesión (products_select
                USING true, 0006:144-145). La escritura la oculta el feature
                products para no-admin y la enforcea products_update. */}
            <Route path="/products/:id" element={<ProductFormPage />} />
            {/* Faltantes: solo admin y operador (0023). El distribuidor ya no
                ve faltantes; recibe el pedido que el operador le crea. La RPC
                acota al operador a sus tiendas. */}
            <Route
              path="/faltantes"
              element={
                <RequireRole roles={ADMIN_OR_OPERATOR}>
                  <ShortagePage />
                </RequireRole>
              }
            />
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
            {/* /users (sdd/admin-console T-B9 · ADM-3/ADM-13): reemplaza el
                placeholder B4 con UsersPage MANTENIENDO el guard
                RequireRole ADMIN_ONLY — la denegación ocurre ANTES de montar
                el feature (ADM-3.3 ⇒ cero queries para no-admin). */}
            <Route
              path="/users"
              element={
                <RequireRole roles={ADMIN_ONLY}>
                  <UsersPage />
                </RequireRole>
              }
            />
            {/* Detalle /users/:id — mismo guard: perfil + rol + toggles +
                tiendas asignadas (ADM-4..7). */}
            <Route
              path="/users/:id"
              element={
                <RequireRole roles={ADMIN_ONLY}>
                  <UserDetailPage />
                </RequireRole>
              }
            />
            {/* /roles (sdd/admin-console T-C5 · ADM-8/ADM-12): CRUD directo
                de roles con la salvaguarda R3 — la denegación para
                no-admin ocurre ANTES de montar el feature (ADM-12.3). */}
            <Route
              path="/roles"
              element={
                <RequireRole roles={ADMIN_ONLY}>
                  <RolesPage />
                </RequireRole>
              }
            />
            {/* Alta y edición de rol — misma guardia. El form protege los
                roles semilla (name deshabilitado, sin borrar — ADM-8.5). */}
            <Route
              path="/roles/new"
              element={
                <RequireRole roles={ADMIN_ONLY}>
                  <RoleFormPage />
                </RequireRole>
              }
            />
            <Route
              path="/roles/:id"
              element={
                <RequireRole roles={ADMIN_ONLY}>
                  <RoleFormPage />
                </RequireRole>
              }
            />
            {/* /catalogs (sdd/admin-console T-C5 · ADM-9/ADM-12, design
                key-decision #4): índice con las 4 pantallas del motor
                config-driven + ruta dinámica /catalogs/:catalogKey (clave
                inválida ⇒ <NotFound/> dentro del feature). */}
            <Route
              path="/catalogs"
              element={
                <RequireRole roles={ADMIN_ONLY}>
                  <CatalogsPage />
                </RequireRole>
              }
            />
            <Route
              path="/catalogs/:catalogKey"
              element={
                <RequireRole roles={ADMIN_ONLY}>
                  <CatalogCrudPage />
                </RequireRole>
              }
            />
            {/* /audit (sdd/admin-console T-D2 · ADM-10/ADM-12): visor
                read-only de la auditoría. Guard ADMIN_ONLY porque audit_read
                exige my_role() = 'admin' (0006:330-332): la denegación para
                no-admin ocurre ANTES de montar el feature (ADM-10.4 ⇒ cero
                queries). El DML está revocado hasta para el rol de servicio
                (0011:551-554) ⇒ la pantalla no tiene ni tendrá escritura. */}
            <Route
              path="/audit"
              element={
                <RequireRole roles={ADMIN_ONLY}>
                  <AuditPage />
                </RequireRole>
              }
            />
            <Route path="/inventario" element={<RequireRole roles={ADMIN_OR_OPERATOR}><InventoryStoresPage /></RequireRole>} />
            <Route path="/inventario/:storeId" element={<RequireRole roles={ADMIN_OR_OPERATOR}><InventoryPage /></RequireRole>} />
            <Route path="/alertas" element={<AlertsPage />} />
            <Route path="/pedidos" element={<OrdersPage />} />
            <Route path="/pedidos/nuevo" element={<RequireRole roles={ADMIN_OR_OPERATOR}><NewOrderPage /></RequireRole>} />
            <Route path="/pedidos/:orderId" element={<OrderDetailPage />} />
            <Route path="/fiado" element={<RequireRole roles={ADMIN_OR_OPERATOR}><CreditsPage /></RequireRole>} />
            <Route path="/rutas" element={<RequireRole roles={ADMIN_ONLY}><RoutesPage /></RequireRole>} />
            <Route path="/rutas/:routeId" element={<RequireRole roles={ADMIN_ONLY}><RouteDetailPage /></RequireRole>} />
            <Route path="/mi-ruta" element={<RequireRole roles={DISTRIBUTOR_ONLY}><MyRoutePage /></RequireRole>} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/tiendas/:storeId/qr" element={<RequireRole roles={ADMIN_OR_OPERATOR}><StoreQrPage /></RequireRole>} />
            <Route path="/vincular" element={<RequireRole roles={DISTRIBUTOR_ONLY}><LinkStorePage /></RequireRole>} />
            <Route path="/vincular/:code" element={<RequireRole roles={DISTRIBUTOR_ONLY}><LinkStorePage /></RequireRole>} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
