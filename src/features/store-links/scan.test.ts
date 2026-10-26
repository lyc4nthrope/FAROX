import { describe, expect, it } from "vitest";

import { parseLinkCode } from "./scan";

const CODE = "0123456789abcdef01";

describe("parseLinkCode", () => {
  it("acepta el código crudo y lo normaliza a minúsculas", () => {
    expect(parseLinkCode(`  ${CODE.toUpperCase()}  `)).toBe(CODE);
  });

  it("acepta una URL de la propia app con /vincular/<code>", () => {
    expect(parseLinkCode(`${window.location.origin}/vincular/${CODE}`)).toBe(CODE);
  });

  it("rechaza URLs de otro origen", () => {
    expect(parseLinkCode(`https://evil.example/vincular/${CODE}`)).toBeNull();
  });

  it("rechaza rutas y códigos que no son de vínculo", () => {
    expect(parseLinkCode(`${window.location.origin}/otra/${CODE}`)).toBeNull();
    expect(parseLinkCode("123")).toBeNull();
    expect(parseLinkCode("no-es-un-codigo")).toBeNull();
    expect(parseLinkCode("")).toBeNull();
  });
});
