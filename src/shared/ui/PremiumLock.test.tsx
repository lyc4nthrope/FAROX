import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { PremiumLock } from "./PremiumLock";

describe("PremiumLock", () => {
  afterEach(() => cleanup());

  it("muestra el candado, la etiqueta Premium y lo que desbloquea", () => {
    render(
      <MemoryRouter>
        <PremiumLock
          title="Dashboard analítico"
          benefits={["Entradas por día.", "Totales del rango."]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("img", { name: "Bloqueado" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboard analítico" })).toBeInTheDocument();
    expect(screen.getByText("Premium")).toBeInTheDocument();
    expect(screen.getByText("Entradas por día.")).toBeInTheDocument();
    expect(screen.getByText("Totales del rango.")).toBeInTheDocument();
    expect(screen.getByText(/Un administrador activa Premium/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver planes" })).toHaveAttribute("href", "/premium");
  });

  it("deja ver la UI real pero la inutiliza", () => {
    render(
      <MemoryRouter>
        <PremiumLock title="Registrar entrada o salida" benefits={["Movimientos manuales."]}>
          <label>
            Cantidad
            <input defaultValue="3" />
          </label>
          <button type="button">Registrar</button>
        </PremiumLock>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Cantidad")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Registrar" })).toBeDisabled();
  });

  it("la vista previa es decorativa y queda fuera del árbol accesible", () => {
    const { container } = render(
      <MemoryRouter>
        <PremiumLock
          title="QR masivo"
          benefits={["Varios códigos a la vez."]}
          preview={<p>Vista de ejemplo</p>}
        />
      </MemoryRouter>,
    );

    const preview = container.querySelector('div[aria-hidden="true"]');
    expect(preview).not.toBeNull();
    expect(preview).toContainElement(screen.getByText("Vista de ejemplo"));
  });
});
