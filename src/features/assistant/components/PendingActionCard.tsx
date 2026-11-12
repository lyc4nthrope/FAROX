import { useRef, useState } from "react";

import { mapError } from "../../../shared/lib/errors/mapError";
import { formatCOP, formatQty } from "../../../shared/lib/format";
import { buttonClass, inputClass } from "../../../shared/ui/Box";
import { cancelAction, executeAction, type AssistantAction } from "../api";

type Rec = Record<string, unknown>;
type Busy = "idle" | "executing" | "cancelling" | "done";

const KIND_LABEL: Record<string, string> = {
  store_exit: "Salida de tienda",
  distributor_sale: "Venta a tienda",
  distributor_purchase: "Compra de distribuidor",
  price_update: "Cambio de precios",
  shortage_toggle: "Faltante",
};

function asRecord(value: unknown): Rec {
  return typeof value === "object" && value !== null ? (value as Rec) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function num(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function money(value: unknown): string {
  const parsed = num(value);
  return parsed === null ? "—" : formatCOP(parsed);
}

function qty(value: unknown): string {
  const parsed = num(value);
  return parsed === null ? "—" : formatQty(parsed);
}

function boolLabel(value: unknown): string {
  return value === true ? "Sí" : "No";
}

function actionErrorMessage(code: string): string {
  if (code === "expired") return "El borrador venció. Pedile al asistente que lo prepare de nuevo.";
  if (code === "stale_draft") {
    return "Otro cambio modificó el precio. Pedile al asistente que lo prepare de nuevo.";
  }
  if (code.includes("stock insuficiente")) {
    return "No hay stock suficiente para esa salida.";
  }
  if (code.includes("solo admin/operador") || code.includes("solo distribuidor")) {
    return "Tu rol no puede hacer esta operación.";
  }
  if (code.includes("fuera del alcance") || code.includes("no está vinculada")) {
    return "La tienda no está dentro de tu alcance.";
  }
  if (code.includes("no está en tu catálogo") || code.includes("no está en la tienda")) {
    return "El producto no está disponible en esa tienda.";
  }
  if (code.includes("sin precio") || code.includes("precio de venta")) {
    return "Falta un precio de venta para uno de los productos.";
  }
  if (code.includes("confirmación fuerte")) {
    return "Escribí CONFIRMAR para aplicar el cambio de precios.";
  }
  return "No se pudo ejecutar la operación. Probá de nuevo.";
}

function movementLines(lines: readonly unknown[], unitKey: "unit_price" | "unit_cost") {
  return (
    <ul className="mt-2 space-y-1">
      {lines.map((raw, index) => {
        const line = asRecord(raw);
        return (
          <li key={`${text(line.name)}-${index}`} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">
              {text(line.name)} × {qty(line.qty)}
            </span>
            <span className="shrink-0 tabular-nums text-gray-600">{money(line[unitKey])}</span>
          </li>
        );
      })}
    </ul>
  );
}

function priceLines(lines: readonly unknown[]) {
  return (
    <ul className="mt-2 space-y-1.5">
      {lines.map((raw, index) => {
        const line = asRecord(raw);
        return (
          <li key={`${text(line.product)}-${index}`} className="border-t border-amber-200/70 pt-1.5">
            <p className="font-medium text-gray-900">{text(line.product)}</p>
            <p className="text-xs text-gray-600">
              Costo: {money(line.old_purchase)} → {money(line.new_purchase)}
            </p>
            <p className="text-xs text-gray-600">
              Venta: {money(line.old_sale)} → {money(line.new_sale)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function PendingActionCard({
  action,
  onDone,
}: {
  action: AssistantAction;
  onDone?: () => void;
}) {
  const summary = asRecord(action.summary);
  const kind = text(summary.kind);
  const store = text(summary.store);
  const lines = asArray(summary.lines);
  const discount = num(summary.discount);
  const total = num(summary.total);
  const product = text(summary.product);
  const strong = action.requires_strong_confirmation === true;

  const [busy, setBusy] = useState<Busy>("idle");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const busyRef = useRef(false);

  const expiresAt = new Date(action.expires_at);
  const expiresLabel = Number.isNaN(expiresAt.getTime())
    ? null
    : expiresAt.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  const busyWithServer = busy === "executing" || busy === "cancelling";

  async function confirm(): Promise<void> {
    if (busyRef.current) return;
    if (strong && confirmation.trim() !== "CONFIRMAR") return;
    busyRef.current = true;
    setBusy("executing");
    setError(null);
    const { data, error: rpcError } = await executeAction(
      action.action_id,
      strong ? "CONFIRMAR" : undefined,
    );
    if (rpcError !== null) {
      busyRef.current = false;
      setError(mapError(rpcError));
      setBusy("idle");
      return;
    }
    const result = asRecord(data);
    if (result.ok === false) {
      busyRef.current = false;
      setError(actionErrorMessage(text(result.error)));
      setBusy("idle");
      return;
    }
    const count = num(result.count);
    setDone(count === null ? "Registrado." : `Registrado: ${formatQty(count)} línea(s).`);
    setBusy("done");
    onDone?.();
  }

  async function cancel(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("cancelling");
    setError(null);
    const { error: rpcError } = await cancelAction(action.action_id);
    if (rpcError !== null) {
      busyRef.current = false;
      setError(mapError(rpcError));
      setBusy("idle");
      return;
    }
    setDone("Cancelado.");
    setBusy("done");
    onDone?.();
  }

  return (
    <div
      role="group"
      aria-label="Borrador pendiente de confirmación"
      className="mr-auto w-full max-w-[95%] rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-gray-900"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800">
          {KIND_LABEL[kind] ?? "Borrador"}
        </p>
        {expiresLabel !== null && (
          <p className="shrink-0 text-[11px] text-amber-700">Vence {expiresLabel}</p>
        )}
      </div>

      {store !== "" && <p className="mt-1 text-xs text-gray-600">{store}</p>}

      {(kind === "store_exit" || kind === "distributor_sale") &&
        movementLines(lines, "unit_price")}
      {kind === "distributor_purchase" && movementLines(lines, "unit_cost")}
      {kind === "price_update" && priceLines(lines)}
      {kind === "shortage_toggle" && (
        <p className="mt-2 text-xs text-gray-700">
          {product}: {boolLabel(summary.old)} → {boolLabel(summary.new)}
        </p>
      )}

      {discount !== null && discount > 0 && (
        <p className="mt-2 text-xs text-gray-600">Descuento: {discount}%</p>
      )}
      {total !== null && (
        <p className="mt-2 text-sm font-semibold tabular-nums">Total: {money(total)}</p>
      )}

      {done !== null ? (
        <p className="mt-3 text-xs font-medium text-emerald-700">{done}</p>
      ) : (
        <>
          {strong && (
            <label className="mt-3 block text-xs text-gray-700">
              Escribí CONFIRMAR para aplicar el cambio de precios
              <input
                className={`${inputClass} mt-1 w-full`}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                aria-label="Confirmación fuerte"
                autoComplete="off"
              />
            </label>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={
                busyWithServer || (strong && confirmation.trim() !== "CONFIRMAR")
              }
              onClick={() => void confirm()}
            >
              {busy === "executing" ? "Confirmando…" : "Confirmar"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              disabled={busyWithServer}
              onClick={() => void cancel()}
            >
              {busy === "cancelling" ? "Cancelando…" : "Cancelar"}
            </button>
          </div>
        </>
      )}

      {error !== null && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
