import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// El permiso de cámara es asíncrono: si la pantalla se cierra mientras el
// navegador lo pide, la limpieza corría sin control que detener y, al llegar
// el permiso, la cámara quedaba encendida (auditoría).
const pending = vi.hoisted(() => ({
  resolve: null as null | ((controls: { stop: () => void }) => void),
}));
const decode = vi.hoisted(
  () => () =>
    new Promise<{ stop: () => void }>((resolve) => {
      pending.resolve = resolve;
    }),
);

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    decodeFromVideoDevice = decode;
  },
  BrowserMultiFormatReader: class {
    possibleFormats: unknown;
    decodeFromVideoDevice = decode;
  },
}));

import { BarcodeScanner } from "../../products/components/BarcodeScanner";
import { QrScanner } from "./QrScanner";

afterEach(() => {
  cleanup();
  pending.resolve = null;
});

async function startThenUnmountBeforePermission(ui: ReactElement): Promise<() => void> {
  const user = userEvent.setup();
  const view = render(ui);
  await user.click(screen.getByRole("button", { name: /escanear/i }));
  view.unmount();
  const stop = vi.fn();
  await act(async () => {
    pending.resolve?.({ stop });
  });
  return stop;
}

describe("escáneres: la cámara se apaga si la pantalla se cierra mientras pide permiso", () => {
  it("QrScanner", async () => {
    const stop = await startThenUnmountBeforePermission(<QrScanner onCode={() => {}} />);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("BarcodeScanner", async () => {
    const stop = await startThenUnmountBeforePermission(<BarcodeScanner onCode={() => {}} />);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
