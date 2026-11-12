import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BulkPriceEditor,
  parsePriceInput,
  suggestedSalePrice,
  type BulkPriceLine,
  type BulkPriceProduct,
} from "./BulkPriceEditor";

const PRODUCTS: readonly BulkPriceProduct[] = [
  { id: 1, name: "Arroz Diana", brand: "Diana" },
  { id: 2, name: "Leche Alpina", brand: "Alpina" },
  { id: 3, name: "Pan tajado", brand: null },
];

afterEach(cleanup);

function setup({
  purchase = new Map<number, number>(),
  sale = new Map<number, number>(),
  marginPct = null,
  marginOverrides = new Map<number, number>(),
  onSave = vi
    .fn<(lines: readonly BulkPriceLine[]) => Promise<string | null>>()
    .mockResolvedValue(null),
}: {
  purchase?: Map<number, number>;
  sale?: Map<number, number>;
  marginPct?: number | null;
  marginOverrides?: Map<number, number>;
  onSave?: ReturnType<typeof vi.fn>;
} = {}) {
  render(
    <BulkPriceEditor
      products={PRODUCTS}
      purchasePrices={purchase}
      salePrices={sale}
      marginPct={marginPct}
      marginOverrides={marginOverrides}
      onSave={onSave as (lines: readonly BulkPriceLine[]) => Promise<string | null>}
    />,
  );
  return { onSave };
}

async function showAll(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const filter = screen.getByRole<HTMLInputElement>("checkbox", { name: /solo sin precio/i });
  if (filter.checked) await user.click(filter);
}

describe("BulkPriceEditor · tabla de precios", () => {
  it("muestra los precios actuales y cuenta los que no tienen venta", async () => {
    const user = userEvent.setup();
    setup({
      purchase: new Map([[1, 1200]]),
      sale: new Map([[2, 3000]]),
    });

    expect(screen.getByText("2 de 3 productos sin precio de venta.")).toBeInTheDocument();

    await showAll(user);
    expect(screen.getByLabelText("Precio de compra de Arroz Diana")).toHaveValue("1200");
    expect(screen.getByLabelText("Precio de venta de Leche Alpina")).toHaveValue("3000");
  });

  it("«solo sin precio» viene activo y oculta los que ya tienen venta", () => {
    setup({
      purchase: new Map([[1, 1200]]),
      sale: new Map([[2, 3000]]),
    });

    const table = screen.getByRole("table");
    expect(within(table).getByText("Arroz Diana")).toBeInTheDocument();
    expect(within(table).getByText("Pan tajado")).toBeInTheDocument();
    expect(within(table).queryByText("Leche Alpina")).not.toBeInTheDocument();
  });

  it("sin productos sin venta, el filtro viene apagado y se ven todos", () => {
    setup({
      sale: new Map([
        [1, 2000],
        [2, 3000],
        [3, 1500],
      ]),
    });

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(screen.getByText("0 de 3 productos sin precio de venta.")).toBeInTheDocument();
  });
});

