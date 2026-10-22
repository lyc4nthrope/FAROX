import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../shared/lib/supabase/client";
import {
  fetchDistributorOptions,
  fetchUser,
  fetchUserStoreCounts,
  fetchUserStores,
  fetchUsers,
  setUserActive,
  setUserPremium,
  updateUserProfile,
  updateUserRole,
} from "./api";

// sdd/admin-console T-B3: capa api contra el cliente supabase MOCKEADO
// (mismo aislamiento que el resto de la suite — el cliente real valida el env
// al importar, V0-1). Se prueba el CONTRATO exacto que viaja al server:
// cadenas select/eq/order/range y firmas rpc EXACTAS (design #599 §2.1).
vi.mock("../../shared/lib/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

const rpcMock = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>;

interface Resultado {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

type Mock = ReturnType<typeof vi.fn>;

// Builders encadenados: cada método devuelve el mismo nodo y el nodo ES
// thenable — así await resuelve al resultado preparado por test (patrón de
// onboarding/api.test.ts adaptado a cadenas multi-tabla).
interface QueryStub {
  select: Mock;
  order: Mock;
  range: Mock;
  eq: Mock;
  single: Mock;
  update: Mock;
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
    range: vi.fn(() => stub),
    eq: vi.fn(() => stub),
    single: vi.fn(() => stub),
    update: vi.fn(() => stub),
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
let userStores!: ReturnType<typeof crearQuery>;
let distributors!: ReturnType<typeof crearQuery>;

beforeEach(() => {
  vi.clearAllMocks();
  users = crearQuery();
  userStores = crearQuery();
  distributors = crearQuery();
  fromMock.mockImplementation((table: string) => {
    if (table === "users") return users.stub;
    if (table === "user_stores") return userStores.stub;
    if (table === "distributors") return distributors.stub;
    throw new Error(`tabla inesperada: ${table}`);
  });
  rpcMock.mockResolvedValue({ data: null, error: null });
});

// Cols exactas de FORM_SELECT (ver api.ts) — el string viaja tal cual al server.
const FORM_SELECT =
  "id, email, full_name, phone_number, contact_preference, distributor_id, premium, is_active";

describe("users api · fetchUsers (lista /users, policy users_select 0006:202-204)", () => {
  it("pide las cols + embed de rol con count planned, order full_name y range de página", async () => {
    users.resolver({
      data: [
        {
          id: "u1",
          email: "ana@farox.app",
          full_name: "Ana Pérez",
          premium: true,
          is_active: true,
          role: { name: "admin" },
        },
      ],
      count: 1,
      error: null,
    });

    const result = await fetchUsers({ page: 0, pageSize: 25 });

    expect(fromMock).toHaveBeenCalledWith("users");
    expect(users.stub.select).toHaveBeenCalledWith(
      `${FORM_SELECT}, role:roles(name)`,
      { count: "planned" },
    );
    expect(users.stub.order).toHaveBeenCalledWith("full_name");
    expect(users.stub.range).toHaveBeenCalledWith(0, 24);
    expect(result.count).toBe(1);
    expect(result.rows).toEqual([
      {
        id: "u1",
        email: "ana@farox.app",
        full_name: "Ana Pérez",
        premium: true,
        is_active: true,
        role_name: "admin",
        store_count: null,
      },
    ]);
  });

  it("rol embebido ausente o nulo ⇒ role_name null (fila degrada sin badge)", async () => {
    users.resolver({
      data: [
        {
          id: "u2",
          email: "sin@rol.app",
          full_name: "Sin Rol",
          premium: false,
          is_active: false,
          role: null,
        },
      ],
      count: 1,
      error: null,
    });

    const result = await fetchUsers({ page: 1, pageSize: 25 });

    expect(users.stub.range).toHaveBeenCalledWith(25, 49);
    expect(result.rows[0].role_name).toBeNull();
    expect(result.rows[0].premium).toBe(false);
    expect(result.rows[0].is_active).toBe(false);
  });

  it("error del server ⇒ sale CRUDO para mapError en el call site (HARD-1)", async () => {
    const serverError = { code: "42501", message: "permission denied for table users" };
    users.resolver({ data: null, error: serverError });

    const result = await fetchUsers({ page: 0, pageSize: 25 });

    expect(result).toEqual({ rows: [], count: null, error: serverError });
  });
});

describe("users api · fetchUser (detalle /users/:id)", () => {
  it("select de detalle + role con id, eq por id y single", async () => {
    users.resolver({
      data: {
        id: "u1",
        email: "ana@farox.app",
        full_name: "Ana Pérez",
        phone_number: "300 111 2222",
        contact_preference: "email",
        distributor_id: 7,
        premium: false,
        is_active: true,
        role: { id: 3, name: "distribuidor" },
      },
      error: null,
    });

    const { row, error } = await fetchUser("u1");

    expect(users.stub.select).toHaveBeenCalledWith(
      `${FORM_SELECT}, role:roles(id,name)`,
    );
    expect(users.stub.eq).toHaveBeenCalledWith("id", "u1");
    expect(users.stub.single).toHaveBeenCalled();
    expect(error).toBeNull();
    expect(row).toEqual({
      id: "u1",
      email: "ana@farox.app",
      full_name: "Ana Pérez",
      phone_number: "300 111 2222",
      contact_preference: "email",
      distributor_id: 7,
      premium: false,
      is_active: true,
      role: { id: 3, name: "distribuidor" },
    });
  });

  it("sin fila (PGRST116) ⇒ { row: null, error } crudo (mapError :68-70)", async () => {
    const notFound = {
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
    };
    users.resolver({ data: null, error: notFound });

    const result = await fetchUser("u-404");

    expect(result).toEqual({ row: null, error: notFound });
  });
});

describe("users api · updateUserProfile (ADM-4 — SOLO las 3 columnas GRANT'd)", () => {
  it("update con EXACTAMENTE { full_name, phone_number, contact_preference } + eq + select id", async () => {
    users.resolver({ data: [{ id: "u1" }], error: null });

    const { error } = await updateUserProfile("u1", {
      full_name: "Ana Pérez",
      phone_number: "300 111 2222",
      contact_preference: "email",
    });

    expect(error).toBeNull();
    // toEqual bidireccional: cualquier 4ª columna (role_id, premium…)
    // rompería el match — D45: privilegiadas solo por RPC.
    expect(users.stub.update).toHaveBeenCalledWith({
      full_name: "Ana Pérez",
      phone_number: "300 111 2222",
      contact_preference: "email",
    });
    expect(users.stub.eq).toHaveBeenCalledWith("id", "u1");
    expect(users.stub.select).toHaveBeenCalledWith("id");
  });

  it("teléfono vacío viajan NULL (columna nullable, convención profile/api)", async () => {
    users.resolver({ data: [{ id: "u1" }], error: null });

    await updateUserProfile("u1", {
      full_name: "Ana Pérez",
      phone_number: "",
      contact_preference: "whatsapp",
    });

    expect(users.stub.update).toHaveBeenCalledWith({
      full_name: "Ana Pérez",
      phone_number: null,
      contact_preference: "whatsapp",
    });
  });

  it("0 filas afectadas (RLS) ⇒ sintetiza 42501 — nunca un falso éxito", async () => {
    users.resolver({ data: [], error: null });

    const { error } = await updateUserProfile("u1", {
      full_name: "Ana Pérez",
      phone_number: "",
      contact_preference: "whatsapp",
    });

    expect(error).not.toBeNull();
    expect((error as unknown as { code?: string }).code).toBe("42501");
  });

  it("error del server ⇒ sale CRUDO para mapError (HARD-1)", async () => {
    const serverError = { code: "42501", message: "permission denied (raw)" };
    users.resolver({ data: null, error: serverError });

    const { error } = await updateUserProfile("u1", {
      full_name: "Ana Pérez",
      phone_number: "",
      contact_preference: "whatsapp",
    });

    expect(error).toBe(serverError);
  });
});

describe("users api · RPCs de rol/premium/activo (ADM-5/ADM-6 — firmas 0011)", () => {
  it("update_user_role con p_user/p_role/p_distributor (0011:85-87)", async () => {
    await updateUserRole("u1", "operador", null);

    expect(rpcMock).toHaveBeenCalledWith("update_user_role", {
      p_user: "u1",
      p_role: "operador",
      p_distributor: null,
    });
  });

  it("update_user_role con distribuidor elegido ⇒ p_distributor numérico (M11)", async () => {
    await updateUserRole("u2", "distribuidor", 7);

    expect(rpcMock).toHaveBeenCalledWith("update_user_role", {
      p_user: "u2",
      p_role: "distribuidor",
      p_distributor: 7,
    });
  });

  it("set_user_premium con p_user_id/p_value (0011:111-112)", async () => {
    await setUserPremium("u1", true);

    expect(rpcMock).toHaveBeenCalledWith("set_user_premium", {
      p_user_id: "u1",
      p_value: true,
    });
  });

  it("set_user_active con p_user_id/p_value (0011:126-127)", async () => {
    await setUserActive("u1", false);

    expect(rpcMock).toHaveBeenCalledWith("set_user_active", {
      p_user_id: "u1",
      p_value: false,
    });
  });

  it("el error de la RPC sale CRUDO para mapError en el call site (HARD-1)", async () => {
    const serverError = { code: "P0001", message: "update_user_role: rol inexistente" };
    rpcMock.mockResolvedValue({ data: null, error: serverError });

    const { error } = await updateUserRole("u1", "operador", null);

    expect(error).toBe(serverError);
  });
});

describe("users api · fetchUserStores (ADM-7 — SOLO lectura, scope SOLO por user_id)", () => {
  it("filtra EXCLUSIVAMENTE por user_id — sin filtro «admin» client-side (ADM-1.1 lo da la policy)", async () => {
    userStores.resolver({
      data: [
        {
          store_id: 5,
          created_at: "2026-10-20T00:00:00+00:00",
          stores: { name: "Tienda Centro", city: "Bogotá" },
        },
        {
          store_id: 6,
          created_at: "2026-10-20T00:00:01+00:00",
          stores: null,
        },
      ],
      error: null,
    });

    const { rows, error } = await fetchUserStores("u1");

    expect(fromMock).toHaveBeenCalledWith("user_stores");
    expect(userStores.stub.select).toHaveBeenCalledWith(
      "store_id, created_at, stores(name,city)",
    );
    // Único filtro de la cadena: el scope lo decide la RLS, no el front.
    expect(userStores.stub.eq).toHaveBeenCalledTimes(1);
    expect(userStores.stub.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(error).toBeNull();
    expect(rows).toEqual([
      {
        store_id: 5,
        created_at: "2026-10-20T00:00:00+00:00",
        store_name: "Tienda Centro",
        store_city: "Bogotá",
      },
      { store_id: 6, created_at: "2026-10-20T00:00:01+00:00", store_name: null, store_city: null },
    ]);
  });

  it("error (p. ej. sin el GRANT D2a ⇒ 42501) ⇒ rows vacías y error crudo (I4)", async () => {
    const serverError = { code: "42501", message: "permission denied for table user_stores" };
    userStores.resolver({ data: null, error: serverError });

    const result = await fetchUserStores("u1");

    expect(result).toEqual({ rows: [], error: serverError });
  });
});

describe("users api · fetchUserStoreCounts (FLAG-4 — query de apoyo de la columna Tiendas)", () => {
  it("agrega las filas por user_id", async () => {
    userStores.resolver({
      data: [{ user_id: "u1" }, { user_id: "u1" }, { user_id: "u2" }],
      error: null,
    });

    const { counts, error } = await fetchUserStoreCounts();

    expect(fromMock).toHaveBeenCalledWith("user_stores");
    expect(userStores.stub.select).toHaveBeenCalledWith("user_id");
    expect(error).toBeNull();
    expect(counts).toEqual({ u1: 2, u2: 1 });
  });

  it("error ⇒ { counts: null, error } para que la lista degrade a «—» (FLAG-4)", async () => {
    const serverError = { code: "42501", message: "permission denied (raw)" };
    userStores.resolver({ data: null, error: serverError });

    const { counts, error } = await fetchUserStoreCounts();

    expect(counts).toBeNull();
    expect(error).toBe(serverError);
  });
});

describe("users api · fetchDistributorOptions (picker del panel de rol, M11)", () => {
  it("trae id+name ordenado por nombre y normaliza las filas", async () => {
    distributors.resolver({
      data: [
        { id: 7, name: "Distribuidora Sur" },
        { id: 8, name: "Distribuidora Norte" },
        { id: "9", name: "Inválida" },
      ],
      error: null,
    });

    const { options, error } = await fetchDistributorOptions();

    expect(fromMock).toHaveBeenCalledWith("distributors");
    expect(distributors.stub.select).toHaveBeenCalledWith("id,name");
    expect(distributors.stub.order).toHaveBeenCalledWith("name");
    expect(error).toBeNull();
    expect(options).toEqual([
      { id: 7, name: "Distribuidora Sur" },
      { id: 8, name: "Distribuidora Norte" },
    ]);
  });

  it("error del picker ⇒ options vacías y error crudo para mapError", async () => {
    const serverError = { message: "raw" };
    distributors.resolver({ data: null, error: serverError });

    const result = await fetchDistributorOptions();

    expect(result).toEqual({ options: [], error: serverError });
  });
});
