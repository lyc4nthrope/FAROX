// Superficie pública del slice legal (ruta pública /privacidad).
// PRIVACY_VERSION se DEFININE en shared/lib/legal (las features no se importan
// entre sí — límite de módulo D1, obs #486) y se RE-EXPORTA acá para que el
// slice sea la cara pública de la política.
export { PrivacyPage } from "./routes/PrivacyPage";
export { PRIVACY_SECTIONS, PRIVACY_THIRD_PARTIES } from "./privacyContent";
export { PRIVACY_VERSION } from "../../shared/lib/legal/privacyVersion";
