import { PRIVACY_VERSION } from "../../shared/lib/legal/privacyVersion";

// Contenido estructurado de la Política de Privacidad — UNA sola fuente de
// verdad, renderizada en /privacidad (ruta pública, sin RequireAuth). Es
// datos puros (sin JSX) para poder versionarlo y testearlo sin arrastrar la
// UI: el componente de la página solo lo recorre y lo pinta.
//
// Los datos del responsable van con placeholders {{ASÍ}} a propósito: este
// documento es BORRADOR y debe pasar revisión legal (con esos datos
// completos) antes de publicarse.

export interface PrivacySection {
  id: string;
  title: string;
  blocks: readonly PrivacyBlock[];
}

// Un tercero real con el que la app se comunica: name es lo que se pinta en
// negrita; receives explica QUÉ dato sale hacia ese servicio.
export interface ThirdParty {
  name: string;
  receives: string;
}

export type PrivacyBlock =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: readonly string[] }
  | { kind: "third-parties"; items: readonly ThirdParty[] };

// Terceros REALES del código (no son ejemplo): cada entrada corresponde a un
// servicio que la app ya usa.
// · ipwho.is → shared/lib/geo/useGeolocation.ts (fallback por IP).
// · tiles OSM/CARTO → shared/lib/geo/tiles.ts.
// · Nominatim → shared/lib/geo/nominatim.ts (geocodificación del picker).
export const PRIVACY_THIRD_PARTIES: readonly ThirdParty[] = [
  {
    name: "Supabase (https://supabase.com)",
    receives:
      "proveedor de autenticación y base de datos de la plataforma. Aloja tu email, nombre completo, " +
      "teléfono, preferencia de contacto y rol, y los registros de tiendas (nombre, tipo, dirección, " +
      "coordenadas) y de distribuidores (nombre, NIT, persona de contacto, teléfono, email). También " +
      "administra la sesión de tu cuenta en el navegador.",
  },
  {
    name: "ipwho.is (https://ipwho.is/)",
    receives:
      "cuando el navegador no concede —o no soporta— la geolocalización, la app envía tu DIRECCIÓN IP " +
      "a este servicio para estimar una ubicación aproximada. Es una transferencia de datos a un tercero: " +
      "ipwho.is recibe tu dirección IP y responde con coordenadas. No le enviamos ningún otro dato personal.",
  },
  {
    name: "OpenStreetMap — servidor de tiles (https://tile.openstreetmap.org)",
    receives:
      "cada vez que ves un mapa se descargan imágenes (tiles) desde este servidor. Eso le envía tu " +
      "dirección IP y las coordenadas del área del mapa que estuviste viendo.",
  },
  {
    name: "CARTO (https://basemaps.cartocdn.com) — solo si está configurada",
    receives:
      "se usa ÚNICAMENTE cuando la instalación tiene la llave opcional VITE_CARTO_KEY. Los mapas se " +
      "descargan desde sus servidores y reciben la misma información que el servidor de tiles de " +
      "OpenStreetMap: tu dirección IP y los tiles pedidos.",
  },
  {
    name: "Nominatim (https://nominatim.openstreetmap.org)",
    receives:
      "cuando eliges en el mapa la ubicación de una tienda o escribes una dirección, la app envía esas " +
      "COORDENADAS —o el texto de la dirección— para traducirlas a una dirección legible (geocodificación " +
      "inversa y directa). Nominatim recibe las coordenadas exactas de la tienda que estás creando o editando.",
  },
];

