import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import * as auditApi from "../api";
import {
  diffCambios,
  diffResumen,
  formatDiffValue,
} from "../components/AuditTable";
import type { AuditRow } from "../types";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { RequireRole } from "../../../app/guards/RequireRole";
import { AuditPage } from "./AuditPage";

// sdd/admin-console T-D2 + T-B10 (ADM-10.1..10.3): visor /audit con el api de
// la feature mockeado COMPLETO y fetchPrivileges mockeado por rol (patrón
// StoresPage.test.tsx:56-57) — NINGÚN test depende de un admin real (R4/B0).
// Cero red real: los errores se inyectan con su forma canónica.
vi.mock("../api", () => ({
  fetchAuditPage: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

// Helpers puros del render defensivo del diff (T-D1) — se importan arriba
// con el resto (regla de imports del lint).

const PAGE_VACIA = { rows: [], hasMore: false, error: null };

function fila(id: number, extras: Partial<AuditRow> = {}): AuditRow {
  return {
    id,
    created_by: "11111111-2222-3333-4444-555555555555",
    table_name: "users",
    action: "update",
    row_id: `u${id}`,
    diff: { premium: { old: false, new: true } },
    created_at: "2026-10-20T12:00:00+00:00",
    ...extras,
  };
}

function renderPagina() {
  vi.mocked(authApi.getSession).mockResolvedValue({
    userId: "u1",
    email: "demo@farox.app",
  });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "admin", premium: false });
  return render(
    <MemoryRouter initialEntries={["/audit"]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/audit"
            element={
              <RequireRole roles={["admin"]}>
                <AuditPage />
              </RequireRole>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// Forma REAL de una denegación PostgREST/RLS: SQLSTATE 42501 en `code`.
// Variable porque el literal con `code` chocaría con el excess-property check.
const ERROR_RLS = { code: "42501", message: "permission denied for table audit_log (raw)" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(auditApi.fetchAuditPage).mockResolvedValue(PAGE_VACIA);
});

afterEach(() => {
  cleanup();
});

describe("AuditPage · ADM-10.1 (lista de eventos)", () => {
  it("pinta eventos con acción en español, tabla, fila y actor truncado", async () => {
    vi.mocked(auditApi.fetchAuditPage).mockResolvedValue({
      rows: [fila(31), fila(30, { action: "insert", table_name: "stores", row_id: "7" })],
      hasMore: false,
      error: null,
    });
    renderPagina();

    expect(await screen.findByText("Modificación")).toBeInTheDocument();
    expect(screen.getByText("Alta")).toBeInTheDocument();
    // La tabla (no el select de filtros): el <option> «stores» también existe.
    const grilla = screen.getByRole("table");
    expect(within(grilla).getByText("stores")).toBeInTheDocument();
    expect(screen.getByText("u31")).toBeInTheDocument();
    // Actor truncado a 8 chars en AMBAS filas (mismo uuid) — el completo
    // jamás se renderiza.
    expect(screen.getAllByText("11111111…")).toHaveLength(2);
    // Sin total exacto en el DOM (ADM-10.2): el keyset no conoce el total.
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
    expect(screen.getByText("No hay más eventos.")).toBeInTheDocument();
  });

  it("lista vacía ⇒ EmptyState amigable (vacío ≠ error, D4) sin crash", async () => {
    renderPagina();

    expect(
      await screen.findByText("Todavía no hay eventos registrados."),
    ).toBeInTheDocument();
  });

  it("error del server (42501) ⇒ ErrorBanner amigable vía mapError, nunca texto crudo", async () => {
    vi.mocked(auditApi.fetchAuditPage).mockResolvedValue({
      rows: [],
      hasMore: false,
      error: ERROR_RLS,
    });
    renderPagina();

    expect(
      await screen.findByText("No tenés permisos para esta operación."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });
});

describe("AuditPage · ADM-10.2 (keyset, sin count)", () => {
  it("«Cargar más» usa de cursor el id de la ÚLTIMA fila: la 2ª página pide estrictamente filas por debajo", async () => {
    vi.mocked(auditApi.fetchAuditPage).mockResolvedValueOnce({
      rows: [fila(31), fila(30)],
      hasMore: true,
      error: null,
    });
    renderPagina();
    await screen.findByText("u31");

    vi.mocked(auditApi.fetchAuditPage).mockResolvedValueOnce({
      rows: [fila(29)],
      hasMore: false,
      error: null,
    });
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));

    // Cursor = id de la última fila VISIBLE (30): el server devuelve ids
    // estrictamente menores (lt + order id DESC, design §2.4).
    expect(auditApi.fetchAuditPage).toHaveBeenLastCalledWith(30, undefined);
    // Las dos páginas quedan acumuladas, sin duplicados.
    expect(await screen.findByText("u29")).toBeInTheDocument();
    expect(screen.getByText("u30")).toBeInTheDocument();
    expect(screen.getByText("No hay más eventos.")).toBeInTheDocument();
  });

  it("el total jamás aparece en el DOM ni el api recibe un segundo argumento de conteo", async () => {
    vi.mocked(auditApi.fetchAuditPage).mockResolvedValue({
      rows: [fila(31)],
      hasMore: true,
      error: null,
    });
    renderPagina();
    await screen.findByText("u31");

    for (const llamada of vi.mocked(auditApi.fetchAuditPage).mock.calls) {
      expect(llamada).toHaveLength(2);
      expect(llamada[0]).not.toEqual(expect.objectContaining({ count: expect.anything() }));
    }
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
  });

  it("cambio de filtro ⇒ refetch de página 1 SIN cursor y con el table_name elegido", async () => {
    renderPagina();
    await screen.findByText("Todavía no hay eventos registrados.");

    await userEvent.selectOptions(screen.getByLabelText("Filtrar por tabla"), "stores");

    expect(auditApi.fetchAuditPage).toHaveBeenLastCalledWith(null, "stores");
  });
});

describe("AuditPage · ADM-10.3 (cero escritura)", () => {
  it("el DOM no contiene ningún control de crear/editar/borrar", async () => {
    vi.mocked(auditApi.fetchAuditPage).mockResolvedValue({
      rows: [fila(31)],
      hasMore: true,
      error: null,
    });
    renderPagina();
    await screen.findByText("u31");

    // Único botón posible: «Cargar más» (lectura). Ninguno de escritura.
    expect(screen.queryByRole("button", { name: /crear|nuevo|agregar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /editar|modificar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /borrar|eliminar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /crear|nuevo/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Cargar más"]);
  });
});

describe("AuditPage · render defensivo del diff jsonb (T-D1/T-D2)", () => {
  it("diff objeto ⇒ resumen «col: valor» con <details> que lista los cambios", async () => {
    vi.mocked(auditApi.fetchAuditPage).mockResolvedValue({
      rows: [fila(31, { diff: { premium: { old: false, new: true }, email: "a@b.c" } })],
      hasMore: false,
      error: null,
    });
    renderPagina();
    await screen.findByText("u31");

    const resumen = screen.getByText(/premium: \[valor complejo\] · \+1 más/);
    await userEvent.click(resumen);
    expect(screen.getByText("email: a@b.c")).toBeInTheDocument();
    // El jsonb nunca se vuelca crudo: el valor anidado es «[valor complejo]».
    expect(screen.queryByText(/"old"/)).not.toBeInTheDocument();
  });

  it("diff null ⇒ «Sin cambios registrados», sin crash ni JSON vacío", async () => {
    vi.mocked(auditApi.fetchAuditPage).mockResolvedValue({
      rows: [fila(31, { diff: null })],
      hasMore: false,
      error: null,
    });
    renderPagina();

    expect(await screen.findByText("Sin cambios registrados")).toBeInTheDocument();
  });

  it("diff array ⇒ resumen y detalle numerados", async () => {
    vi.mocked(auditApi.fetchAuditPage).mockResolvedValue({
      rows: [fila(31, { diff: [{ col: "x" }, "razón"] })],
      hasMore: false,
      error: null,
    });
    renderPagina();
    await screen.findByText("u31");

    await userEvent.click(screen.getByText(/cambio 1: \[valor complejo\] · \+1 más/));
    expect(screen.getByText("cambio 2: razón")).toBeInTheDocument();
  });

  it("diff vacío ({}) ⇒ «Sin cambios registrados»", async () => {
    vi.mocked(auditApi.fetchAuditPage).mockResolvedValue({
      rows: [fila(31, { diff: {} })],
      hasMore: false,
      error: null,
    });
    renderPagina();

    expect(await screen.findByText("Sin cambios registrados")).toBeInTheDocument();
  });
});

describe("formateadores puros del diff", () => {
  it("primitivas se truncan; estructuras nunca se serializan crudas", () => {
    expect(formatDiffValue("x".repeat(200))).toHaveLength(49); // 48 + ellipsis
    expect(formatDiffValue("")).toBe("(vacío)");
    expect(formatDiffValue(42)).toBe("42");
    expect(formatDiffValue({ deep: { x: 1 } })).toBe("[valor complejo]");
    expect(diffCambios(null)).toEqual([]);
    expect(diffResumen("cambio libre")).toBe("cambio libre");
  });
});
