import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { EmptyState } from "../../../shared/ui";
import {
  Badge,
  Box,
  Field,
  Status,
  buttonClass,
  inputClass,
  runAction,
  secondaryButtonClass,
} from "../../../shared/ui/Box";
import { formatCOP } from "../../../shared/lib/format";
import {
  cancelCredit,
  fetchCredits,
  fetchPayments,
  registerPayment,
  reversePayment,
  type CreditRow,
} from "../api";

const CREDIT_LABELS: Record<string, string> = {
  pending: "Pendiente",
  paid: "Pagado",
  cancelled: "Anulado",
};

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA");
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
}

function CreditCard({ credit, onChanged }: { credit: CreditRow; onChanged: () => void }) {
  const { role } = useAuth();
  const payments = useLoad(() => fetchPayments(credit.id), [credit.id]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });

  async function act(action: () => Promise<{ error: { message: string } | null }>, ok: string) {
    const error = await runAction(action);
    setMsg({ error, ok: error === null ? ok : null });
    if (error === null) {
      payments.reload();
      onChanged();
    }
  }

  const paid = credit.total_amount - credit.balance;
  const paidPct = credit.total_amount > 0 ? Math.min(100, (paid / credit.total_amount) * 100) : 0;
  const overdue =
    credit.status === "pending" && credit.due_date !== null && credit.due_date < todayIso();
  const tone =
    credit.status === "paid"
      ? "green"
      : credit.status === "cancelled"
        ? "gray"
        : overdue
          ? "red"
          : "amber";

  return (
    <Box title={`Crédito #${credit.id} · ${credit.store_name}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
            Saldo pendiente
          </p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-gray-900">
            {formatCOP(credit.balance)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Total {formatCOP(credit.total_amount)} · Pagado {formatCOP(paid)}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Badge tone={tone}>{CREDIT_LABELS[credit.status] ?? credit.status}</Badge>
          {credit.due_date !== null && (
            <span className={`text-xs font-medium ${overdue ? "text-red-700" : "text-gray-500"}`}>
              {overdue ? "Vencido" : "Vence"} {formatDate(credit.due_date)}
            </span>
          )}
          <Link
            className="text-xs font-medium text-gray-500 underline-offset-4 hover:text-gray-900 hover:underline"
            to={`/pedidos/${credit.order_id}`}
          >
            Pedido #{credit.order_id}
          </Link>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${paidPct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-gray-500">{Math.round(paidPct)}% pagado</p>

      <Status error={msg.error ?? payments.error} ok={msg.ok} />

      {credit.status === "pending" && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
            Registrar pago
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Field label="Monto">
              <input
                className={inputClass}
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Medio">
              <select
                className={inputClass}
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="cash">Efectivo</option>
                <option value="transfer">Transferencia</option>
                <option value="card">Tarjeta</option>
                <option value="other">Otro</option>
              </select>
            </Field>
            <button
              className={buttonClass}
              type="button"
              onClick={() => {
                if (Number(amount) > 0) {
                  void act(
                    () => registerPayment(credit.id, Number(amount), method),
                    "Pago registrado.",
                  );
                }
              }}
            >
              Registrar pago
            </button>
            {role === "admin" && (
              <button
                className={`${secondaryButtonClass} border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800`}
                type="button"
                onClick={() => {
                  const reason = window.prompt("Motivo de la anulación");
                  if (reason) void act(() => cancelCredit(credit.id, reason), "Crédito anulado.");
                }}
              >
                Anular crédito
              </button>
            )}
          </div>
        </div>
      )}

      {(payments.data ?? []).length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Pagos</p>
          <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-100">
            {payments.data?.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span className="text-gray-600">
                  {new Date(p.paid_at).toLocaleDateString("es-CO")} ·{" "}
                  <span className="font-medium text-gray-900">{formatCOP(p.amount)}</span> ·{" "}
                  {p.payment_method}
                  {p.reverso_of_id !== null && ` — reverso de #${p.reverso_of_id}`}
                </span>
                {role === "admin" && p.reverso_of_id === null && (
                  <button
                    className="rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
                    type="button"
                    onClick={() => {
                      const reason = window.prompt("Motivo del reverso");
                      if (reason) void act(() => reversePayment(p.id, reason), "Pago revertido.");
                    }}
                  >
                    Revertir
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Box>
  );
}

/** /fiado — cartera de créditos (admin y operador). */
export function CreditsPage() {
  const credits = useLoad(() => fetchCredits(), []);
  const rows = credits.data ?? [];
  const pending = rows.filter((c) => c.status === "pending");
  const balance = pending.reduce((sum, c) => sum + c.balance, 0);
  const overdue = pending.filter((c) => c.due_date !== null && c.due_date < todayIso()).length;
  const paidCount = rows.filter((c) => c.status === "paid").length;

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">Cartera</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Fiado</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Los créditos se crean desde el detalle de un pedido entregado. Acá ves el saldo, los pagos y
        lo que está por vencer.
      </p>
      <Status loading={credits.loading} error={credits.error} />

      {credits.data !== null && rows.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <article className="relative overflow-hidden rounded-2xl bg-gray-900 p-4 text-white shadow-sm">
            <div className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-gray-400">
              Saldo pendiente
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{formatCOP(balance)}</p>
            <p className="mt-1 text-xs text-gray-400">
              {pending.length} {pending.length === 1 ? "crédito activo" : "créditos activos"}
            </p>
          </article>
          <article className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-gray-400">
              Vencidos
            </p>
            <p
              className={`mt-2 text-2xl font-semibold tracking-tight ${
                overdue > 0 ? "text-red-700" : "text-gray-900"
              }`}
            >
              {overdue}
            </p>
            <p className="mt-1 text-xs text-gray-500">Requieren seguimiento</p>
          </article>
          <article className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-gray-400">
              Pagados
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">{paidCount}</p>
            <p className="mt-1 text-xs text-gray-500">Créditos cerrados</p>
          </article>
        </div>
      )}

      {credits.data?.length === 0 && !credits.loading && (
        <div className="mt-4">
          <EmptyState
            title="No hay créditos"
            hint="Cuando confirmes la entrega de un pedido, vas a poder crear su fiado desde el detalle."
          />
        </div>
      )}

      {rows.map((c) => (
        <CreditCard key={c.id} credit={c} onChanged={credits.reload} />
      ))}
    </section>
  );
}