export const PRIVACY_SECTIONS: readonly PrivacySection[] = [
  {
    id: "responsable",
    title: "¿Quién es responsable de tus datos?",
    blocks: [
      {
        kind: "p",
        text:
          "FAROX es la plataforma que conecta distribuidores y tiendas. El responsable del tratamiento " +
          "de tus datos personales es: {{RAZON_SOCIAL}}, identificado con {{NIT_O_ID}}, con domicilio " +
          "en {{DIRECCION}}, contacto en {{EMAIL_DE_CONTACTO}} y jurisdicción en {{PAIS_JURISDICCION}}.",
      },
      {
        kind: "p",
        text:
          "Los datos del responsable van marcados con {{ }} a propósito: este documento es un borrador " +
          "y debe completarse y pasar revisión legal antes de publicarse.",
      },
    ],
  },
  {
    id: "datos",
    title: "Qué datos recopilamos y de dónde vienen",
    blocks: [
      { kind: "p", text: "Recopilamos solo los datos que la plataforma necesita para funcionar:" },
      {
        kind: "ul",
        items: [
          "Registro (página pública /register): nombre completo, email y contraseña. La contraseña se " +
            "guarda cifrada en Supabase y jamás la tratamos en claro. Además guardamos la fecha y la " +
            "versión de esta política que aceptaste (para que tu consentimiento sea auditable).",
          "Onboarding «Mi tienda»: nombre de la tienda, tipo de tienda, dirección y coordenadas " +
            "(latitud y longitud) que eliges en el mapa.",
          "Onboarding «Distribuidor»: nombre comercial, NIT, persona de contacto, teléfono, email y " +
            "preferencia de contacto (WhatsApp, teléfono o email).",
          "Alta y edición de tiendas dentro de la app: nombre, tipo, dirección, ciudad, teléfono y " +
            "coordenadas.",
          "Perfil: teléfono y preferencia de contacto.",
          "Rol y privilegios (administrador, operador, distribuidor): se asignan desde el servidor " +
            "según tu organización; no los ingresas tú.",
          "Uso de la app: si activas la geolocalización del navegador, la usamos para precargar el " +
            "mapa en tu equipo. Con cada mapa también viajan tu IP y el área visible (ver la sección " +
            "«Con quién compartimos tus datos»).",
        ],
      },
    ],
  },
  {
    id: "finalidades",
    title: "Para qué usamos tus datos",
    blocks: [
      { kind: "p", text: "Tratamos tus datos para:" },
      {
        kind: "ul",
        items: [
          "Crear y administrar tu cuenta, y confirmar tu email.",
          "Definir tu rol y habilitar solo las funciones a las que tienes permiso.",
          "Completar tu onboarding y gestionar tiendas, distribuidores y catálogos de productos.",
          "Sostener las funciones de la plataforma para tu organización: catálogo, publicación de " +
            "precios y funciones de pedidos cuando estén habilitados.",
          "Comunicaciones operativas del servicio (confirmaciones y avisos importantes).",
          "Seguridad de la plataforma y prevención de abuso.",
          "Cumplir obligaciones legales.",
        ],
      },
    ],
  },
  {
    id: "base-juridica",
    title: "Base jurídica del tratamiento",
    blocks: [
      {
        kind: "p",
        text:
          "El tratamiento se apoya en: (a) tu consentimiento, que otorgas al marcar la casilla de la " +
          "Política de Privacidad al registrarte; y (b) el interés legítimo de operar y asegurar la " +
          "plataforma —por ejemplo, seguridad, prevención de fraude y mejora del servicio— cuando " +
          "corresponde.",
      },
      {
        kind: "p",
        text:
          "Puedes retirar tu consentimiento cuando quieras (ver «Tus derechos»); la retirada no afecta " +
          "la licitud del tratamiento hecho antes de ella.",
      },
    ],
  },
  {
    id: "terceros",
    title: "Con quién compartimos tus datos (terceros)",
    blocks: [
      {
        kind: "p",
        text:
          "No vendemos tus datos. Sí trabajamos con proveedores que reciben información para que la " +
          "plataforma funcione:",
      },
      { kind: "third-parties", items: PRIVACY_THIRD_PARTIES },
      {
        kind: "p",
        text:
          "Cada proveedor trata los datos según sus propias políticas; te recomendamos conocerlas. " +
          "Los proveedores de mapas y geocodificación (OpenStreetMap, CARTO y Nominatim) usan esos " +
          "datos para prestar su servicio público de cartografía.",
      },
    ],
  },
  {
    id: "almacenamiento-local",
    title: "Almacenamiento en tu navegador (localStorage)",
    blocks: [
      {
        kind: "ul",
        items: [
          "farox:last-known-location: guarda en tu navegador la última ubicación usada (coordenadas, " +
            "precisión y fecha) para no pedirla de nuevo. Vive solo en tu dispositivo; puedes borrarla " +
            "limpiando los datos del sitio desde la configuración de tu navegador.",
          "Sesión de Supabase: el token de tu sesión se guarda en el almacenamiento local del navegador " +
            "para que no tengas que iniciar sesión en cada visita. Se elimina al cerrar sesión.",
        ],
      },
    ],
  },
  {
    id: "conservacion",
    title: "Cuánto tiempo conservamos tus datos",
    blocks: [
      {
        kind: "p",
        text:
          "Conservamos tus datos mientras tu cuenta esté activa y sean necesarios para los fines " +
          "descritos. Si eliminas tu cuenta, suprimimos o anonimizamos tus datos personales en un " +
          "plazo razonable, salvo que una norma exija conservarlos —por ejemplo, obligaciones fiscales " +
          "o contables vinculadas al NIT de una organización—.",
      },
      {
        kind: "p",
        text: "Los registros técnicos de seguridad (como logs de acceso) se conservan por tiempo limitado.",
      },
    ],
  },
  {
    id: "derechos",
    title: "Tus derechos sobre tus datos (Colombia, Ley 1581 de 2012)",
    blocks: [
      {
        kind: "p",
        text:
          "Bajo la Ley Estatutaria 1581 de 2012 y su decreto reglamentario 1377 de 2013, tienes estos " +
          "derechos, que puedes ejercer en cualquier momento:",
      },
      {
        kind: "ul",
        items: [
          "Acceso: saber qué datos tuyos tratamos y obtener una copia.",
          "Rectificación: corregir datos inexactos o incompletos.",
          "Supresión (derecho al olvido): pedir que eliminemos tus datos cuando ya no sean necesarios.",
          "Revocación del consentimiento: retirar el consentimiento que diste al registrarte.",
          "Reclamo: presentar un reclamo ante la Superintendencia de Industria y Comercio (SIC) de " +
            "Colombia si consideras que tus derechos no fueron atendidos.",
        ],
      },
      {
        kind: "p",
        text:
          "Para ejercerlos, escribe a {{EMAIL_DE_CONTACTO}} con el asunto «Derechos de datos " +
          "personales», indicando tu nombre, el email con el que te registraste y el derecho que " +
          "quieres ejercer. Daremos respuesta dentro de los plazos que fija la ley. Si no quedas " +
          "conforme con nuestra respuesta, puedes reclamar ante la SIC (www.sic.gov.co).",
      },
    ],
  },
  {
    id: "menores",
    title: "Menores de edad",
    blocks: [
      {
        kind: "p",
        text:
          "FAROX es una plataforma entre empresas, dirigida a profesionales y personas con capacidad " +
          "legal para contratar: esperamos que quienes se registren sean mayores de 18 años. Si " +
          "detectamos una cuenta de un menor de edad, la eliminamos.",
      },
    ],
  },
  {
    id: "cambios",
    title: "Cambios a esta política",
    blocks: [
      {
        kind: "p",
        text: `Cada versión de esta política tiene un número: la versión vigente es la ${PRIVACY_VERSION}.`,
      },
      {
        kind: "p",
        text:
          "Si el cambio es sustancial, lo avisamos por email o con un aviso destacado en la aplicación " +
          "antes de que surta efecto. Tu registro de consentimiento guarda la versión que aceptaste, " +
          "para que siempre sepas bajo qué versión diste tu consentimiento.",
      },
    ],
  },
];
