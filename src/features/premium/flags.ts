/**
 * F6: el checkout se habilita explícitamente en producción. En dev/test queda
 * disponible por defecto para no romper el flujo local.
 */
export function isPremiumCheckoutEnabled(): boolean {
  const explicit = import.meta.env.VITE_PREMIUM_CHECKOUT_ENABLED;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return !import.meta.env.PROD;
}
