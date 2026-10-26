import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../features/auth/types";
import * as auditApi from "../features/audit/api";
import * as authApi from "../features/auth/api";
import * as catalogsApi from "../features/catalogs/api";
import * as distributorsApi from "../features/distributors/api";
import * as onboardingApi from "../features/onboarding/api";
import { clearOnboardingSignalsCache } from "../features/onboarding/signalsCache";
import * as productsApi from "../features/products/api";
import * as profileApi from "../features/profile/api";
import * as rolesApi from "../features/roles/api";
import * as storesApi from "../features/stores/api";
import * as usersApi from "../features/users/api";
import { AuthProvider } from "./providers/AuthProvider";
import { AppRoutes } from "./router";

vi.mock("../features/auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
  // D1 (T1.x): /register usa signUp y reenvío de confirmación — el barrel
  // del router ya las importa, así que el mock debe exportarlas COMPLETO.
  signUp: vi.fn(),
  resendConfirmationEmail: vi.fn(),
  // D2: /auth/callback canjea el código PKCE — mismo motivo que arriba.
  confirmEmailConfirmationCode: vi.fn(),
  // Recuperación de contraseña: /recuperar y /restablecer importan estas
  // funciones del mismo api, así que el mock las exporta completo.
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  establishRecoverySession: vi.fn(),
}));
// B5 (T5.2): /distributors ya no es placeholder — el api de la feature se
// mockea COMPLETO como en el resto de los tests: sin esto, el módulo real
// importa el cliente supabase, que valida el env en el arranque (V0-1).
vi.mock("../features/distributors/api", () => ({
  fetchDistributors: vi.fn(),
  fetchDistributor: vi.fn(),
  fetchDistributorUserCounts: vi.fn(),
  createDistributor: vi.fn(),
  updateDistributor: vi.fn(),
  deactivateDistributor: vi.fn(),
  deleteDistributor: vi.fn(),
}));
// B6 (T6.2): mismo motivo para /products — páginas reales en vez de
// placeholder, así que el api de la feature debe estar mockeado completo.
vi.mock("../features/products/api", () => ({
  fetchProducts: vi.fn(),
  fetchProduct: vi.fn(),
  fetchBrands: vi.fn(),
  fetchUnitTypes: vi.fn(),
  fetchProductCategories: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deactivateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  fetchCatalogContext: vi.fn(),
  fetchStoreCatalog: vi.fn(),
  fetchDistributorCatalog: vi.fn(),
  fetchActiveProductsForCatalog: vi.fn(),
  addStoreCatalogProduct: vi.fn(),
  removeStoreCatalogProduct: vi.fn(),
  addDistributorCatalogProduct: vi.fn(),
  removeDistributorCatalogProduct: vi.fn(),
}));
vi.mock("../features/profile/api", () => ({
  fetchMyProfile: vi.fn(),
  updateMyProfile: vi.fn(),
}));
// D3 (T2.2/T2.7): el guard derivado OnboardingGate consulta la feature
// onboarding — mockeada COMPLETA como el resto (sin esto, el módulo real
// importa el cliente supabase, que valida el env en el arranque (V0-1)).
vi.mock("../features/onboarding/api", () => ({
  fetchOnboardingSignals: vi.fn(),
  registerDistributor: vi.fn(),
  createStore: vi.fn(),
  fetchStoreTypes: vi.fn(),
}));
// B7 (T7.2): /stores ya no es placeholder — el api de la feature se mockea
// COMPLETO como en el resto de los tests: sin esto, el módulo real importa el
// cliente supabase, que valida el env en el arranque (V0-1).
vi.mock("../features/stores/api", () => ({
  fetchStores: vi.fn(),
  fetchStore: vi.fn(),
  fetchStoreGeo: vi.fn(),
  fetchStoreTypes: vi.fn(),
  createStore: vi.fn(),
  updateStore: vi.fn(),
  deactivateStore: vi.fn(),
  deleteStore: vi.fn(),
}));
// sdd/admin-console T-B9: /users y /users/:id ya no son placeholder — el api
// de la feature se mockea COMPLETO como el resto (sin esto, el módulo real
// importa el cliente supabase, que valida el env en el arranque — V0-1).
vi.mock("../features/users/api", () => ({
  fetchUsers: vi.fn(),
  fetchUser: vi.fn(),
  updateUserProfile: vi.fn(),
  updateUserRole: vi.fn(),
  setUserPremium: vi.fn(),
  setUserActive: vi.fn(),
  fetchUserStores: vi.fn(),
  fetchUserStoreCounts: vi.fn(),
  fetchDistributorOptions: vi.fn(),
}));
// sdd/admin-console T-C5: /roles y /catalogs ya no son placeholder — los apis
// de ambas features se mockean COMPLETOS como el resto (sin esto, el módulo
// real importa el cliente supabase, que valida el env en el arranque — V0-1).
vi.mock("../features/roles/api", () => ({
  fetchRoles: vi.fn(),
  fetchRole: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("../features/catalogs/api", () => ({
  fetchCatalogRows: vi.fn(),
  createCatalogRow: vi.fn(),
  updateCatalogRow: vi.fn(),
  deactivateCatalogRow: vi.fn(),
  deleteCatalogRow: vi.fn(),
}));
// sdd/admin-console T-D2: /audit ya no es placeholder — el api de la feature
// se mockea COMPLETO como el resto (sin esto, el módulo real importa el
// cliente supabase, que valida el env en el arranque — V0-1).
vi.mock("../features/audit/api", () => ({
  fetchAuditPage: vi.fn(),
}));
// Features nuevas (inventario, pedidos, rutas, dashboard) usan el cliente
// directo: un builder encadenable que siempre resuelve a lista vacía.
vi.mock("../shared/lib/supabase/client", () => {
  const result = { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "is", "in", "order", "limit", "range"]) {
    chain[method] = () => chain;
  }
  chain.single = () => Promise.resolve({ data: null, error: null });
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve(result),
    },
  };
});

