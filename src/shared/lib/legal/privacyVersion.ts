// Versión de la Política de Privacidad — fuente única para TODO el código.
//
// Vive en shared/ y NO en features/legal porque las features no se importan
// entre sí (límite de módulo D1, obs #486 — mismo criterio que duplica
// CONTACT_PREFERENCES en onboarding/types.ts:2-4). El slice legal la
// re-exporta desde su barrel como superficie pública, y auth (registro) la
// consume desde shared para versionar el consentimiento sin acoplar
// auth → legal.
//
// Regla: CUALQUIER cambio de texto en la política mueve este número junto
// con él (accepted_privacy_version en user_metadata queda con la versión que
// el usuario aceptó).
export const PRIVACY_VERSION = "1.0";
