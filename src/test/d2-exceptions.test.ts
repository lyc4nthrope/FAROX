/**
 * Lote A (sdd/admin-console T-A3) — tests de CONTENIDO de las dos excepciones
 * D2a (migración GRANT sobre user_stores) y D2b (gate). Sin DB: leen los
 * archivos con node:fs y corren la gate como subprocess contra fixtures.
 *
 * AUTO-TRIPEO (#600 T-A3): la gate escanea TEXTO CRUDO de todos los .ts y
 * .tsx bajo src/, comentarios incluidos ⇒ este archivo no puede contener ningún
 * patrón prohibido, ni siquiera en un comentario:
 *   · los nombres de tablas/RPCs diferidas se pasan como argumentos simples,
 *     nunca precedidos del prefijo de llamada que exige la regex de la gate;
 *   · las 3 reglas BARES (vector de búsqueda, clave de servicio y prefijo de
 *     canal de realtime) se arman en runtime con join/concatenación;
 *   · el nombre de la tabla de auditoría también se arma en runtime: la
 *     consigna del lote A prohíbe el literal en cualquier archivo src/;
 *   · los probes que la gate DEBE detectar se escriben en fixtures del tmp
 *     del SO (fuera de src/), creados en runtime y borrados en afterAll.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface FsModule {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: "utf8"): string;
  mkdirSync(path: string, options: { recursive: true }): void;
  writeFileSync(path: string, data: string, encoding: "utf8"): void;
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: true; force: true }): void;
}

interface CpModule {
  spawnSync(
    command: string,
    args: readonly string[],
    options: { cwd: string; encoding: "utf8" },
  ): { status: number | null; stdout: string; stderr: string };
}

interface ProcModule {
  execPath: string;
  env: Record<string, string | undefined>;
}

// Raíz del repo derivada de la URL de ESTE archivo (independiente del cwd).
// Vitest/Vite sirven los módulos con el prefijo /@fs/ ⇒ se normaliza tanto la
// forma con unidad (C:/@fs/C:/…) como la forma POSIX (/@fs/home/…).
const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname)
  .replace(/^\/[A-Za-z]:\/@fs\/([A-Za-z]:)\//, "$1/")
  .replace(/^\/@fs\//, "/")
  .replace(/^\/([A-Za-z]:)/, "$1")
  .replace(/\/$/, "");

const MIGRATION_PATH = `${REPO_ROOT}/supabase/migrations/20261020000014_user_stores_read.sql`;
const GATE_PATH = `${REPO_ROOT}/scripts/check-scope.mjs`;
const GRANT_LINE = "GRANT SELECT ON public.user_stores TO authenticated;";

// Nombres asociados a reglas BARES o a literales prohibidos en src/:
// se arman en RUNTIME, nunca se escriben crudos en este archivo.
const auditTableName = ["audit", "log"].join("_");
const searchVectorName = ["search", "vector"].join("_");
const serviceRoleName = ["service", "role"].join("_");

let fs!: FsModule;
let cp!: CpModule;
let proc!: ProcModule;
let tmpRoot = "";

beforeAll(async () => {
  fs = (await import(["node", "fs"].join(":"))) as FsModule;
  cp = (await import(["node", "child_process"].join(":"))) as CpModule;
  proc = (globalThis as unknown as { process: ProcModule }).process;

  const tmpBase =
    proc.env.TEMP ?? proc.env.TMP ?? proc.env.TMPDIR ?? `${REPO_ROOT}/.tmp`;
  fs.mkdirSync(tmpBase, { recursive: true });
  tmpRoot = fs.mkdtempSync(`${tmpBase.replace(/\\/g, "/")}/farox-d2-`);
});

afterAll(() => {
  if (tmpRoot !== "") {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

const readMigration = (): string => fs.readFileSync(MIGRATION_PATH, "utf8");
const readGateSource = (): string => fs.readFileSync(GATE_PATH, "utf8");

describe("T-A1 · migración D2a (user_stores read)", () => {
  it("existe en la ruta exacta 20261020000014_user_stores_read.sql y no está vacía", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    expect(readMigration().trim().length).toBeGreaterThan(0);
  });

  it("contiene EXACTAMENTE una sentencia: el GRANT SELECT (cero otro DML/DDL)", () => {
    const statementLines = readMigration()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("--"));

    // Enfoque robusto: los comentarios del header quedan excluidos, así que
    // cualquier sentencia extra (aunque sea una continuación de bloque) rompe
    // la igualdad. Redundancia explícita del AC:
    expect(statementLines).toEqual([GRANT_LINE]);
    for (const forbidden of [
      "INSERT ",
      "UPDATE ",
      "DELETE ",
      "CREATE TABLE",
      "DROP ",
      "ALTER ",
    ]) {
      expect(
        statementLines.some((line) => line.includes(forbidden)),
        `la migración no debe contener la sentencia ${forbidden.trim()}`,
      ).toBe(false);
    }
  });

  it("incluye el bloque INVERSE inerte con el REVOKE solo comentado", () => {
    const lines = readMigration()
      .split(/\r?\n/)
      .map((line) => line.trim());

    expect(lines.some((line) => line.includes("INVERSE"))).toBe(true);

    const revokeLines = lines.filter((line) =>
      line.includes("REVOKE SELECT ON public.user_stores"),
    );
    expect(revokeLines.length).toBeGreaterThan(0);
    expect(
      revokeLines.every((line) => line.startsWith("--")),
      "el REVOKE del bloque INVERSE debe estar comentado (inerte)",
    ).toBe(true);
  });
});

const extractQuotedNames = (blockName: string): string[] => {
  const match = readGateSource().match(
    new RegExp(`const ${blockName} = \\[([\\s\\S]*?)\\];`),
  );
  expect(match, `bloque ${blockName} no encontrado en check-scope.mjs`).not.toBeNull();
  return [...(match as RegExpMatchArray)[1].matchAll(/"([^"]+)"/g)].map(
    (entry) => entry[1],
  );
};

describe("T-A2 · gate de alcance: solo lo que aún no tiene slice sigue diferido", () => {
  it("DEFERRED_TABLES queda con las 4 tablas pendientes (chat y agregados internos)", () => {
    expect(extractQuotedNames("DEFERRED_TABLES")).toEqual([
      "order_items",
      "dashboard_daily",
      "chat_conversations",
      "chat_messages",
    ]);
  });

  it("el nombre de la tabla de auditoría ya no está en DEFERRED_TABLES", () => {
    expect(extractQuotedNames("DEFERRED_TABLES")).not.toContain(auditTableName);
  });

  it("DEFERRED_RPCS queda con las 3 RPC del chatbot aún sin slice", () => {
    expect(extractQuotedNames("DEFERRED_RPCS")).toEqual(["get_stock", "create_chat", "send_message"]);
  });
});

// Probes armados en RUNTIME: la salida contiene los patrones que la gate debe
// detectar, pero este archivo fuente no los contiene de forma contigua.
const probeFrom = (table: string): string =>
  [".from(", '"', table, '"', ")"].join("");
const probeRpc = (name: string): string => [".rpc(", '"', name, '"', ")"].join("");
const probeStoreInsert = (): string =>
  [".from(", '"', "stores", '"', ").", "insert", "({"].join("");

const runGateOn = (
  caseKey: string,
  probe: string,
): { status: number | null; stdout: string; stderr: string } => {
  const fixtureDir = `${tmpRoot}/${caseKey}`;
  fs.mkdirSync(`${fixtureDir}/src`, { recursive: true });
  fs.writeFileSync(`${fixtureDir}/src/probe.ts`, `// probe\n${probe}\n`, "utf8");
  return cp.spawnSync(proc.execPath, [GATE_PATH], {
    cwd: fixtureDir,
    encoding: "utf8",
  });
};

// [descripción, clave única, contenido del probe, subcadena de la regla]
const forbiddenProbes: ReadonlyArray<[string, string, string, string]> = [
  ["la tabla diferida order_items", "tabla-order-items", probeFrom("order_items"), "tabla diferida: order_items"],
  [
    "la RPC diferida send_message",
    "rpc-send-message",
    probeRpc("send_message"),
    "RPC diferido: send_message",
  ],
  [
    "la cadena " + serviceRoleName,
    "service-role",
    serviceRoleName,
    serviceRoleName + " en el front",
  ],
  [
    "el literal " + searchVectorName,
    "search-vector",
    searchVectorName,
    searchVectorName + " (§S8-4)",
  ],
  ["un canal de realtime", "canal-realtime", "." + "channel" + "(", "canal de realtime"],
  ["INSERT directo sobre stores", "stores-insert", probeStoreInsert(), "STORE-1"],
];

describe("T-A3 · la gate sigue atrapando las reglas restantes (ADM-2.2/2.3)", () => {
  it("ya NO rechaza el probe de la tabla de auditoría: exit 0 con §S8 OK", () => {
    const result = runGateOn("audit-ok", probeFrom(auditTableName));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("§S8 OK");
  });

  it.each(forbiddenProbes)(
    "rechaza %s → exit 1 con la regla correspondiente",
    (_description, caseKey, probe, label) => {
      const result = runGateOn(caseKey, probe);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(label);
    },
  );
});
