/** Redirección externa (checkout de Mercado Pago). Aislada para tests. */
export function goTo(url: string): void {
  window.location.assign(url);
}
