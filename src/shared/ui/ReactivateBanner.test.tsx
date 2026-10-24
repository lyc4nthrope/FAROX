import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReactivateBanner } from "./ReactivateBanner";

const state = { role: "admin", isActive: false, updated: [] as unknown[] };

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({ role: state.role }),
}));

vi.mock("../lib/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.update = (values: unknown) => {
    state.updated.push(values);
    return {
      eq: () => ({
        select: () => {
          state.isActive = true;
          return Promise.resolve({ data: [{ id: 1 }], error: null });
        },
      }),
    };
  };
  chain.maybeSingle = () => Promise.resolve({ data: { is_active: state.isActive }, error: null });
  return { supabase: { from: () => chain } };
});

beforeEach(() => {
  state.role = "admin";
  state.isActive = false;
  state.updated = [];
});

describe("ReactivateBanner (C0.2)", () => {
  it("admin ve el aviso de inactivo y al reactivar envía is_active = true", async () => {
    const user = userEvent.setup();
    render(<ReactivateBanner table="products" id={1} />);
    await user.click(await screen.findByRole("button", { name: "Reactivar" }));
    expect(state.updated).toEqual([{ is_active: true }]);
    expect(await screen.findByText("Registro reactivado.")).toBeInTheDocument();
  });

  it("un operador ve el aviso pero no el botón", async () => {
    state.role = "operador";
    render(<ReactivateBanner table="products" id={1} />);
    expect(await screen.findByText(/inactivo/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reactivar" })).toBeNull();
  });

  it("si el registro está activo no muestra nada", async () => {
    state.isActive = true;
    const { container } = render(<ReactivateBanner table="stores" id={2} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
