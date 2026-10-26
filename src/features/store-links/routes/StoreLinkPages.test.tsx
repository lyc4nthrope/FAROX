import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { LinkStorePage } from "./StoreLinkPages";

const { decodeMock } = vi.hoisted(() => ({ decodeMock: vi.fn() }));

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    decodeFromVideoDevice = decodeMock;
  },
}));
vi.mock("../api", () => ({
  linkToStore: vi.fn(),
  getLinkCode: vi.fn(),
  fetchLinkedDistributors: vi.fn(),
  regenerateLinkCode: vi.fn(),
  unlinkDistributor: vi.fn(),
  linkUrl: (code: string) => `http://localhost/vincular/${code}`,
}));

const CODE = "0123456789abcdef01";
const RAW_ERROR = "NotAllowedError: Permission denied (raw)";

function renderPage(path = "/vincular") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/vincular" element={<LinkStorePage />} />
        <Route path="/vincular/:code" element={<LinkStorePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.linkToStore).mockResolvedValue({ data: null, error: null });
  decodeMock.mockResolvedValue({ stop: vi.fn() });
});

afterEach(() => {
  cleanup();
});

describe("LinkStorePage", () => {
  it("vincula con el código escrito a mano", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Código"), CODE);
    await user.click(screen.getByRole("button", { name: "Vincular" }));

    await waitFor(() => expect(api.linkToStore).toHaveBeenCalledWith(CODE));
    expect(await screen.findByText("¡Listo! Quedaste vinculado a la tienda.")).toBeInTheDocument();
  });

  it("rechaza un código escrito inválido sin llamar al backend", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Código"), "no-es-un-codigo");
    await user.click(screen.getByRole("button", { name: "Vincular" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ese código o QR no es válido. Escaneá el QR de la tienda o revisá el código.",
    );
    expect(api.linkToStore).not.toHaveBeenCalled();
  });

  it("escanea el QR de la app y vincula automáticamente", async () => {
    const stop = vi.fn();
    decodeMock.mockImplementation(async (_device, _video, callback) => {
      queueMicrotask(() =>
        callback({ getText: () => `${window.location.origin}/vincular/${CODE}` }, undefined, { stop }),
      );
      return { stop };
    });
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Escanear QR" }));

    await waitFor(() => expect(api.linkToStore).toHaveBeenCalledWith(CODE));
    expect(await screen.findByText("¡Listo! Quedaste vinculado a la tienda.")).toBeInTheDocument();
    expect(stop).toHaveBeenCalled();
  });

  it("rechaza un QR de otro origen sin vincular", async () => {
    decodeMock.mockImplementation(async (_device, _video, callback) => {
      queueMicrotask(() =>
        callback(
          { getText: () => `https://evil.example/vincular/${CODE}` },
          undefined,
          { stop: vi.fn() },
        ),
      );
      return { stop: vi.fn() };
    });
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Escanear QR" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ese código o QR no es válido. Escaneá el QR de la tienda o revisá el código.",
    );
    expect(api.linkToStore).not.toHaveBeenCalled();
  });

  it("si la cámara falla muestra un error amigable y nunca el texto crudo", async () => {
    decodeMock.mockRejectedValue(new Error(RAW_ERROR));
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Escanear QR" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos abrir la cámara. Revisá los permisos o escribí el código a mano.",
    );
    expect(screen.queryByText(RAW_ERROR)).not.toBeInTheDocument();
  });

  it("desde el QR en /vincular/:code vincula una sola vez", async () => {
    renderPage(`/vincular/${CODE}`);

    await waitFor(() => expect(api.linkToStore).toHaveBeenCalledWith(CODE));
    expect(api.linkToStore).toHaveBeenCalledTimes(1);
  });
});
