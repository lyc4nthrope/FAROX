import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as usersApi from "../../users/api";
import type { UserListRow } from "../../users/types";
import * as storesApi from "../api";
import { TransferStorePanel } from "./TransferStorePanel";

vi.mock("../../users/api", () => ({
  fetchUsers: vi.fn(),
}));
vi.mock("../api", () => ({
  transferStore: vi.fn(),
}));

const USERS: UserListRow[] = [
  {
    id: "u1",
    email: "owner@farox.app",
    full_name: "Dueño Actual",
    premium: true,
    is_active: true,
    role_name: "operador",
    store_count: 1,
  },
  {
    id: "u2",
    email: "nuevo@farox.app",
    full_name: "Nuevo Dueño",
    premium: false,
    is_active: true,
    role_name: "operador",
    store_count: 0,
  },
  {
    id: "u3",
    email: "inactivo@farox.app",
    full_name: "Inactivo",
    premium: false,
    is_active: false,
    role_name: "operador",
    store_count: 0,
  },
  {
    id: "u4",
    email: "dist@farox.app",
    full_name: "Distribuidor",
    premium: false,
    is_active: true,
    role_name: "distribuidor",
    store_count: 0,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(usersApi.fetchUsers).mockResolvedValue({ rows: USERS, count: 4, error: null });
  vi.mocked(storesApi.transferStore).mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TransferStorePanel (0034)", () => {
  it("solo ofrece operadores/admin activos distintos del dueño y transfiere", async () => {
    const user = userEvent.setup();
    const onTransferred = vi.fn();
    render(
      <TransferStorePanel
        storeId={7}
        currentOwnerId="u1"
        onTransferred={onTransferred}
      />,
    );

    const select = await screen.findByLabelText("Nuevo dueño");
    expect(screen.queryByRole("option", { name: /Dueño Actual/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Inactivo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Distribuidor/ })).not.toBeInTheDocument();
    await user.selectOptions(select, "u2");
    await user.click(screen.getByRole("button", { name: "Transferir tienda" }));

    await waitFor(() => expect(storesApi.transferStore).toHaveBeenCalledWith(7, "u2"));
    expect(onTransferred).toHaveBeenCalled();
  });
});
