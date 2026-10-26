import { useEffect, useId, useRef, type ReactNode } from "react";

// Ventana emergente (S2): el alta se abre ENCIMA del catálogo, no debajo de la
// lista. Con 25 filas por página, un panel al final del documento obliga a
// scrollear y parece que el botón "no hizo nada".
// Cubre lo mínimo de un diálogo modal: foco al abrir, foco devuelto al cerrar,
// Escape, clic en el fondo, scroll del body bloqueado y semántica ARIA.
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Se captura en el render (no en un efecto): autoFocus del contenido ya
  // movió el foco cuando corre el efecto y perderíamos el disparador.
  const previouslyFocused = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const trigger = previouslyFocused.current;
    // Si el contenido ya se autoenfocó (p. ej. el buscador), se respeta.
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.contains(document.activeElement)) {
      dialog.focus();
    }
    return () => {
      trigger?.focus();
    };
  }, []);

  useEffect(() => {
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/50 p-4 backdrop-blur-sm sm:p-8"
      // El fondo cierra; el contenido detiene la propagación.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="my-auto w-full max-w-3xl rounded-2xl border border-gray-200/80 bg-white p-5 shadow-2xl shadow-gray-900/10 outline-none sm:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-4 border-b border-gray-100 pb-3">
          <h2 id={titleId} className="text-base font-semibold tracking-tight text-gray-900">
            {title}
          </h2>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
            onClick={onClose}
          >
            <svg
              aria-hidden="true"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              viewBox="0 0 24 24"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
