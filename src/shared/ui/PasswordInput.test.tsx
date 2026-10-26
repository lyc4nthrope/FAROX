import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PasswordInput } from "./PasswordInput";

function Harness({ error }: { error?: string }) {
  const [value, setValue] = useState("secreto123");
  return (
    <PasswordInput
      id="campo"
      label="Contraseña"
      autoComplete="current-password"
      value={value}
      onChange={setValue}
      revealName="contraseña"
      hint="Mínimo 6 caracteres."
      error={error}
    />
  );
}

describe("PasswordInput", () => {
  afterEach(() => {
    cleanup();
  });

  it("arranca oculto y permite mostrar y volver a ocultar la contraseña", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("Contraseña");
    expect(input).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(input).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Ocultar contraseña" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Ocultar contraseña" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("conecta la ayuda y el error con el input por aria-describedby", () => {
    render(<Harness error="La contraseña es obligatoria" />);
    const input = screen.getByLabelText("Contraseña");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "campo-hint campo-error");
    expect(screen.getByText("Mínimo 6 caracteres.")).toBeInTheDocument();
    expect(screen.getByText("La contraseña es obligatoria")).toBeInTheDocument();
  });
});
