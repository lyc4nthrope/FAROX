import { describe, expect, it } from "vitest";

import { renderNotice, type NoticeKind } from "./notices";

const KINDS: NoticeKind[] = [
  "renewal_7",
  "renewal_3",
  "renewal_1",
  "grace_ending",
  "expired",
  "downgraded",
  "payment_failed",
  "cancellation",
];

describe("renderNotice", () => {
  it("genera asunto, HTML y texto para todos los avisos", () => {
    for (const kind of KINDS) {
      const rendered = renderNotice(kind, {
        name: "Ada Lovelace",
        appUrl: "https://farox.app/",
      });
      expect(rendered.subject.length).toBeGreaterThan(5);
      expect(rendered.html).toContain("Ada Lovelace");
      expect(rendered.html).toContain("https://farox.app/premium");
      expect(rendered.text).toContain("https://farox.app/premium");
    }
  });

  it("escapa el nombre en HTML y usa un saludo neutro si falta", () => {
    const rendered = renderNotice("expired", {
      name: '<script>alert("x")</script>',
      appUrl: "https://farox.app",
    });
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");

    const anonymous = renderNotice("grace_ending", { name: "   ", appUrl: "https://farox.app" });
    expect(anonymous.text.startsWith("Hola hola,")).toBe(true);
  });
});
