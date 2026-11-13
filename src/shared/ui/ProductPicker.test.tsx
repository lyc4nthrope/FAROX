import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductPicker, type ProductPickerOption } from "./ProductPicker";

const OPTIONS: ProductPickerOption[] = [
  { id: 1, name: "Arroz Diana", brand: "Diana", quantity: 12 },
  { id: 2, name: "Aceite Girasol", brand: "Premier", quantity: 0 },
  { id: 3, name: "Leche Entera", brand: "Alpina", quantity: 30, price: 4500 },
];

const NO_PRICE: ProductPickerOption[] = [
  { id: 4, name: "Producto sin precio", price: null, disabled: true },
];

function renderPicker(props: Partial<ComponentProps<typeof ProductPicker>> = {}) {
  return render(
    <ProductPicker
      label="Producto"
      value=""
      onChange={vi.fn()}
      options={OPTIONS}
      showQuantityFilter
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("ProductPicker · búsqueda por nombre, marca y cantidad", () => {
  it("filtra por nombre", async () => {
    renderPicker();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Buscar producto"), "arroz");

    expect(screen.getByRole("option", { name: /Arroz Diana/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Aceite Girasol/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Leche Entera/ })).not.toBeInTheDocument();
  });

  it("filtra por marca", async () => {
    renderPicker();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Buscar producto"), "premier");

    expect(screen.getByRole("option", { name: /Aceite Girasol/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Arroz Diana/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Leche Entera/ })).not.toBeInTheDocument();
  });

  it("filtra por cantidad mínima en stock", async () => {
    renderPicker();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Cantidad mínima en stock"), "20");

    expect(screen.getByRole("option", { name: /Leche Entera/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Arroz Diana/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Aceite Girasol/ })).not.toBeInTheDocument();
  });

  it("combina búsqueda y cantidad, y avisa cuando no hay coincidencias", async () => {
    renderPicker();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Buscar producto"), "premier");
    await user.type(screen.getByLabelText("Cantidad mínima en stock"), "1");

    expect(screen.getByText("Sin coincidencias")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Aceite Girasol/ })).not.toBeInTheDocument();
  });

  it("mantiene visible el producto seleccionado aunque no coincida con el filtro", async () => {
    renderPicker({ value: "1" });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Buscar producto"), "aceite");

    expect(screen.getByRole("option", { name: /Arroz Diana/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Aceite Girasol/ })).toBeInTheDocument();
  });

  it("limpia los filtros y muestra el total", async () => {
    renderPicker();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Buscar producto"), "arroz");
    expect(screen.queryByRole("option", { name: /Leche Entera/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));

    expect(screen.getByRole("option", { name: /Leche Entera/ })).toBeInTheDocument();
  });

  it("muestra marca, stock y precio en la opción", () => {
    renderPicker();

    const option = screen.getByRole("option", { name: /Leche Entera/ });
    expect(option).toHaveTextContent("Alpina");
    expect(option).toHaveTextContent("Stock: 30");
    expect(option).toHaveTextContent("4.500");
  });

  it("deshabilita y explica las opciones sin precio", () => {
    renderPicker({ options: NO_PRICE });

    expect(screen.getByRole("option", { name: "Producto sin precio (sin precio)" })).toBeDisabled();
  });

  it("Enter en el buscador no envía el formulario que lo contiene", async () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ProductPicker
          label="Producto"
          value=""
          onChange={vi.fn()}
          options={OPTIONS}
          showQuantityFilter
        />
      </form>,
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Buscar producto"), "arroz{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
