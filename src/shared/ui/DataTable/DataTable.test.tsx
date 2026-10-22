import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DataTable, type DataTableColumn } from "./DataTable";

// sdd/admin-console T-B2: primitiva presentacional compartida (D-M1). Sin
// red, sin features — solo props puras. Los 4 estados son mutuamente
// excluyentes (D4: vacío ≠ error) y las acciones por fila son opcionales.
interface Fila {
  id: number;
  nombre: string;
  activo: boolean;
}

const FILAS: Fila[] = [
  { id: 1, nombre: "Tienda Centro", activo: true },
  { id: 2, nombre: "Tienda Norte", activo: false },
];

const COLUMNAS: DataTableColumn<Fila>[] = [
  { key: "nombre", header: "Nombre", render: (row) => row.nombre },
  {
    key: "estado",
    header: "Estado",
    render: (row) => (row.activo ? "Activo" : "Inactivo"),
  },
];

afterEach(() => {
  cleanup();
});

function renderTabla(props: Partial<Parameters<typeof DataTable<Fila>>[0]> = {}) {
  return render(
    <DataTable<Fila>
      columns={COLUMNAS}
      rows={FILAS}
      rowKey={(row) => String(row.id)}
      loading={false}
      error={null}
      emptyTitle="No hay nada todavía"
      {...props}
    />,
  );
}

describe("DataTable (sdd/admin-console T-B2 · D-M1)", () => {
  it("renderiza columnas y filas", () => {
    renderTabla();

    expect(screen.getByRole("columnheader", { name: "Nombre" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Estado" })).toBeInTheDocument();
    expect(screen.getByText("Tienda Centro")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(FILAS.length + 1); // + encabezado
  });

  it("loading: muestra «Cargando…» y NINGUNA fila ni estado vacío", () => {
    renderTabla({ loading: true });

    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("error: ErrorBanner con el mensaje YA mapeado — sin tabla ni vacío (HARD-1)", () => {
    renderTabla({ error: "No tenés permisos para esta operación." });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("No hay nada todavía")).not.toBeInTheDocument();
  });

  it("vacío sin error: EmptyState con el título provisto (vacío ≠ error, D4)", () => {
    renderTabla({ rows: [] });

    expect(screen.getByRole("status")).toHaveTextContent("No hay nada todavía");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("acciones por fila: opcionales y con callback por fila", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    renderTabla({
      actions: [
        {
          key: "baja",
          label: "Dar de baja",
          visible: (row) => row.activo,
          onClick,
        },
      ],
    });

    // Solo la fila activa ofrece la acción; la inactiva queda sin botón.
    const botones = screen.getAllByRole("button", { name: "Dar de baja" });
    expect(botones).toHaveLength(1);
    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();

    await user.click(botones[0]);
    expect(onClick).toHaveBeenCalledWith(FILAS[0]);
  });

  it("acción deshabilitada: copy voseo en title y cero invocaciones", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    renderTabla({
      rows: [{ id: 1, nombre: "Yo", activo: true }],
      actions: [
        {
          key: "baja",
          label: "Dar de baja",
          disabled: () => true,
          title: () => "No te podés desactivar a vos mismo.",
          onClick,
        },
      ],
    });

    const boton = screen.getByRole("button", { name: "Dar de baja" });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute("title", "No te podés desactivar a vos mismo.");

    await user.click(boton);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("footer: se renderiza bajo la tabla", () => {
    renderTabla({ footer: <p>Página 1 de 2</p> });

    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
