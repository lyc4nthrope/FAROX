import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { AssistantChat } from "./AssistantChat";

/**
 * Widget flotante del asistente: mismo chat que /asistente, en un panel
 * discreto abajo a la derecha. No se muestra en /asistente (ya está completo).
 */
export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (location.pathname.startsWith("/asistente")) return null;

  return (
    <>
      <div
        id="assistant-panel"
        ref={panelRef}
        role="dialog"
        aria-label="Asistente"
        aria-hidden={!open}
        hidden={!open}
        tabIndex={-1}
        className={`fixed bottom-20 right-3 z-40 h-[70vh] max-h-[34rem] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-gray-900/20 outline-none sm:right-4 ${
          open ? "flex" : "hidden"
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
          <p className="text-sm font-semibold tracking-tight text-gray-900">Asistente</p>
          <button
            type="button"
            aria-label="Cerrar asistente"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
            onClick={() => setOpen(false)}
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              viewBox="0 0 24 24"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <AssistantChat compact />
      </div>

      <button
        type="button"
        aria-label={open ? "Ocultar asistente" : "Abrir asistente"}
        aria-expanded={open}
        aria-controls={open ? "assistant-panel" : undefined}
        className="fixed bottom-4 right-3 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-gray-900 text-white shadow-xl shadow-gray-900/30 transition hover:bg-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 sm:right-4"
        onClick={() => setOpen((current) => !current)}
      >
        <svg
          aria-hidden="true"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
        >
          <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-5.5A8 8 0 1 1 21 12Z" />
          <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
        </svg>
      </button>
    </>
  );
}
