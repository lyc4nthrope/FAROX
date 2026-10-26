import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Modal } from "./Modal";

describe("Modal", () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });

  it("expone un diálogo modal con su título", () => {
    render(
      <Modal title="Agregar productos" onClose={() => undefined}>
        <p>contenido</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Agregar productos" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("contenido")).toBeInTheDocument();
  });

  it("Escape y el botón Cerrar llaman a onClose", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Agregar productos" onClose={onClose}>
        <p>contenido</p>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("el fondo cierra; el contenido no", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Agregar productos" onClose={onClose}>
        <p>contenido</p>
      </Modal>,
    );

    fireEvent.mouseDown(screen.getByText("contenido"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("bloquea el scroll del body mientras está abierto y devuelve el foco al cerrar", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    const { unmount } = render(
      <Modal title="Agregar productos" onClose={() => undefined}>
        <p>contenido</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("dialog")).toHaveFocus();

    unmount();
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
