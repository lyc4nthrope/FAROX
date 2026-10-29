import { useLoad } from "../../../shared/hooks/useLoad";
import { fetchCounterpartContact, type ContactKind } from "../api";
import { contactHref } from "../contact";

/**
 * 0029: botón que abre el medio de contacto preferido de la contraparte
 * vinculada (WhatsApp, teléfono o email). Si no configuró medio/identificador,
 * muestra una alerta visible para que lo complete en su perfil.
 */
export function ContactButton({
  kind,
  id,
  name,
}: {
  kind: ContactKind;
  id: number;
  name: string;
}) {
  const contact = useLoad(() => fetchCounterpartContact(kind, id), [kind, id]);

  if (contact.loading) {
    return (
      <span className="inline-flex items-center rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-400">
        …
      </span>
    );
  }

  const row = contact.data?.[0] ?? null;
  const href = row === null ? null : contactHref(row);

  if (href === null) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900"
        title={`${name} no configuró su medio de contacto. Pedile que complete teléfono/email y preferencia en su perfil.`}
      >
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
        >
          <path d="M12 9v4m0 4h.01M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
        Sin contacto
      </span>
    );
  }

  return (
    <a
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      aria-label={`Contactar a ${name}`}
    >
      <svg
        aria-hidden="true"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 24 24"
      >
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V6a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v9Z" />
      </svg>
      Contactar
    </a>
  );
}
