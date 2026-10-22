import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../shared/lib/supabase/client";
import { createRole, deleteRole, fetchRole, fetchRoles, updateRole } from "./api";

// sdd/admin-console T-C1: capa api de roles contra el cliente supabase
// MOCKEADO (mismo aislamiento que users/api.test.ts — el cliente real
// valida el env al importar, V0-1). Se prueba el CONTRATO exacto que viaja
// al server: cadenas select/order/eq y la síntesis de 42501 en 0 filas
// (design #599 §2.2).
vi.mock("../../shared/lib/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>;

interface Resultado {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

type Mock = ReturnType<typeof vi.fn>;

// Builders encadenados: cada método devuelve el mismo nodo y el nodo ES
// thenable — así await resuelve al resultado preparado por test (patrón
// users/api.test.ts:54-71).
interface QueryStub {
  select: Mock;
  order: Mock;
  eq: Mock;
  single: Mock;
  update: Mock;
  delete: Mock;
  then: (
    onOk?: (value: unknown) => unknown,
    onErr?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
}

function crearQuery(): { stub: QueryStub; resolver: (r: Resultado) => void } {
  let resultado: Resultado = { data: [], error: null };
  const stub: QueryStub = {
    select: vi.fn(() => stub),
    order: vi.fn(() => stub),
    eq: vi.fn(() => stub),
    single: vi.fn(() => stub),
    update: vi.fn(() => stub),
    delete: vi.fn(() => stub),
    then: (onOk, onErr) => Promise.resolve(resultado).then(onOk, onErr),
  };
  return {
    stub,
    resolver: (r) => {
      resultado = r;
    },
  };
}

let roles!: ReturnType<typeof crearQuery>;
const insertMock = vi.fn(() => roles.stub);

beforeEach(() => {
  vi.clearAllMocks();
  roles = crearQuery();
  fromMock.mockImplementation((table: string) => {
    if (table === "roles") return roles.stub;
    throw new Error(`tabla inesperada: ${table}`);
  });
  // insert() devuelve el MISMO stub (thenable) — se registra aparte para
  // poder asertar su payload sin perder el resto de la cadena.
  (roles.stub as unknown as { insert: Mock }).insert = insertMock;
  insertMock.mockImplementation(() => roles.stub);
});

const SELECT_COLS = "id, name, description";

describe("roles api · fetchRoles (lista /roles, catalogs_select 0006:56-57)", () => {
  it("pide id/name/description ordenado por nombre y normaliza las filas", async () => {
    roles.resolver({
      data: [
        { id: 1, name: "admin", description: "Acceso total" },
        { id: 4, name: "supervisor", description: null },
      ],
      error: null,
    });

    const { rows, error } = await fetchRoles();

    expect(fromMock).toHaveBeenCalledWith("roles");
    expect(roles.stub.select).toHaveBeenCalledWith(SELECT_COLS);
    expect(roles.stub.order).toHaveBeenCalledWith("name");
    expect(error).toBeNull();
    expect(rows).toEqual([
      { id: 1, name: "admin", description: "Acceso total" },
      { id: 4, name: "supervisor", description: null },
    ]);
  });

  it("error del server ⇒ rows vacías y error CRUDO para mapError (HARD-1)", async () => {
    const serverError = { code: "42501", message: "permission denied (raw)" };
    roles.resolver({ data: null, error: serverError });

    const result = await fetchRoles();

    expect(result).toEqual({ rows: [], error: serverError });
  });
});

describe("roles api · fetchRole (detalle /roles/:id)", () => {
  it("select + eq por id + single", async () => {
    roles.resolver({
      data: { id: 2, name: "operador", description: "Ejecución" },
      error: null,
    });

    const { row, error } = await fetchRole(2);

    expect(roles.stub.select).toHaveBeenCalledWith(SELECT_COLS);
    expect(roles.stub.eq).toHaveBeenCalledWith("id", 2);
    expect(roles.stub.single).toHaveBeenCalled();
    expect(error).toBeNull();
    expect(row).toEqual({ id: 2, name: "operador", description: "Ejecución" });
  });

  it("sin fila (PGRST116) ⇒ { row: null, error } crudo (mapError :68-70)", async () => {
    const notFound = {
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
    };
    roles.resolver({ data: null, error: notFound });

    const result = await fetchRole(999);

    expect(result).toEqual({ row: null, error: notFound });
  });
});

describe("roles api · createRole (ADM-8.1 — INSERT directo, policy 0006:58-59)", () => {
  it("inserta { name, description } — description vacía viaja NULL (0002:44)", async () => {
    roles.resolver({ data: null, error: null });

    const { error } = await createRole({ name: "operador", description: "Otra vez" });

    expect(insertMock).toHaveBeenCalledWith({
      name: "operador",
      description: "Otra vez",
    });
    expect(error).toBeNull();
  });

  it("descripción vacía ⇒ null en el payload (columna nullable)", async () => {
    roles.resolver({ data: null, error: null });

    await createRole({ name: "operador", description: "" });

    expect(insertMock).toHaveBeenCalledWith({ name: "operador", description: null });
  });

  it("error del server (p. ej. 23505 duplicado) sale CRUDO para mapError", async () => {
    const serverError = { code: "23505", message: "duplicate key value (raw)" };
    roles.resolver({ data: null, error: serverError });

    const { error } = await createRole({ name: "admin", description: "" });

    expect(error).toBe(serverError);
  });
});

describe("roles api · updateRole (edición — 0 filas ⇒ 42501 sintetizado)", () => {
  it("update + eq por id + select id con el payload exacto", async () => {
    roles.resolver({ data: [{ id: 4 }], error: null });

    const { error } = await updateRole(4, { name: "operador", description: "Corregido" });

    expect(roles.stub.update).toHaveBeenCalledWith({
      name: "operador",
      description: "Corregido",
    });
    expect(roles.stub.eq).toHaveBeenCalledWith("id", 4);
    expect(roles.stub.select).toHaveBeenCalledWith("id");
    expect(error).toBeNull();
  });

  it("0 filas afectadas (RLS) ⇒ sintetiza 42501 — nunca un falso éxito", async () => {
    roles.resolver({ data: [], error: null });

    const { error } = await updateRole(4, { name: "operador", description: "" });

    expect(error).not.toBeNull();
    expect((error as unknown as { code?: string }).code).toBe("42501");
  });
});

describe("roles api · deleteRole (ADM-8.4 — HARD delete, FK RESTRICT ⇒ 23503)", () => {
  it("delete + eq por id + select id", async () => {
    roles.resolver({ data: [{ id: 4 }], error: null });

    const { error } = await deleteRole(4);

    expect(roles.stub.delete).toHaveBeenCalled();
    expect(roles.stub.eq).toHaveBeenCalledWith("id", 4);
    expect(roles.stub.select).toHaveBeenCalledWith("id");
    expect(error).toBeNull();
  });

  it("rol en uso (23503 del server) ⇒ sale CRUDO para mapError («en uso», T-B1)", async () => {
    const serverError = {
      code: "23503",
      message: "update or delete on table roles violates foreign key (raw)",
    };
    roles.resolver({ data: null, error: serverError });

    const { error } = await deleteRole(1);

    expect(error).toBe(serverError);
  });

  it("0 filas afectadas (RLS) ⇒ sintetiza 42501 — nunca un falso éxito", async () => {
    roles.resolver({ data: [], error: null });

    const { error } = await deleteRole(1);

    expect(error).not.toBeNull();
    expect((error as unknown as { code?: string }).code).toBe("42501");
  });
});
