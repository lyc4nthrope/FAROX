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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
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
        className="w-full max-w-3xl rounded-lg bg-white p-4 shadow-xl outline-none sm:p-6"
      >
        <div className="mb-3 flex items-start justify-between gap-4 border-b border-gray-100 pb-2">
          <h2 id={titleId} className="text-base font-semibold text-gray-900">
            {title}
          </h2>
          <button
            type="button"
            className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
