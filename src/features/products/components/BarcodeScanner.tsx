import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat } from "@zxing/library";
import { useEffect, useRef, useState } from "react";

import { Status, buttonClass } from "../../../shared/ui/Box";

// Formatos 1D de código de barras de producto. Se dejan FUERA los 2D (QR,
// DataMatrix) a propósito: el campo es un código de barras, y restringir los
// formatos acelera la decodificación y evita leer un QR de cartel como código.
const PRODUCT_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
];

// Cámara bajo demanda, mismo patrón que QrScanner (store-links): el permiso
// solo se pide al tocar el botón y el resultado se entrega crudo; el
// formulario decide qué hacer con él.
export function BarcodeScanner({
  onCode,
  disabled = false,
}: {
  onCode: (raw: string) => void;
  disabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const finished = useRef(false);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function stop() {
    controls.current?.stop();
    controls.current = null;
    setActive(false);
  }

  async function start() {
    setError(null);
    setStarting(true);
    finished.current = false;
    try {
      const reader = new BrowserMultiFormatReader();
      reader.possibleFormats = PRODUCT_FORMATS;
      const scanner = await reader.decodeFromVideoDevice(
        undefined,
        video.current ?? undefined,
        (result, _error, scannerControls) => {
          if (!result) return;
          finished.current = true;
          scannerControls.stop();
          controls.current = null;
          setActive(false);
          onCode(result.getText().trim());
        },
      );
      if (finished.current) {
        scanner.stop();
        return;
      }
      controls.current = scanner;
      setActive(true);
    } catch {
      setError(
        "No pudimos abrir la cámara. Revisá los permisos o escribí el código a mano.",
      );
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    return () => controls.current?.stop();
  }, []);

  return (
    <div className="mt-2">
      <Status loading={starting} error={error} />
      <video
        ref={video}
        className={active ? "w-full max-w-sm rounded border" : "hidden"}
        muted
        playsInline
      />
      {active ? (
        <button className={buttonClass} type="button" onClick={stop}>
          Detener cámara
        </button>
      ) : (
        <button
          className={buttonClass}
          type="button"
          disabled={disabled || starting}
          onClick={() => void start()}
        >
          Escanear código
        </button>
      )}
    </div>
  );
}
