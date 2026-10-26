import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { useEffect, useRef, useState } from "react";

import { Status, buttonClass } from "../../../shared/ui/Box";

// Cámara bajo demanda: solo pide permiso cuando el usuario toca “Escanear QR”.
// El resultado se entrega crudo; quien lo usa decide si es un código válido.
export function QrScanner({
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
      const reader = new BrowserQRCodeReader();
      const scanner = await reader.decodeFromVideoDevice(
        undefined,
        video.current ?? undefined,
        (result, _error, scannerControls) => {
          if (!result) return;
          finished.current = true;
          scannerControls.stop();
          controls.current = null;
          setActive(false);
          onCode(result.getText());
        },
      );
      if (finished.current) {
        scanner.stop();
        return;
      }
      controls.current = scanner;
      setActive(true);
    } catch {
      setError("No pudimos abrir la cámara. Revisá los permisos o escribí el código a mano.");
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
        <button className={buttonClass} type="button" disabled={disabled || starting} onClick={() => void start()}>
          Escanear QR
        </button>
      )}
    </div>
  );
}
