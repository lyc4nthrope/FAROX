import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../shared/lib/supabase/client";
import { fetchDistributorUserCounts } from "./api";

// sdd/admin-console T-E2: capa api contra el cliente supabase MOCKEADO (mismo
// aislamiento que el resto de la suite — el cliente real valida el env al
// importar, V0-1). Se prueba el CONTRATO exacto que viaja al server: UNA sola
// lectura de users con la columna distributor_id, con el conteo por
// distributor_id agregado en el cliente (design #599 §4 lote E: sin N+1).
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

// Nodo thenable: await resuelve al resultado preparado por test (mismo
// patrón de builders que users/api.test.ts:41-71).
interface QueryStub {
  select: Mock;
  then: (
    onOk?: (value: unknown) => unknown,
    onErr?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
}

function crearQuery(): { stub: QueryStub; resolver: (r: Resultado) => void } {
  let resultado: Resultado = { data: [], error: null };
  const stub: QueryStub = {
    select: vi.fn(() => stub),
    then: (onOk, onErr) => Promise.resolve(resultado).then(onOk, onErr),
  };
  return {
    stub,
    resolver: (r) => {
      resultado = r;
    },
  };
}

let users!: ReturnType<typeof crearQuery>;

beforeEach(() => {
  vi.clearAllMocks();
  users = crearQuery();
  fromMock.mockImplementation((table: string) => {
    if (table === "users") return users.stub;
    throw new Error(`tabla inesperada: ${table}`);
  });
});

describe("distributors api · fetchDistributorUserCounts (T-E2 — 1 query, sin N+1)", () => {
  it("pide distributor_id en UNA sola query y agrega el conteo en el cliente", async () => {
    users.resolver({
      data: [
        { distributor_id: 1 },
        { distributor_id: 1 },
        { distributor_id: 5 },
        { distributor_id: null },
        { distributor_id: "id-roto" },
      ],
      error: null,
    });

    const { counts, error } = await fetchDistributorUserCounts();

    // UNA invocación de la fuente: jamás una query por fila de la lista.
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith("users");
    expect(users.stub.select).toHaveBeenCalledTimes(1);
    expect(users.stub.select).toHaveBeenCalledWith("distributor_id");
    expect(error).toBeNull();
    // distributor_id null (sin alcance) y formas inválidas no cuentan.
    expect(counts).toEqual({ 1: 2, 5: 1 });
  });

  it("error del server ⇒ { counts: null, error } para que la columna degrade a «—»", async () => {
    const serverError = { code: "42501", message: "permission denied (raw)" };
    users.resolver({ data: null, error: serverError });

    const { counts, error } = await fetchDistributorUserCounts();

    expect(counts).toBeNull();
    expect(error).toBe(serverError);
  });

  it("respuesta con data no-array ⇒ conteo vacío, sin crash", async () => {
    users.resolver({ data: { inesperado: true }, error: null });

    const { counts, error } = await fetchDistributorUserCounts();

    expect(error).toBeNull();
    expect(counts).toEqual({});
  });
});
