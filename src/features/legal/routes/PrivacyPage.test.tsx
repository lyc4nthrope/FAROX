import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { PRIVACY_VERSION } from "..";
import { PRIVACY_SECTIONS } from "../privacyContent";
import { PrivacyPage } from "./PrivacyPage";

// Página de la política: ruta PÚBLICA (el router no la cubre acá — la
// accesibilidad sin sesión se prueba en app/router.test.tsx). Acá se verifica
// el CONTENIDO: aviso de borrador, versión y, sobre todo, la divulgación de
// los terceros reales que la app usa (ipwho.is, Nominatim, OSM, CARTO,
// Supabase) — requisito legal del documento.
function renderPrivacy() {
  return render(
    <MemoryRouter initialEntries={["/privacidad"]}>
      <PrivacyPage />
    </MemoryRouter>,
  );
}

describe("PrivacyPage (ruta pública /privacidad)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renderiza el título, la versión vigente y el aviso de BORRADOR", () => {
    renderPrivacy();
    expect(
      screen.getByRole("heading", { name: "Política de Privacidad" }),
    ).toBeInTheDocument();
    expect(screen.getByText(`Versión vigente: ${PRIVACY_VERSION}`)).toBeInTheDocument();
    expect(
      screen.getByText("BORRADOR — requiere revisión legal antes de publicar"),
    ).toBeInTheDocument();
  });

  it("declara los terceros reales: ipwho.is recibe la IP y Nominatim recibe las coordenadas", () => {
    renderPrivacy();
    // Negrita del nombre = elemento propio (el <li> empieza con ": "),
    // así que cada match es único.
    expect(screen.getByText(/^ipwho\.is/)).toBeInTheDocument();
    expect(screen.getByText(/^Nominatim/)).toBeInTheDocument();
    expect(screen.getByText(/^Supabase/)).toBeInTheDocument();
    expect(screen.getByText(/^OpenStreetMap/)).toBeInTheDocument();
    expect(screen.getByText(/^CARTO/)).toBeInTheDocument();
    // Sustantivo legal, no solo el dominio: la transferencia se explica.
    // (Varios terceros mencionan la IP ⇒ getAllByText, no getByText.)
    expect(screen.getAllByText(/dirección IP/).length).toBeGreaterThan(0);
    expect(screen.getByText(/coordenadas exactas de la tienda/)).toBeInTheDocument();
  });

  it("cubre la Ley 1581 de 2012, la SIC y los placeholders del responsable", () => {
    renderPrivacy();
    expect(screen.getByText(/Ley Estatutaria 1581 de 2012/)).toBeInTheDocument();
    expect(screen.getByText(/Superintendencia de Industria y Comercio/)).toBeInTheDocument();
    // El placeholder del contacto aparece en DOS sitios (responsable +
    // cómo ejercer derechos) ⇒ getAllByText, no getByText.
    expect(screen.getAllByText(/\{\{EMAIL_DE_CONTACTO\}\}/).length).toBeGreaterThanOrEqual(2);
  });

  it("las secciones del contenido tienen ids únicos e incluyen terceros y derechos", () => {
    const ids = PRIVACY_SECTIONS.map((section) => section.id);
    expect(ids).toContain("terceros");
    expect(ids).toContain("derechos");
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of PRIVACY_SECTIONS) {
      expect(section.title.length, `sección ${section.id}`).toBeGreaterThan(0);
      expect(section.blocks.length, `sección ${section.id}`).toBeGreaterThan(0);
    }
  });

  it("PRIVACY_VERSION se exporta del slice legal como string no vacío", () => {
    expect(typeof PRIVACY_VERSION).toBe("string");
    expect(PRIVACY_VERSION.length).toBeGreaterThan(0);
  });
});
