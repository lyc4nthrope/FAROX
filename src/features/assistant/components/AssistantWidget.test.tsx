import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantWidget } from "./AssistantWidget";

vi.mock("./AssistantChat", () => ({
  AssistantChat: () => <p>chat del asistente</p>,
}));

function renderWidget(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AssistantWidget />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("AssistantWidget · burbuja flotante (0040)", () => {
  it("abre y cierra el chat desde la burbuja sin desmontar la conversación", async () => {
    renderWidget();
    const user = userEvent.setup();

    expect(screen.queryByRole("dialog", { name: "Asistente" })).not.toBeInTheDocument();
    expect(screen.getByText("chat del asistente")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));
    expect(await screen.findByRole("dialog", { name: "Asistente" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cerrar asistente" }));
    expect(screen.queryByRole("dialog", { name: "Asistente" })).not.toBeInTheDocument();
    expect(screen.getByText("chat del asistente")).toBeInTheDocument();
  });

  it("no aparece en /asistente, donde el chat ya es pantalla completa", () => {
    renderWidget("/asistente");
    expect(screen.queryByRole("button", { name: "Abrir asistente" })).not.toBeInTheDocument();
  });
});
