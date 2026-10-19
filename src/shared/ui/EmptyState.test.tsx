import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EmptyState } from "./EmptyState";

afterEach(cleanup);

describe("EmptyState (D4: vacío ≠ error)", () => {
  it("renderiza título y sugerencia como estado de listado, no como alerta", () => {
    render(
      <EmptyState
        title="No hay distribuidores todavía"
        hint="Creá el primero desde el botón nuevo."
      />,
    );
    expect(screen.getByText("No hay distribuidores todavía")).toBeInTheDocument();
    expect(screen.getByText("Creá el primero desde el botón nuevo.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("la sugerencia es opcional", () => {
    render(<EmptyState title="Sin tiendas" />);
    expect(screen.getByText("Sin tiendas")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