describe("BulkPriceEditor · guardado", () => {
  it("no habilita el guardado si no hay cambios", () => {
    setup({ sale: new Map([[1, 2000]]) });

    expect(screen.getByRole("button", { name: /guardar cambios \(0\)/i })).toBeDisabled();
  });

  it("solo escribe la columna que el usuario tocó (la compra queda intacta)", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({
      purchase: new Map([[2, 1800]]),
      sale: new Map([
        [1, 2000],
        [2, 3000],
      ]),
    });

    await showAll(user);
    const sale = screen.getByLabelText("Precio de venta de Leche Alpina");
    await user.clear(sale);
    await user.type(sale, "3200");
    await user.click(screen.getByRole("button", { name: /guardar cambios \(1\)/i }));

    expect(onSave).toHaveBeenCalledWith([
      {
        productId: 2,
        purchasePrice: null,
        salePrice: 3200,
        writePurchase: false,
        writeSale: true,
      },
    ]);
    expect(await screen.findByText("1 producto guardado.")).toBeInTheDocument();
  });

  it("editar solo la compra no toca la venta", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({
      purchase: new Map([[1, 1000]]),
      sale: new Map([[1, 2000]]),
    });

    await showAll(user);
    const purchase = screen.getByLabelText("Precio de compra de Arroz Diana");
    await user.clear(purchase);
    await user.type(purchase, "1100");
    await user.click(screen.getByRole("button", { name: /guardar cambios \(1\)/i }));

    expect(onSave).toHaveBeenCalledWith([
      {
        productId: 1,
        purchasePrice: 1100,
        salePrice: null,
        writePurchase: true,
        writeSale: false,
      },
    ]);
  });

  it("vaciar un precio envía null (borra el precio)", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ sale: new Map([[1, 2000]]) });

    await showAll(user);
    await user.clear(screen.getByLabelText("Precio de venta de Arroz Diana"));
    await user.click(screen.getByRole("button", { name: /guardar cambios \(1\)/i }));

    expect(onSave).toHaveBeenCalledWith([
      {
        productId: 1,
        purchasePrice: null,
        salePrice: null,
        writePurchase: false,
        writeSale: true,
      },
    ]);
  });

  it("rechaza puntos de miles con un mensaje claro y no guarda", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ sale: new Map([[1, 2000]]) });

    await showAll(user);
    const sale = screen.getByLabelText("Precio de venta de Arroz Diana");
    await user.clear(sale);
    await user.type(sale, "2.500");
    await user.click(screen.getByRole("button", { name: /guardar cambios \(1\)/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/sin puntos de miles/i);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("muestra el error que devuelve el guardado y no marca la tabla como limpia", async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn<(lines: readonly BulkPriceLine[]) => Promise<string | null>>()
      .mockResolvedValue("No se pudo guardar.");
    setup({ sale: new Map([[1, 2000]]), onSave });

    await showAll(user);
    const sale = screen.getByLabelText("Precio de venta de Arroz Diana");
    await user.clear(sale);
    await user.type(sale, "2100");
    await user.click(screen.getByRole("button", { name: /guardar cambios \(1\)/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar.");
    expect(screen.getByRole("button", { name: /guardar cambios \(1\)/i })).toBeEnabled();
  });
});

describe("BulkPriceEditor · pegar desde Excel", () => {
  it("pega una columna y llena hacia abajo en el orden visible", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({
      sale: new Map([
        [1, 2000],
        [2, 3000],
        [3, 1500],
      ]),
    });

    const first = screen.getByLabelText("Precio de venta de Arroz Diana");
    await user.click(first);
    await user.paste("2100\n2200\n2300");

    const table = screen.getByRole("table");
    expect(within(table).getAllByLabelText(/Precio de venta de/)[0]).toHaveValue("2100");
    expect(within(table).getAllByLabelText(/Precio de venta de/)[1]).toHaveValue("2200");
    expect(within(table).getAllByLabelText(/Precio de venta de/)[2]).toHaveValue("2300");

    await user.click(screen.getByRole("button", { name: /guardar cambios \(3\)/i }));
    expect(onSave).toHaveBeenCalledWith([
      { productId: 1, purchasePrice: null, salePrice: 2100, writePurchase: false, writeSale: true },
      { productId: 2, purchasePrice: null, salePrice: 2200, writePurchase: false, writeSale: true },
      { productId: 3, purchasePrice: null, salePrice: 2300, writePurchase: false, writeSale: true },
    ]);
  });

  it("una celda vacía en medio conserva la alineación (no corre los precios)", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({
      sale: new Map([
        [1, 2000],
        [2, 3000],
        [3, 1500],
      ]),
    });

    const first = screen.getByLabelText("Precio de venta de Arroz Diana");
    await user.click(first);
    await user.paste("2100\n\n2300");

    const table = screen.getByRole("table");
    expect(within(table).getAllByLabelText(/Precio de venta de/)[0]).toHaveValue("2100");
    expect(within(table).getAllByLabelText(/Precio de venta de/)[1]).toHaveValue("3000");
    expect(within(table).getAllByLabelText(/Precio de venta de/)[2]).toHaveValue("2300");
    expect(await screen.findByRole("status")).toHaveTextContent("1 celda vacía se dejó igual");

    await user.click(screen.getByRole("button", { name: /guardar cambios \(2\)/i }));
    expect(onSave).toHaveBeenCalledWith([
      { productId: 1, purchasePrice: null, salePrice: 2100, writePurchase: false, writeSale: true },
      { productId: 3, purchasePrice: null, salePrice: 2300, writePurchase: false, writeSale: true },
    ]);
  });

  it("no pega una columna que trae un valor inválido", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({
      sale: new Map([
        [1, 2000],
        [2, 3000],
      ]),
    });

    await showAll(user);
    const first = screen.getByLabelText("Precio de venta de Arroz Diana");
    await user.click(first);
    await user.paste("2100\n2.500");

    expect(await screen.findByRole("alert")).toHaveTextContent(/no pude leer/i);
    expect(screen.getByLabelText("Precio de venta de Arroz Diana")).toHaveValue("2000");
    await user.click(screen.getByRole("button", { name: /guardar cambios \(0\)/i }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("un valor pegado normal (sin saltos de línea) no se intercepta", async () => {
    const user = userEvent.setup();
    setup({ sale: new Map([[1, 2000]]) });

    await showAll(user);
    const sale = screen.getByLabelText("Precio de venta de Arroz Diana");
    await user.clear(sale);
    await user.click(sale);
    await user.paste("2500");

    expect(sale).toHaveValue("2500");
    expect(screen.queryByText(/pegué/i)).not.toBeInTheDocument();
  });

  it("avisa cuando sobran valores para las filas visibles", async () => {
    const user = userEvent.setup();
    setup({
      sale: new Map([
        [1, 2000],
        [2, 3000],
        [3, 1500],
      ]),
    });

    const last = screen.getByLabelText("Precio de venta de Pan tajado");
    await user.click(last);
    await user.paste("2100\n2200");

    expect(await screen.findByRole("status")).toHaveTextContent("sobraron 1");
  });
});

describe("BulkPriceEditor · margen (0045)", () => {
  it("aplica el margen solo a filas con costo y sin precio de venta", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({
      purchase: new Map([
        [1, 1000],
        [2, 2000],
      ]),
      sale: new Map([[2, 3000]]),
      marginPct: 50,
    });

    // El filtro inicial deja visibles 1 (sin venta) y 3 (sin costo).
    await user.click(screen.getByRole("button", { name: "Aplicar margen (50%)" }));

    expect(screen.getByLabelText("Precio de venta de Arroz Diana")).toHaveValue("1500");
    expect(screen.getByLabelText("Precio de venta de Pan tajado")).toHaveValue("");
    expect(await screen.findByRole("status")).toHaveTextContent("Apliqué el margen a 1 producto.");

    await user.click(screen.getByRole("button", { name: /guardar cambios \(1\)/i }));
    expect(onSave).toHaveBeenCalledWith([
      {
        productId: 1,
        purchasePrice: null,
        salePrice: 1500,
        writePurchase: false,
        writeSale: true,
      },
    ]);
  });

  it("nunca completa una venta que ya existe", async () => {
    const user = userEvent.setup();
    setup({
      purchase: new Map([[1, 1000]]),
      sale: new Map([
        [1, 9000],
        [2, 3000],
        [3, 1500],
      ]),
      marginPct: 50,
    });

    await user.click(screen.getByRole("button", { name: "Aplicar margen (50%)" }));

    expect(screen.getByLabelText("Precio de venta de Arroz Diana")).toHaveValue("9000");
  });

  it("redondea el precio sugerido al peso", async () => {
    const user = userEvent.setup();
    setup({ purchase: new Map([[1, 3333]]), marginPct: 50 });

    await user.click(screen.getByRole("button", { name: "Aplicar margen (50%)" }));

    expect(screen.getByLabelText("Precio de venta de Arroz Diana")).toHaveValue("5000");
  });

  it("coincide con el servidor en los bordes .5", async () => {
    const user = userEvent.setup();
    setup({ purchase: new Map([[1, 1250]]), marginPct: 13 });

    await user.click(screen.getByRole("button", { name: "Aplicar margen (13%)" }));

    // El servidor publica round(1250 * 1.13, 0) = 1413; Math.round daría 1412.
    expect(screen.getByLabelText("Precio de venta de Arroz Diana")).toHaveValue("1413");
  });

  it("solo completa las filas visibles con el buscador activo", async () => {
    const user = userEvent.setup();
    setup({
      purchase: new Map([
        [1, 1000],
        [2, 2000],
        [3, 1500],
      ]),
      marginPct: 50,
    });

    const search = screen.getByLabelText("Buscar producto para cargar precios");
    await user.type(search, "arroz");
    await user.click(screen.getByRole("button", { name: "Aplicar margen (50%)" }));

    expect(screen.getByLabelText("Precio de venta de Arroz Diana")).toHaveValue("1500");
    await user.clear(search);
    expect(screen.getByLabelText("Precio de venta de Leche Alpina")).toHaveValue("");
    expect(screen.getByLabelText("Precio de venta de Pan tajado")).toHaveValue("");
  });

  it("sin margen configurado no muestra la acción", () => {
    setup({ purchase: new Map([[1, 1000]]) });
    expect(screen.queryByRole("button", { name: /aplicar margen/i })).not.toBeInTheDocument();
  });

  it("con excepciones y sin margen general, igual ofrece aplicar", async () => {
    const user = userEvent.setup();
    setup({ purchase: new Map([[1, 1000]]), marginOverrides: new Map([[1, 100]]) });

    await user.click(screen.getByRole("button", { name: "Aplicar margen" }));

    expect(screen.getByLabelText("Precio de venta de Arroz Diana")).toHaveValue("2000");
  });

  it("la excepción del producto manda y 0 desactiva la sugerencia", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({
      purchase: new Map([
        [1, 1000],
        [2, 2000],
        [3, 1500],
      ]),
      marginPct: 50,
      marginOverrides: new Map([
        [1, 100],
        [2, 0],
      ]),
    });

    await user.click(screen.getByRole("button", { name: "Aplicar margen (50%)" }));

    expect(screen.getByLabelText("Precio de venta de Arroz Diana")).toHaveValue("2000");
    expect(screen.getByLabelText("Precio de venta de Leche Alpina")).toHaveValue("");
    expect(screen.getByLabelText("Precio de venta de Pan tajado")).toHaveValue("2250");

    await user.click(screen.getByRole("button", { name: /guardar cambios \(2\)/i }));
    expect(onSave).toHaveBeenCalledWith([
      {
        productId: 1,
        purchasePrice: null,
        salePrice: 2000,
        writePurchase: false,
        writeSale: true,
      },
      {
        productId: 3,
        purchasePrice: null,
        salePrice: 2250,
        writePurchase: false,
        writeSale: true,
      },
    ]);
  });
});

describe("suggestedSalePrice (paridad con el servidor)", () => {
  it("redondea la mitad hacia arriba como round(numeric, 0)", () => {
    expect(suggestedSalePrice(1250, 13)).toBe(1413);
    expect(suggestedSalePrice(150, 13)).toBe(170);
    expect(suggestedSalePrice(1050, 13)).toBe(1187);
    expect(suggestedSalePrice(3333, 50)).toBe(5000);
    expect(suggestedSalePrice(1250.5, 13)).toBe(1413);
    expect(suggestedSalePrice(10000, 50)).toBe(15000);
  });

  it("sin costo o sin margen no sugiere precio", () => {
    expect(suggestedSalePrice(0, 50)).toBeNull();
    expect(suggestedSalePrice(-1, 50)).toBeNull();
    expect(suggestedSalePrice(1000, 0)).toBeNull();
    expect(suggestedSalePrice(1000, -5)).toBeNull();
  });
});

describe("parsePriceInput", () => {
  it("acepta enteros y hasta dos decimales", () => {
    expect(parsePriceInput("")).toBeNull();
    expect(parsePriceInput("2500")).toBe(2500);
    expect(parsePriceInput("2500.50")).toBe(2500.5);
    expect(parsePriceInput(" 2500 ")).toBe(2500);
  });

  it("rechaza puntos de miles, cero, negativos y texto", () => {
    expect(parsePriceInput("2.500")).toBeNaN();
    expect(parsePriceInput("0")).toBeNaN();
    expect(parsePriceInput("-5")).toBeNaN();
    expect(parsePriceInput("abc")).toBeNaN();
    expect(parsePriceInput("2500,50")).toBeNaN();
  });
});
