import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarginCard } from "./MarginCard";

afterEach(cleanup);

function setup(
  initial: number | null = null,
  onSave = vi.fn<(margin: number | null) => Promise<string | null>>().mockResolvedValue(null),
) {
  render(<MarginCard initial={initial} onSave={onSave} />);
  return { onSave };
}

describe("MarginCard · margen sobre el costo (0045)", () => {
  it("avisa que el porcentaje no incluye impuestos ni otros costos", () => {
    setup();
    expect(screen.getByText(/no incluye impuestos/i)).toBeInTheDocument();
  });

  it("muestra el ejemplo de 10.000 con el porcentaje escrito", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText("Ganancia sobre el costo (%)"), "50");

    expect(screen.getByText(/vendés a/)).toHaveTextContent(/15\.000/);
  });

  it("guarda el margen redondeado a dos decimales", async () => {
    const user = userEvent.setup();
    const { onSave } = setup(13.337);

    await user.click(screen.getByRole("button", { name: "Guardar margen" }));

    expect(onSave).toHaveBeenCalledWith(13.34);
  });

  it("acepta 1000 sin desbordar la columna", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();

    await user.type(screen.getByLabelText("Ganancia sobre el costo (%)"), "1000");
    await user.click(screen.getByRole("button", { name: "Guardar margen" }));

    expect(onSave).toHaveBeenCalledWith(1000);
  });

  it("rechaza más de 1000 sin llamar al guardado", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();

    await user.type(screen.getByLabelText("Ganancia sobre el costo (%)"), "1000.01");
    await user.click(screen.getByRole("button", { name: "Guardar margen" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/entre 0 y 1000/);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("vacío guarda null (quita el margen)", async () => {
    const user = userEvent.setup();
    const { onSave } = setup(50);

    await user.clear(screen.getByLabelText("Ganancia sobre el costo (%)"));
    await user.click(screen.getByRole("button", { name: "Guardar margen" }));

    expect(onSave).toHaveBeenCalledWith(null);
  });
});
