// El QR de la tienda codifica `${origin}/vincular/<link_code>`. El lector debe
// aceptar también el código escrito a mano, pero NUNCA un código de otra URL
// (un QR ajeno no puede vincular la tienda a un distribuidor arbitrario).
const LINK_CODE = /^[0-9a-f]{18}$/i;
const LINK_PATH = /^\/vincular\/([0-9a-f]{18})$/i;

/** Extrae el link_code de un QR de la propia app o de un código escrito. */
export function parseLinkCode(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return null;
  if (LINK_CODE.test(text)) return text.toLowerCase();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  const match = url.pathname.match(LINK_PATH);
  return match ? match[1].toLowerCase() : null;
}
