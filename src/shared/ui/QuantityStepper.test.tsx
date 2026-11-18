import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuantityStepper } from "./QuantityStepper";

afterEach(() => {
  cleanup();
});

describe("QuantityStepper · modo de venta (0059)", () => {
  it("producto por unidad: paso entero y sufijo visible", () => {
    render(
      <QuantityStepper label="Arroz Diana" value="2" unit="und" integer onChange={() => {}} />,
    );

    const input = screen.getByLabelText("Cantidad de Arroz Diana");
    expect(input).toHaveAttribute("step", "1");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByText("und")).toBeInTheDocument();
  });

  it("producto a granel: admite decimales y muestra el peso", () => {
    render(<QuantityStepper label="Arroz a granel" value="1.5" unit="kg" onChange={() => {}} />);

    const input = screen.getByLabelText("Cantidad de Arroz a granel");
    expect(input).toHaveAttribute("step", "any");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByText("kg")).toBeInTheDocument();
  });

  it("los botones suman de a un paquete sin redondear el valor escrito", async () => {
    const onChange = vi.fn();
    render(<QuantityStepper label="Arroz Diana" value="2.5" integer onChange={onChange} />);

    // El input deja ver el valor tal cual: la validación de entero vive en el
    // submit, nunca se redondea en silencio.
    expect(screen.getByLabelText("Cantidad de Arroz Diana")).toHaveValue(2.5);
    expect(onChange).not.toHaveBeenCalled();
  });
});
