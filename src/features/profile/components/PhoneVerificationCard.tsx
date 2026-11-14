import { useState } from "react";

import { mapError } from "../../../shared/lib/errors/mapError";
import { buttonClass } from "../../../shared/ui/Box";
import { startPhoneVerification, type PhoneVerificationStart } from "../api";

interface PhoneVerificationCardProps {
  phone: string;
  verifiedAt: string | null;
  /** Relee el perfil para ver si el webhook ya confirmó el código. */
  onRefresh: () => Promise<void>;
}

/**
 * 0042: el usuario ve un código y lo manda por WhatsApp al bot. La confirmación
 * llega por el webhook, así que el estado se refresca a mano con «Ya lo mandé».
 */
export function PhoneVerificationCard({
  phone,
  verifiedAt,
  onRefresh,
}: PhoneVerificationCardProps) {
  const [pending, setPending] = useState<PhoneVerificationStart | null>(null);
  const [starting, setStarting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = String(import.meta.env.VITE_WHATSAPP_AGENT_NUMBER ?? "").replace(/\D/g, "");
  const waHref =
    digits === "" || pending === null
      ? null
      : `https://wa.me/${digits}?text=${encodeURIComponent(`FAROX ${pending.code}`)}`;

  async function start(): Promise<void> {
    if (starting || phone.trim() === "") return;
    setStarting(true);
    setError(null);
    const { data, error: rpcError } = await startPhoneVerification(phone);
    setStarting(false);
    if (rpcError !== null) {
      setError(mapError(rpcError));
      return;
    }
    if (data === null) {
      setError("No pude generar el código. Intentá de nuevo.");
      return;
    }
    setPending(data);
  }

  async function refresh(): Promise<void> {
    setChecking(true);
    await onRefresh();
    setChecking(false);
  }

  if (verifiedAt !== null) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
        <p role="status" className="text-sm font-medium text-emerald-800">
          ✅ Teléfono verificado
        </p>
        <p className="mt-1 text-xs text-emerald-700">
          Si cambiás el número y guardás, vas a tener que verificarlo de nuevo.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-gray-200 px-3 py-3">
      <p className="text-sm font-medium text-gray-800">Verificación de WhatsApp</p>

      {phone.trim() === "" ? (
        <p className="mt-1 text-xs text-gray-500">
          Guardá un número de teléfono para poder verificarlo.
        </p>
      ) : pending === null ? (
        <>
          <p className="mt-1 text-xs text-gray-500">
            Confirmá que el número es tuyo: te mostramos un código para mandar por WhatsApp.
          </p>
          <button
            type="button"
            className={`${buttonClass} mt-2`}
            onClick={() => void start()}
            disabled={starting}
          >
            {starting ? "Generando…" : "Verificar este número"}
          </button>
          {error !== null && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-gray-500">
            Mandá este código desde el WhatsApp del número <strong>{phone}</strong>. Vence en 10
            minutos.
          </p>
          <p className="mt-2 rounded-lg bg-gray-900 px-3 py-2 text-center font-mono text-lg tracking-[0.2em] text-white">
            FAROX {pending.code}
          </p>
          {waHref !== null && (
            <a
              className={`${buttonClass} mt-2 inline-block`}
              href={waHref}
              target="_blank"
              rel="noreferrer"
            >
              Abrir WhatsApp con el código
            </a>
          )}
          <button
            type="button"
            className="mt-2 block text-xs font-medium text-gray-600 underline"
            onClick={() => void refresh()}
            disabled={checking}
          >
            {checking ? "Actualizando…" : "Ya lo mandé — actualizar estado"}
          </button>
          {error !== null && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
