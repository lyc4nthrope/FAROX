import type { CounterpartContact } from "./api";

/** URL del medio preferido; null si falta el identificador. */
export function contactHref(contact: CounterpartContact): string | null {
  if (contact.contact_preference === "email") {
    const email = contact.email?.trim() ?? "";
    return email === "" ? null : `mailto:${encodeURIComponent(email)}`;
  }
  const phone = contact.phone_number?.trim() ?? "";
  if (phone === "") return null;
  if (contact.contact_preference === "phone") return `tel:${phone}`;
  const digits = phone.replace(/[^\d]/g, "");
  return digits === "" ? null : `https://wa.me/${digits}`;
}
