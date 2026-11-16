import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import * as ordersApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { CreditsPage } from "./CreditsPage";

vi.mock("../api", () => ({
  cancelCredit: vi.fn(),
  fetchCredits: vi.fn(),
  fetchPayments: vi.fn(),
  registerPayment: vi.fn(),
  reversePayment: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <CreditsPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function openPaymentForm() {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole("button", { name: "Ver detalle" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("Monto"), "5000");
  return { user, dialog };
}

describe("CreditsPage: registrar pago", () => {
  beforeEach(() => {
    vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "operador", premium: true });
    vi.mocked(ordersApi.fetchCredits).mockResolvedValue({
      data: [
        {
          id: 1,
          order_id: 10,
          store_name: "Tienda Centro",
          total_amount: 20000,
          balance: 20000,
          status: "pending",
          due_date: null,
        },
      ],
      error: null,
    });
    vi.mocked(ordersApi.fetchPayments).mockResolvedValue({ data: [], error: null });
    vi.mocked(ordersApi.registerPayment).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("un doble clic mientras guarda registra un solo pago (auditoría S5)", async () => {
    let resolve: (value: { error: null }) => void = () => {};
    vi.mocked(ordersApi.registerPayment).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { user, dialog } = await openPaymentForm();

    const button = within(dialog).getByRole("button", { name: /registrar pago/i });
    await user.click(button);
    await user.click(button);

    expect(ordersApi.registerPayment).toHaveBeenCalledTimes(1);
    resolve({ error: null });
  });

  it("limpia el monto después de un pago exitoso", async () => {
    vi.mocked(ordersApi.registerPayment).mockResolvedValue({ error: null });
    const { user, dialog } = await openPaymentForm();

    await user.click(within(dialog).getByRole("button", { name: /registrar pago/i }));

    expect(await within(dialog).findByText("Pago registrado.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Monto")).toHaveValue(null);
  });
});

describe("CreditsPage: distribuidor acreedor (0054)", () => {
  beforeEach(() => {
    vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u3", email: "dist@farox.app" });
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "distribuidor", premium: false });
    vi.mocked(ordersApi.fetchCredits).mockResolvedValue({
      data: [
        {
          id: 1,
          order_id: 10,
          store_name: "Tienda Centro",
          total_amount: 20000,
          balance: 15000,
          status: "pending",
          due_date: null,
        },
      ],
      error: null,
    });
    vi.mocked(ordersApi.fetchPayments).mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("ve el saldo que le deben pero no puede registrar pagos", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Ver detalle" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getAllByText("$ 15.000").length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/la tienda registra los pagos/i)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Monto")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /registrar pago/i }),
    ).not.toBeInTheDocument();
  });
});
