import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../shared/lib/supabase/client";
import { AUDIT_PAGE_SIZE, fetchAuditPage } from "./api";

// sdd/admin-console T-D1: capa api de audit contra el cliente supabase
// MOCKEADO (mismo aislamiento que roles/api.test.ts:11-15 — el cliente real
// valida el env al importar, V0-1). Se prueba el CONTRATO exacto que viaja
// al server: select de cols explícitas, keyset por id DESC con lookahead,
// filtro opcional por tabla y la regla dura de ADM-10.2 — NUNCA count.
vi.mock("../../shared/lib/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>;

interface Resultado {
  data?: unknown;
  error?: unknown;
}

type Mock = ReturnType<typeof vi.fn>;

// Builders encadenados: cada método devuelve el mismo nodo y el nodo ES
// thenable — así await resuelve al resultado preparado por test (patrón
// roles/api.test.ts:43-60).
interface QueryStub {
  select: Mock;
  lt: Mock;
  eq: Mock;
  order: Mock;
  limit: Mock;
  then: (
    onOk?: (value: unknown) => unknown,
    onErr?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
}

function crearQuery(): { stub: QueryStub; resolver: (r: Resultado) => void } {
  let resultado: Resultado = { data: [], error: null };
  const stub: QueryStub = {
    select: vi.fn(() => stub),
    lt: vi.fn(() => stub),
    eq: vi.fn(() => stub),
    order: vi.fn(() => stub),
    limit: vi.fn(() => stub),
    then: (onOk, onErr) => Promise.resolve(resultado).then(onOk, onErr),
  };
  return {
    stub,
    resolver: (r) => {
      resultado = r;
    },
  };
}

let tabla!: ReturnType<typeof crearQuery>;

const SELECT_COLS = "id, created_by, table_name, action, row_id, diff, created_at";

// Fila válida del contrato auditRowSchema (0003:255-266).
function fila(id: number, diff: unknown = { premium: { old: false, new: true } }) {
  return {
    id,
    created_by: "11111111-2222-3333-4444-555555555555",
    table_name: "users",
    action: "update",
    row_id: "u1",
    diff,
    created_at: "2026-10-20T12:00:00+00:00",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tabla = crearQuery();
  fromMock.mockImplementation((table: string) => {
    if (table === "audit_log") return tabla.stub;
    throw new Error(`tabla inesperada: ${table}`);
  });
});

describe("audit api · fetchAuditPage (keyset id DESC · ADM-10.2)", () => {
  it("1ª llamada sin cursor: select de cols explícitas, order id DESC y limit 25+1", async () => {
    tabla.resolver({ data: [fila(31), fila(30)], error: null });

    const { rows, hasMore, error } = await fetchAuditPage(null);

    expect(fromMock).toHaveBeenCalledWith("audit_log");
    expect(tabla.stub.select).toHaveBeenCalledWith(SELECT_COLS);
    expect(tabla.stub.order).toHaveBeenCalledWith("id", { ascending: false });
    expect(tabla.stub.limit).toHaveBeenCalledWith(AUDIT_PAGE_SIZE + 1);
    // Sin cursor NO hay .lt y sin filtro NO hay .eq.
    expect(tabla.stub.lt).not.toHaveBeenCalled();
    expect(tabla.stub.eq).not.toHaveBeenCalled();
    expect(error).toBeNull();
    expect(hasMore).toBe(false);
    expect(rows.map((row) => row.id)).toEqual([31, 30]);
  });

  it("2ª llamada con cursor: .lt(\"id\", <último id>) — estrictamente por debajo", async () => {
    tabla.resolver({ data: [fila(29)], error: null });

    await fetchAuditPage(30);

    expect(tabla.stub.lt).toHaveBeenCalledWith("id", 30);
  });

  it("lookahead: 26 filas ⇒ hasMore true y SOLO 25 rows (la extra no se muestra)", async () => {
    const crudas = Array.from({ length: AUDIT_PAGE_SIZE + 1 }, (_, i) =>
      fila(100 - i),
    );
    tabla.resolver({ data: crudas, error: null });

    const { rows, hasMore } = await fetchAuditPage(null);

    expect(hasMore).toBe(true);
    expect(rows).toHaveLength(AUDIT_PAGE_SIZE);
    expect(rows[rows.length - 1].id).toBe(100 - (AUDIT_PAGE_SIZE - 1));
  });

  it("ADM-10.2 (la regla dura): NUNCA count — select recibe UN solo argumento y la cadena no lo menciona", async () => {
    tabla.resolver({ data: [], error: null });

    await fetchAuditPage(null);

    // select(SELECT_COLS) sin objeto { count } ni head: true: la única
    // referencia a "count" permitida es hasMore, derivado del lookahead.
    expect(tabla.stub.select).toHaveBeenCalledTimes(1);
    expect(tabla.stub.select).toHaveBeenCalledWith(SELECT_COLS);
    expect(Object.keys(tabla.stub.select.mock.calls[0])).toEqual(["0"]);
  });

  it("filtro por tabla: encadena .eq(\"table_name\", …)", async () => {
    tabla.resolver({ data: [], error: null });

    await fetchAuditPage(null, "stores");

    expect(tabla.stub.eq).toHaveBeenCalledWith("table_name", "stores");
  });

  it("filtro inválido (Zod): CERO llamadas a supabase y error sin texto crudo del server", async () => {
    const { rows, hasMore, error } = await fetchAuditPage(null, "no_existe");

    expect(fromMock).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
    expect(hasMore).toBe(false);
    expect(error).not.toBeNull();
  });

  it("cursor inválido (negativo/decimal): CERO llamadas — nunca un offset inventado", async () => {
    await fetchAuditPage(-5);
    await fetchAuditPage(3.5);

    expect(fromMock).not.toHaveBeenCalled();
  });

  it("filas que no cumplen el contrato Zod se descartan sin romper la página", async () => {
    tabla.resolver({
      data: [fila(31), { id: "no-numero", action: "explode" }, fila(29)],
      error: null,
    });

    const { rows, error } = await fetchAuditPage(null);

    expect(error).toBeNull();
    expect(rows.map((row) => row.id)).toEqual([31, 29]);
  });

  it("diff null/array pasan la normalización defensiva (jsonb impredecible)", async () => {
    tabla.resolver({
      data: [fila(31, null), fila(30, [{ col: "x" }])],
      error: null,
    });

    const { rows } = await fetchAuditPage(null);

    expect(rows[0].diff).toBeNull();
    expect(rows[1].diff).toEqual([{ col: "x" }]);
  });

  it("error del server ⇒ rows vacías y error CRUDO para mapError (HARD-1)", async () => {
    const serverError = { code: "42501", message: "permission denied (raw)" };
    tabla.resolver({ data: null, error: serverError });

    const result = await fetchAuditPage(null);

    expect(result).toEqual({ rows: [], hasMore: false, error: serverError });
  });
});
