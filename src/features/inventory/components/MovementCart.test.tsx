import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MovementProductOption } from "../api";
import { MovementCart, cartSubtotal, cartTotal, netUnitPrice, type CartLine } from "./MovementCart";

type ScanCallback = (
  result: { getText: () => string } | undefined,
  error: unknown,
  controls: { stop: () => void },
) => void;

let latestScanCallback: ScanCallback | null = null;
const stopSpy = vi.fn();

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    possibleFormats: unknown[] = [];
    async decodeFromVideoDevice(
      _deviceId: string | undefined,
      _videoEl: HTMLVideoElement | undefined,
      callback: ScanCallback,
    ) {
      latestScanCallback = callback;
      return { stop: stopSpy };
    }
  },
}));

const OPTIONS: readonly MovementProductOption[] = [
  {
    id: 1,
    name: "Arroz Diana",
    brand: "Diana",
    barcode: "7701111111111",
    quantity: 10,
    purchasePrice: 2000,
    salePrice: 3000,
  },
  {
    id: 2,
    name: "Leche Alpina",
    brand: "Alpina",
    barcode: "7702222222222",
    quantity: 20,
    purchasePrice: 3500,
    salePrice: 4500,
  },
];

function ControlledCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState("");
  return (
    <MovementCart
      options={OPTIONS}
      lines={lines}
      onChange={setLines}
      priceKind="sale"
      showDiscount
      discount={discount}
      onDiscountChange={setDiscount}
    />
  );
}

afterEach(() => {
  cleanup();
  latestScanCallback = null;
  stopSpy.mockClear();
  vi.restoreAllMocks();
});

describe("MovementCart · funciones puras (netUnitPrice, cartSubtotal, cartTotal)", () => {
  it("calcula el precio unitario neto con redondeo a 2 decimales y soporta 100 % de descuento", () => {
    expect(netUnitPrice("3000", "")).toBe(3000);
    expect(netUnitPrice("3000", "10")).toBe(2700);
    expect(netUnitPrice("1999", "33.33")).toBe(1332.73);
    expect(netUnitPrice("3000", "100")).toBe(0);
    expect(netUnitPrice("3000", "150")).toBe(0);
    expect(netUnitPrice("3000", "-10")).toBe(3000);
    expect(netUnitPrice("0", "10")).toBeNull();
    expect(netUnitPrice("-500", "10")).toBeNull();
    expect(netUnitPrice("", "10")).toBeNull();
  });

  it("calcula subtotal y total del carrito incluyendo descuento del 100 %", () => {
    const lines: CartLine[] = [
      { productId: 1, name: "Arroz Diana", brand: "Diana", quantity: "2", unitPrice: "3000" },
      { productId: 2, name: "Leche Alpina", brand: "Alpina", quantity: "1", unitPrice: "4500" },
    ];
    expect(cartSubtotal(lines)).toBe(10500);
    expect(cartTotal(lines, "")).toBe(10500);
    expect(cartTotal(lines, "10")).toBe(9450);
    expect(cartTotal(lines, "100")).toBe(0);
  });
});

describe("MovementCart + BarcodeScanner · escaneo continuo", () => {
  it("conserva los productos previos al escanear dos códigos distintos seguidos y suma al repetir", async () => {
    const user = userEvent.setup();
    render(<ControlledCart />);

    await user.click(screen.getByRole("button", { name: "Escanear código" }));
    expect(latestScanCallback).not.toBeNull();

    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    // 1. Escanea producto A
    act(() => {
      latestScanCallback?.({ getText: () => "7701111111111" }, null, { stop: stopSpy });
    });
    expect(screen.getByLabelText("Precio de venta de Arroz Diana")).toHaveValue(3000);

    // 2. Escanea producto B sin apagar la cámara: A debe seguir en el ticket
    now += 200;
    act(() => {
      latestScanCallback?.({ getText: () => "7702222222222" }, null, { stop: stopSpy });
    });
    expect(screen.getByLabelText("Precio de venta de Arroz Diana")).toHaveValue(3000);
    expect(screen.getByLabelText("Precio de venta de Leche Alpina")).toHaveValue(4500);

    // 3. Re-escanea producto A después del enfriamiento: cantidad sube a 2
    now += 2_000;
    act(() => {
      latestScanCallback?.({ getText: () => "7701111111111" }, null, { stop: stopSpy });
    });
    expect(screen.getByLabelText("Cantidad de Arroz Diana")).toHaveValue(2);
    expect(screen.getByLabelText("Cantidad de Leche Alpina")).toHaveValue(1);
  });
});