const SESSION = { userId: "u1", email: "demo@farox.app" };

function conSesion(role: RoleName | null) {
  vi.mocked(authApi.getSession).mockResolvedValue(SESSION);
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
}

function renderRuta(ruta: string) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AppRoutes (V0-2/V0-4/§S2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // El gate derivado hidrata señales desde su caché en memoria por userId:
    // cada test arranca sin ella para que el mock de fetch mande solo.
    clearOnboardingSignalsCache();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    // D2: el canje PKCE del callback se resuelve "sin código" para que la
    // ruta monte su rama de error y el test verifique solo el GUARD PÚBLICO.
    vi.mocked(authApi.confirmEmailConfirmationCode).mockResolvedValue({
      status: "missing-code",
    });
    vi.mocked(profileApi.fetchMyProfile).mockResolvedValue({
      row: {
        full_name: "Ada Lovelace",
        phone_number: "555-1234",
        contact_preference: "whatsapp",
      },
      error: null,
    });
    vi.mocked(profileApi.updateMyProfile).mockResolvedValue({ error: null });
    vi.mocked(distributorsApi.fetchDistributors).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(distributorsApi.fetchDistributor).mockResolvedValue({ row: null, error: null });
    vi.mocked(productsApi.fetchProducts).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(productsApi.fetchProduct).mockResolvedValue({ row: null, error: null });
    vi.mocked(productsApi.fetchBrands).mockResolvedValue({ rows: [], error: null });
    vi.mocked(productsApi.fetchUnitTypes).mockResolvedValue({ rows: [], error: null });
    vi.mocked(productsApi.fetchProductCategories).mockResolvedValue({
      rows: [],
      error: null,
    });
    vi.mocked(storesApi.fetchStores).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(storesApi.fetchStore).mockResolvedValue({ row: null, error: null });
    vi.mocked(storesApi.fetchStoreGeo).mockResolvedValue({ geo: null, error: null });
    vi.mocked(storesApi.fetchStoreTypes).mockResolvedValue({ rows: [], error: null });
    // sdd/admin-console T-B9: defaults de la feature users para que las rutas
    // /users y /users/:id resuelvan pantalla. Lista vacía ⇒ EmptyState (vacío
    // ≠ error, D4) y detalle sin fila ⇒ notFound amigable vía mapError.
    const sinFila = {
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
    };
    vi.mocked(usersApi.fetchUsers).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(usersApi.fetchUser).mockResolvedValue({ row: null, error: sinFila });
    vi.mocked(usersApi.fetchUserStores).mockResolvedValue({ rows: [], error: null });
    vi.mocked(usersApi.fetchUserStoreCounts).mockResolvedValue({
      counts: {},
      error: null,
    });
    vi.mocked(usersApi.fetchDistributorOptions).mockResolvedValue({
      options: [],
      error: null,
    });
    // sdd/admin-console T-C5: defaults de las features roles y catalogs para
    // que sus rutas resuelvan pantalla. Listas vacías ⇒ EmptyState (vacío ≠
    // error, D4) y detalle de rol sin fila ⇒ notFound amigable vía mapError.
    vi.mocked(rolesApi.fetchRoles).mockResolvedValue({ rows: [], error: null });
    vi.mocked(rolesApi.fetchRole).mockResolvedValue({ row: null, error: null });
    vi.mocked(catalogsApi.fetchCatalogRows).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    // sdd/admin-console T-D2: default de /audit — lista vacía ⇒ EmptyState
    // (vacío ≠ error, D4).
    vi.mocked(auditApi.fetchAuditPage).mockResolvedValue({
      rows: [],
      hasMore: false,
      error: null,
    });
    conSesion("admin");
    // D3 (T2.2): por defecto la sesión YA tiene señal (tienda propia) ⇒ el
    // guard derivado deja pasar al shell — así los tests preexistentes
    // conservan su significado. Los casos "sin señal" la mockean a pelo.
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: { hasDistributor: false, hasStore: true },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("anónimo en una ruta de datos: cae en /login con cero llamadas de datos (V0-2)", async () => {
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    renderRuta("/stores");
    expect(await screen.findByText("Iniciar sesión")).toBeInTheDocument();
    expect(authApi.fetchPrivileges).not.toHaveBeenCalled();
  });

  it("anónimo en /register: formulario de registro — ruta PÚBLICA sin RequireAuth (D1)", async () => {
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    renderRuta("/register");
    // El form monta sin sesión: nunca cae al guard de /login.
    expect(
      await screen.findByRole("heading", { name: "Crear tu cuenta" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Iniciar sesión" })).not.toBeInTheDocument();
    expect(authApi.fetchPrivileges).not.toHaveBeenCalled();
  });

  it("anónimo en /recuperar: pide el email — ruta PÚBLICA sin RequireAuth", async () => {
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    renderRuta("/recuperar");
    expect(
      await screen.findByRole("heading", { name: "Recuperar contraseña" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Iniciar sesión" })).not.toBeInTheDocument();
    expect(authApi.fetchPrivileges).not.toHaveBeenCalled();
  });

  it("anónimo en /restablecer: monta la pantalla del link sin sesión (PÚBLICA)", async () => {
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    vi.mocked(authApi.establishRecoverySession).mockResolvedValue({ status: "missing" });
    renderRuta("/restablecer");
    expect(
      await screen.findByRole("heading", { name: "El link no es válido" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pedir un link nuevo" })).toHaveAttribute(
      "href",
      "/recuperar",
    );
    expect(authApi.fetchPrivileges).not.toHaveBeenCalled();
  });

  it("anónimo en /privacidad: la política se lee sin sesión — ruta PÚBLICA sin RequireAuth", async () => {
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    renderRuta("/privacidad");
    expect(
      await screen.findByRole("heading", { name: "Política de Privacidad" }),
    ).toBeInTheDocument();
    // Divulgación de terceros REALES del código (shared/lib/geo): los
    // dominios deben aparecer en el render de la política.
    expect(screen.getByText(/^ipwho\.is/)).toBeInTheDocument();
    expect(screen.getByText(/^Nominatim/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Iniciar sesión" })).not.toBeInTheDocument();
    expect(authApi.fetchPrivileges).not.toHaveBeenCalled();
  });

  it("anónimo en /auth/callback: pantalla del callback — ruta PÚBLICA sin RequireAuth (D2)", async () => {
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    renderRuta("/auth/callback?code=abc123");
    // El callback monta sin sesión y sin privilegios: nunca cae al guard de /login.
    expect(
      await screen.findByRole("heading", { name: "No pudimos confirmar tu cuenta" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Iniciá sesión" }),
    ).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("heading", { name: "Iniciar sesión" })).not.toBeInTheDocument();
    expect(authApi.fetchPrivileges).not.toHaveBeenCalled();
  });

  it("cada ruta §S2 resuelve pantalla o placeholder explícito, nunca en blanco (V0-4)", async () => {
    const rutas = [
      "/",
      "/inicio",
      "/distributors",
      "/distributors/new",
      "/distributors/1",
      "/products",
      "/products/new",
      "/products/1",
      "/stores",
      "/stores/new",
      "/stores/1",
      "/users",
      "/users/1",
      // sdd/admin-console T-C5 (ADM-9.1/ADM-12.1): rutas del lote C.
      "/roles",
      "/roles/new",
      "/roles/1",
      "/catalogs",
      "/catalogs/brands",
      // sdd/admin-console T-D2 (ADM-10.1/ADM-12.1): ruta del lote D.
      "/audit",
      "/profile",
    ];
    for (const ruta of rutas) {
      renderRuta(ruta);
      const main = await screen.findByRole("main");
      expect(main.textContent?.length, `ruta ${ruta}`).toBeGreaterThan(0);
      cleanup();
    }
  });

  it("ruta desconocida: placeholder explícito (V0-4)", async () => {
    renderRuta("/ruta/que/no/existe");
    expect(await screen.findByText("Página no encontrada")).toBeInTheDocument();
  });

  it("§S2/ADM-3.3: operador con /users por URL directa → denegado ANTES de cualquier query", async () => {
    conSesion("operador");
    renderRuta("/users");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    // RequireRole deniega antes de montar UsersPage (RequireRole.tsx:13-22):
    // el módulo api de la feature NUNCA se invoca.
    expect(usersApi.fetchUsers).not.toHaveBeenCalled();
    expect(usersApi.fetchUserStoreCounts).not.toHaveBeenCalled();
  });

  it("ADM-3.3/ADM-12: operador con /users/:id por URL directa → denegado sin queries", async () => {
    conSesion("operador");
    renderRuta("/users/u1");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(usersApi.fetchUser).not.toHaveBeenCalled();
    expect(usersApi.fetchUserStores).not.toHaveBeenCalled();
  });

  it("ADM-12.4: distribuidor con /users y /users/:id → denegado en ambas, sin queries", async () => {
    conSesion("distribuidor");
    renderRuta("/users");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(usersApi.fetchUsers).not.toHaveBeenCalled();
    cleanup();

    renderRuta("/users/u1");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(usersApi.fetchUser).not.toHaveBeenCalled();
  });

  it("ADM-13.1/ADM-3.1: admin en /users ve UsersPage real (filas + badges + Tiendas), no el placeholder", async () => {
    vi.mocked(usersApi.fetchUsers).mockResolvedValue({
      rows: [
        {
          id: "u1",
          email: "ana@farox.app",
          full_name: "Ana Pérez",
          premium: true,
          is_active: true,
          role_name: "admin",
          store_count: null,
        },
      ],
      count: 1,
      error: null,
    });
    vi.mocked(usersApi.fetchUserStoreCounts).mockResolvedValue({
      counts: { u1: 2 },
      error: null,
    });
    renderRuta("/users");

    expect(
      await screen.findByRole("link", { name: "Ana Pérez" }),
    ).toBeInTheDocument();
    // Badge de rol de la FILA (el header del AppShell también muestra el rol
    // de la sesión ⇒ getAllByText).
    expect(screen.getAllByText("Administrador").length).toBeGreaterThan(1);
    // Premium/Activo se aíslan a la fila: el <th> de la cabecera también dice
    // «Premium» ⇒ getByText global sería ambiguo.
    const linkFila = screen.getByRole("link", { name: "Ana Pérez" });
    const fila = within(linkFila.closest("tr") as HTMLElement);
    expect(fila.getByText("Premium")).toBeInTheDocument();
    expect(fila.getByText("Activo")).toBeInTheDocument();
    // La columna Tiendas resuelve cuando la query de apoyo (FLAG-4) resuelve.
    expect(await screen.findByText("2")).toBeInTheDocument();
    // Copy del placeholder B4 (ADM-13): jamás en esta ruta.
    expect(screen.queryByText(/lote B4/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/aún no está disponible/),
    ).not.toBeInTheDocument();
  });

  it("ADM-13.2: el fuente de router.tsx ya no referencia RoutePlaceholder ni el copy del lote B4", async () => {
    interface FsModule {
      readFileSync(path: string, encoding: "utf8"): string;
    }
    // Sin @types/node en el repo: import dinámico con especificador NO
    // literal (patrón src/test/d2-exceptions.test.ts:67-70).
    const fs = (await import(["node", "fs"].join(":"))) as FsModule;
    // Raíz del repo derivada de la URL de ESTE archivo (mismo normalizador
    // que d2-exceptions.test.ts:46-50, con ../.. porque acá estamos en src/app).
    const raiz = decodeURIComponent(new URL("../../", import.meta.url).pathname)
      .replace(/^\/[A-Za-z]:\/@fs\/([A-Za-z]:)\//, "$1/")
      .replace(/^\/@fs\//, "/")
      .replace(/^\/([A-Za-z]:)/, "$1")
      .replace(/\/$/, "");
    const fuente = fs.readFileSync(`${raiz}/src/app/router.tsx`, "utf8");

    expect(fuente).not.toContain("RoutePlaceholder");
    expect(fuente).not.toContain("lote B4");
    expect(fuente).toContain("<UsersPage />");
    expect(fuente).toContain("<UserDetailPage />");
  });

  it("ADM-12.3: operador con /roles por URL directa → denegado ANTES de cualquier query", async () => {
    conSesion("operador");
    renderRuta("/roles");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(rolesApi.fetchRoles).not.toHaveBeenCalled();
  });

  it("ADM-12.3: operador con /catalogs y /catalogs/brands por URL directa → denegado sin queries", async () => {
    conSesion("operador");
    renderRuta("/catalogs");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(catalogsApi.fetchCatalogRows).not.toHaveBeenCalled();
    cleanup();

    renderRuta("/catalogs/brands");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(catalogsApi.fetchCatalogRows).not.toHaveBeenCalled();
  });

  it("ADM-12.4: distribuidor con /roles y /catalogs → denegado en ambas, sin queries", async () => {
    conSesion("distribuidor");
    renderRuta("/roles");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(rolesApi.fetchRoles).not.toHaveBeenCalled();
    cleanup();

    renderRuta("/catalogs");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(catalogsApi.fetchCatalogRows).not.toHaveBeenCalled();
  });

  it("ADM-10.4/ADM-12.3: operador con /audit por URL directa → denegado ANTES de cualquier query", async () => {
    conSesion("operador");
    renderRuta("/audit");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    // RequireRole deniega antes de montar AuditPage (RequireRole.tsx:13-22):
    // el módulo api de la feature NUNCA se invoca (audit_read es admin-only
    // en la DB, 0006:330-332 — la ruta replica esa matriz).
    expect(auditApi.fetchAuditPage).not.toHaveBeenCalled();
  });

  it("ADM-12.4: distribuidor con /audit → denegado, sin queries", async () => {
    conSesion("distribuidor");
    renderRuta("/audit");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(auditApi.fetchAuditPage).not.toHaveBeenCalled();
  });

  it("ADM-10.1/ADM-12.1: admin en /audit ve AuditPage real (eventos), sin total y sin controles de escritura", async () => {
    vi.mocked(auditApi.fetchAuditPage).mockResolvedValue({
      rows: [
        {
          id: 31,
          created_by: "11111111-2222-3333-4444-555555555555",
          table_name: "users",
          action: "update",
          row_id: "u1",
          diff: { premium: { old: false, new: true } },
          created_at: "2026-10-20T12:00:00+00:00",
        },
      ],
      hasMore: false,
      error: null,
    });
    renderRuta("/audit");

    expect(await screen.findByText("Modificación")).toBeInTheDocument();
    // La tabla (no el select de filtros): el <option> «users» también existe.
    expect(within(screen.getByRole("table")).getByText("users")).toBeInTheDocument();
    expect(screen.getByText("u1")).toBeInTheDocument();
    // Keyset sin total (ADM-10.2) y read-only absoluto (ADM-10.3): dentro de
    // main el único botón sería «Cargar más», y con hasMore=false ni eso
    // (los botones del header del AppShell — Menú/Salir — viven FUERA).
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
    const main = await screen.findByRole("main");
    expect(within(main).queryByRole("button")).not.toBeInTheDocument();
  });

  it("ADM-12.1: admin en /catalogs ve el índice del motor (4 links), en /roles la lista", async () => {
    vi.mocked(rolesApi.fetchRoles).mockResolvedValue({
      rows: [{ id: 1, name: "admin", description: "Acceso total" }],
      error: null,
    });
    renderRuta("/catalogs");

    expect(
      await screen.findByRole("link", { name: "Tipos de unidad" }),
    ).toHaveAttribute("href", "/catalogs/unit_types");
    expect(
      screen.getByRole("link", { name: "Tipos de tienda" }),
    ).toHaveAttribute("href", "/catalogs/store_types");
    expect(screen.getByRole("link", { name: "Marcas" })).toHaveAttribute(
      "href",
      "/catalogs/brands",
    );
    expect(
      screen.getByRole("link", { name: "Categorías de producto" }),
    ).toHaveAttribute("href", "/catalogs/product_categories");
    cleanup();

    renderRuta("/roles");
    expect(await screen.findByRole("link", { name: "admin" })).toHaveAttribute("href", "/roles/1");
    expect(screen.queryByRole("link", { name: "Nuevo rol" })).toBeNull();
  });

  it("§S2: distribuidor con /stores por URL directa → denegado (SEC-01 tiendas NO)", async () => {
    conSesion("distribuidor");
    renderRuta("/stores");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
  });

  it("sesionado en /login: redirige al home con el rol visible", async () => {
    renderRuta("/login");
    const main = await screen.findByRole("main");
    expect(main).toHaveTextContent("Sesión iniciada como Administrador");
  });

  it("D3/T2.2: sesión sin tienda ni distributor ⇒ CUALQUIER ruta intercepta a /onboarding", async () => {
    // El guard derivado va tras RequireAuth: llegás autenticado a "/" (p. ej.
    // tras /auth/callback de D2, design #538 §8) y te manda a la pregunta.
    conSesion("operador");
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: { hasDistributor: false, hasStore: false },
      error: null,
    });
    renderRuta("/");
    expect(await screen.findByRole("heading", { name: "Bienvenido a FAROX" })).toBeInTheDocument();
    expect(screen.queryByText("Sesión iniciada como")).not.toBeInTheDocument();
    expect(onboardingApi.fetchOnboardingSignals).toHaveBeenCalledTimes(1);
  });

  it("D3/v2: durante el onboarding NO hay chrome de app: ni nav de entidades, ni Perfil, ni utilities del header", async () => {
    // Regresión del bug original: la pregunta se renderizaba DENTRO del
    // AppShell y mostraba header + nav (links muertos: el gate rebotaba).
    // /onboarding ahora es hermana del bloque AppShell ⇒ sin chrome por
    // construcción, y el guard redirige cualquier otra ruta a la pregunta.
    conSesion("operador");
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: { hasDistributor: false, hasStore: false },
      error: null,
    });
    renderRuta("/");

    expect(await screen.findByRole("heading", { name: "Bienvenido a FAROX" })).toBeInTheDocument();
    // Sin <nav> de secciones (aria-label "Secciones") ni UN solo link.
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: "Perfil" })).not.toBeInTheDocument();
    // Utilities del header del AppShell: el toggle Menú no existe (el único
    // [Salir] es el discreto del onboarding, requisito v2).
    expect(screen.queryByRole("button", { name: "Menú" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salir" })).toBeInTheDocument();
  });

  it("D3/T2.2: sesión CON señal (distribuidor) ⇒ la pregunta jamás aparece: entra al home", async () => {
    conSesion("operador");
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: { hasDistributor: true, hasStore: false },
      error: null,
    });
    renderRuta("/");
    const main = await screen.findByRole("main");
    expect(main).toHaveTextContent("Sesión iniciada como");
    expect(screen.queryByRole("heading", { name: "Bienvenido a FAROX" })).not.toBeInTheDocument();
  });

  it("D3/S-D3.0: con señal, visita directa a /onboarding ⇒ redirige al home (no reaparece)", async () => {
    renderRuta("/onboarding");
    const main = await screen.findByRole("main");
    expect(main).toHaveTextContent("Sesión iniciada como");
    expect(screen.queryByRole("heading", { name: "Bienvenido a FAROX" })).not.toBeInTheDocument();
  });

  it("anónimo en /: landing pública con accesos a registro y login (primera impresión)", async () => {
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    renderRuta("/");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Todo tu negocio, en orden." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Empezar ahora" })).toHaveAttribute(
      "href",
      "/register",
    );
    expect(screen.queryByRole("heading", { name: "Iniciar sesión" })).not.toBeInTheDocument();
    expect(onboardingApi.fetchOnboardingSignals).not.toHaveBeenCalled();
  });

  it("sesionado en /: la landing redirige al inicio de la app, no se muestra el marketing", async () => {
    renderRuta("/");
    const main = await screen.findByRole("main");
    expect(main).toHaveTextContent("Sesión iniciada como Administrador");
    expect(
      screen.queryByRole("heading", { level: 1, name: "Todo tu negocio, en orden." }),
    ).not.toBeInTheDocument();
  });
});
