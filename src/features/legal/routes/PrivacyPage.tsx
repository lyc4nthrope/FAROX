import { Link } from "react-router-dom";

import { PRIVACY_VERSION } from "../../../shared/lib/legal/privacyVersion";
import type { PrivacyBlock } from "../privacyContent";
import { PRIVACY_SECTIONS } from "../privacyContent";

// Render de un bloque del contenido estructurado (privacyContent.ts): dato
// puro pintado con las primitivas de la app. Los estilos repiten el vocabulario
// de las páginas públicas (LoginPage/RegisterPage: gray-600/700, text-sm).
function PrivacyBlockView({ block }: { block: PrivacyBlock }) {
  if (block.kind === "p") {
    return <p className="mt-3 text-sm text-gray-700">{block.text}</p>;
  }
  if (block.kind === "ul") {
    return (
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700">
        {block.items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    );
  }
  // third-parties: nombre en negrita + qué recibe cada servicio. El nombre
  // vive en su propio elemento para poder referenciarlo desde los tests.
  return (
    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-700">
      {block.items.map((third, index) => (
        <li key={index}>
          <strong className="font-medium text-gray-900">{third.name}</strong>: {third.receives}
        </li>
      ))}
    </ul>
  );
}

// Contenedor (y toda la página) de /privacidad — ruta PÚBLICA como /login y
// /register: se lee SIN sesión, y el checkbox de consentimiento del registro
// la linkea. Todo el texto vive en privacyContent.ts (fuente única), así la
// política se versiona como datos y no como JSX disperso.
export function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">Política de Privacidad</h1>
      <p className="mt-1 text-sm text-gray-600">Versión vigente: {PRIVACY_VERSION}</p>
      {/* Aviso de borrador: el documento NO está listo para publicar sin
          revisión legal (placeholders {{...}} del responsable pendientes). */}
      <div
        role="note"
        className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
      >
        BORRADOR — requiere revisión legal antes de publicar
      </div>
      {PRIVACY_SECTIONS.map((section) => (
        <section key={section.id} id={section.id} className="mt-8">
          <h2 className="text-lg font-semibold">{section.title}</h2>
          {section.blocks.map((block, index) => (
            <PrivacyBlockView key={index} block={block} />
          ))}
        </section>
      ))}
      <p className="mt-10 text-sm text-gray-600">
        <Link to="/register" className="font-medium text-gray-900 underline">
          Volver al registro
        </Link>
      </p>
    </div>
  );
}
