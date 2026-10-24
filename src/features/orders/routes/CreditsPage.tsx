import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { Badge, Box, Field, Status, buttonClass, inputClass, runAction } from "../../../shared/ui/Box";
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

function CreditCard({ credit, onChanged }: { credit: CreditRow; onChanged: () => void }) {
  const { role } = useAuth();
  const payments = useLoad(() => fetchPayments(credit.id), [credit.id]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({ error: null, ok: null });

  async function act(action: () => Promise<{ error: { message: string } | null }>, ok: string) {
    const error = await runAction(action);
    setMsg({ error, ok: error === null ? ok : null });
    if (error === null) {
      payments.reload();
      onChanged();
    }
  }

  return (
    <Box title={`Crédito #${credit.id} — ${credit.store_name}`}>
      <p className="text-sm">
        Pedido{" "}
        <Link className="underline" to={`/pedidos/${credit.order_id}`}>
          #{credit.order_id}
        </Link>{" "}
        · Total {formatCOP(credit.total_amount)} · Saldo <strong>{formatCOP(credit.balance)}</strong>{" "}
        <Badge tone={credit.status === "paid" ? "green" : credit.status === "cancelled" ? "gray" : "amber"}>
          {CREDIT_LABELS[credit.status] ?? credit.status}
        </Badge>
        {credit.due_date && ` · vence ${credit.due_date}`}
      </p>
      <Status error={msg.error ?? payments.error} ok={msg.ok} />
      {credit.status === "pending" && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label="Monto">
            <input className={inputClass} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Medio">
            <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value)}>
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
              if (Number(amount) > 0) void act(() => registerPayment(credit.id, Number(amount), method), "Pago registrado.");
            }}
          >
            Registrar pago
          </button>
          {role === "admin" && (
            <button
              className={buttonClass}
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
      )}
      <ul className="mt-2 list-disc pl-5 text-sm">
        {payments.data?.map((p) => (
          <li key={p.id}>
            {new Date(p.paid_at).toLocaleDateString("es-CO")}: {formatCOP(p.amount)} ({p.payment_method})
            {p.reverso_of_id !== null && ` — reverso de #${p.reverso_of_id}`}
            {role === "admin" && p.reverso_of_id === null && (
              <button
                className={`${buttonClass} ml-2`}
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
    </Box>
  );
}

/** /fiado — cartera de créditos (admin y operador). */
export function CreditsPage() {
  const credits = useLoad(() => fetchCredits(), []);
  return (
    <section>
      <h1 className="text-xl font-semibold">Fiado</h1>
      <p className="text-sm text-gray-600">Los créditos se crean desde el detalle de un pedido entregado.</p>
      <Status loading={credits.loading} error={credits.error} />
      {credits.data?.length === 0 && <p>No hay créditos.</p>}
      {credits.data?.map((c) => (
        <CreditCard key={c.id} credit={c} onChanged={credits.reload} />
      ))}
    </section>
  );
}
