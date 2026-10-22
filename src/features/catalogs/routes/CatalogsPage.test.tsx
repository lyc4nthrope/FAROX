import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { CatalogsPage } from "./CatalogsPage";

// sdd/admin-console T-C5 (ADM-9.1 rutas / ADM-12.1): índice liviano del
// motor — SIN api y SIN queries: solo los 4 links hacia las pantallas
// config-driven (design key-decision #4). Por eso este test NO mockea
// ningún módulo api (no hay red posible).
function renderPagina() {
  return render(
    <MemoryRouter initialEntries={["/catalogs"]}>
      <CatalogsPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("CatalogsPage — índice /catalogs con las 4 pantallas del motor", () => {
  it("pinta el título y los 4 links hacia /catalogs/:catalogKey", async () => {
    renderPagina();

    expect(
      await screen.findByRole("heading", { name: "Catálogos" }),
    ).toBeInTheDocument();
    const esperados: Array<[string, string]> = [
      ["Tipos de unidad", "/catalogs/unit_types"],
      ["Tipos de tienda", "/catalogs/store_types"],
      ["Marcas", "/catalogs/brands"],
      ["Categorías de producto", "/catalogs/product_categories"],
    ];
    for (const [nombre, href] of esperados) {
      expect(
        screen.getByRole("link", { name: nombre }),
      ).toHaveAttribute("href", href);
    }
  });

  it("el índice no ofrece controles de escritura (es solo navegación)", () => {
    renderPagina();

    expect(screen.queryByRole("button")).toBeNull();
  });
});
