import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantAction } from "../api";
import { cancelAction, executeAction } from "../api";
import { PendingActionCard } from "./PendingActionCard";

vi.mock("../api", () => ({
  executeAction: vi.fn(),
  cancelAction: vi.fn(),
}));

const EXPIRES = new Date(Date.now() + 600_000).toISOString();

function action(overrides: Partial<AssistantAction> = {}): AssistantAction {
  return {
    action_id: 7,
    expires_at: EXPIRES,
    summary: {
      kind: "store_exit",
      store: "Tienda Centro",
      lines: [{ name: "Arroz", qty: 2, unit_price: 4500 }],
      discount: 0,
      total: 9000,
    },
    ...overrides,
  };
}

describe("PendingActionCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("muestra el resumen y confirma la operación normal", async () => {
    vi.mocked(executeAction).mockResolvedValue({
      data: { ok: true, count: 1 },
      error: null,
    });
    const user = userEvent.setup();
    render(<PendingActionCard action={action()} />);

    expect(screen.getByText("Salida de tienda")).toBeInTheDocument();
    expect(screen.getByText(/Arroz/)).toBeInTheDocument();
    expect(screen.getByText(/Total:/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(executeAction).toHaveBeenCalledWith(7, undefined);
    expect(await screen.findByText(/Registrado/)).toBeInTheDocument();
  });

  it("exige escribir CONFIRMAR para un cambio de precio", async () => {
    vi.mocked(executeAction).mockResolvedValue({
      data: { ok: true, count: 1 },
      error: null,
    });
    const user = userEvent.setup();
    render(
      <PendingActionCard
        action={action({
          action_id: 9,
          requires_strong_confirmation: true,
          summary: {
            kind: "price_update",
            scope: "store",
            store: "Tienda Centro",
            lines: [
              {
                product: "Arroz",
                old_purchase: 3000,
                new_purchase: 3000,
                old_sale: 4500,
                new_sale: 5000,
              },
            ],
          },
        })}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Confirmar" });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText("Confirmación fuerte"), "CONFIRMAR");
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(executeAction).toHaveBeenCalledWith(9, "CONFIRMAR");
  });

  it("traduce un borrador vencido", async () => {
    vi.mocked(executeAction).mockResolvedValue({
      data: { ok: false, error: "expired" },
      error: null,
    });
    const user = userEvent.setup();
    render(<PendingActionCard action={action()} />);

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText(/venció/)).toBeInTheDocument();
  });

  it("traduce el error de negocio y no muestra SQL crudo", async () => {
    vi.mocked(executeAction).mockResolvedValue({
      data: { ok: false, error: "register_exit: stock insuficiente" },
      error: null,
    });
    const user = userEvent.setup();
    render(<PendingActionCard action={action()} />);

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText("No hay stock suficiente para esa salida."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/register_exit/)).not.toBeInTheDocument();
  });

  it("no ejecuta dos veces con doble click", async () => {
    let resolveExecute: () => void = () => {};
    vi.mocked(executeAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExecute = () => resolve({ data: { ok: true, count: 1 }, error: null });
        }),
    );
    render(<PendingActionCard action={action()} />);
    const confirm = screen.getByRole("button", { name: "Confirmar" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(executeAction).toHaveBeenCalledTimes(1);

    resolveExecute();
    expect(await screen.findByText(/Registrado/)).toBeInTheDocument();
  });

  it("cancela el borrador sin ejecutarlo", async () => {
    vi.mocked(cancelAction).mockResolvedValue({
      data: { ok: true },
      error: null,
    });
    const user = userEvent.setup();
    render(<PendingActionCard action={action()} />);

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(cancelAction).toHaveBeenCalledWith(7);
    expect(await screen.findByText("Cancelado.")).toBeInTheDocument();
    expect(executeAction).not.toHaveBeenCalled();
  });
});
