import { useEffect, useState } from "react";

import { useLoad } from "../../../shared/hooks/useLoad";
import { mapError } from "../../../shared/lib/errors/mapError";
import { formatCOP } from "../../../shared/lib/format";
import { Badge, Box, Field, Status, buttonClass, inputClass } from "../../../shared/ui/Box";
import { fetchAdminPlans, fetchPlanVersions, previewPlanQuote, updatePlanPricing } from "../api";
import type { AdminPlan, PlanPreview } from "../types";

interface FormState {
  amount: string;
  taxRate: string;
  taxIncluded: boolean;
  mpFee: string;
  mpFeeFixed: string;
  mpFeeTax: string;
  active: boolean;
}

function centsFromInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
}

function bpsFromInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0;
}

function formFromPlan(plan: AdminPlan): FormState {
  return {
    amount: String(plan.amountCents / 100),
    taxRate: String(plan.taxRateBps / 100),
    taxIncluded: plan.taxIncluded,
    mpFee: String(plan.mpFeeBps / 100),
    mpFeeFixed: String(plan.mpFeeFixedCents / 100),
    mpFeeTax: String(plan.mpFeeTaxBps / 100),
    active: plan.active,
  };
}

function PreviewRows({ preview }: { preview: PlanPreview }) {
  return (
    <dl className="space-y-1.5 text-sm">
      <div className="flex justify-between gap-3">
        <dt className="text-gray-500">Precio final</dt>
        <dd className="font-medium tabular-nums text-gray-900">
          {formatCOP(preview.finalCents / 100)}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-gray-500">Base</dt>
        <dd className="tabular-nums text-gray-900">{formatCOP(preview.baseCents / 100)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-gray-500">IVA</dt>
        <dd className="tabular-nums text-gray-900">{formatCOP(preview.taxCents / 100)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-gray-500">Comisión MP</dt>
        <dd className="tabular-nums text-gray-900">{formatCOP(preview.mpFeeCents / 100)}</dd>
      </div>
      <div className="flex justify-between gap-3 border-t border-gray-100 pt-1.5">
        <dt className="font-medium text-gray-700">Neto FAROX</dt>
        <dd className="font-medium tabular-nums text-gray-900">
          {formatCOP(preview.netCents / 100)}
        </dd>
      </div>
    </dl>
  );
}

/** F5: panel admin de planes, precios versionados y preview del desglose. */
export function PremiumPlansAdminPage() {
  const plans = useLoad(fetchAdminPlans, []);
  const [selectedCode, setSelectedCode] = useState("");
  const selectedPlan =
    plans.data?.find((plan) => plan.code === selectedCode) ?? plans.data?.[0] ?? null;
  const versions = useLoad(async () => {
    if (selectedPlan === null) return { data: [], error: null };
    return fetchPlanVersions(selectedPlan.id);
  }, [selectedPlan?.id]);
  const [form, setForm] = useState<FormState | null>(null);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });

  useEffect(() => {
    if (selectedPlan === null) {
      setForm(null);
      setPreview(null);
      return;
    }
    setForm(formFromPlan(selectedPlan));
    setPreview(null);
  }, [selectedPlan]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((previous) => (previous === null ? previous : { ...previous, [key]: value }));
  }

  function draftInput(): {
    amountCents: number;
    taxRateBps: number;
    taxIncluded: boolean;
    mpFeeBps: number;
    mpFeeFixedCents: number;
    mpFeeTaxBps: number;
  } | null {
    if (form === null) return null;
    return {
      amountCents: centsFromInput(form.amount),
      taxRateBps: bpsFromInput(form.taxRate),
      taxIncluded: form.taxIncluded,
      mpFeeBps: bpsFromInput(form.mpFee),
      mpFeeFixedCents: centsFromInput(form.mpFeeFixed),
      mpFeeTaxBps: bpsFromInput(form.mpFeeTax),
    };
  }

  async function runPreview(): Promise<void> {
    const draft = draftInput();
    if (draft === null) return;
    setPreviewing(true);
    setMsg({ error: null, ok: null });
    const result = await previewPlanQuote(draft);
    setPreviewing(false);
    if (result.error !== null) {
      setMsg({ error: mapError(result.error), ok: null });
      return;
    }
    setPreview(result.preview);
    setMsg({ error: null, ok: "Desglose calculado con los valores del formulario." });
  }

  async function save(): Promise<void> {
    if (selectedPlan === null || form === null) return;
    const draft = draftInput();
    if (draft === null) return;
    setSaving(true);
    setMsg({ error: null, ok: null });
    const result = await updatePlanPricing({
      code: selectedPlan.code,
      ...draft,
      // La comisión se descuenta del recaudo; el fee al cliente no está
      // implementado y quote_plan lo rechazaría.
      feePassedToCustomer: false,
      active: form.active,
    });
    setSaving(false);
    if (result.error !== null) {
      setMsg({ error: mapError(result.error), ok: null });
      return;
    }
    setMsg({
      error: null,
      ok: `Precio guardado. Se creó la versión ${result.version ?? "nueva"}.`,
    });
    plans.reload();
    versions.reload();
  }

  return (
    <section>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
        Administración
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Planes y precios</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        El precio nuevo aplica a nuevas suscripciones. Las existentes conservan su precio y el monto
        ya autorizado en Mercado Pago; no se actualizan en silencio.
      </p>

      <Status loading={plans.loading} error={plans.error} />
      <Status error={msg.error} ok={msg.ok} />

      {plans.data !== null && plans.data.length > 0 && selectedPlan !== null && form !== null && (
        <>
          <div className="mt-4 max-w-xs">
            <Field label="Plan">
              <select
                className={inputClass}
                value={selectedPlan.code}
                onChange={(event) => {
                  setSelectedCode(event.target.value);
                  setMsg({ error: null, ok: null });
                }}
              >
                {plans.data.map((plan) => (
                  <option key={plan.code} value={plan.code}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Box title="Editar precio">
              <div className="space-y-3">
                <Field label="Precio final (COP)">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(event) => update("amount", event.target.value)}
                  />
                </Field>
                <Field label="IVA (%)">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.taxRate}
                    onChange={(event) => update("taxRate", event.target.value)}
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-gray-900"
                    checked={form.taxIncluded}
                    onChange={(event) => update("taxIncluded", event.target.checked)}
                  />
                  El precio final ya incluye IVA
                </label>
                <Field label="Comisión Mercado Pago (%)">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.mpFee}
                    onChange={(event) => update("mpFee", event.target.value)}
                  />
                </Field>
                <Field label="Comisión fija (COP)">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.mpFeeFixed}
                    onChange={(event) => update("mpFeeFixed", event.target.value)}
                  />
                </Field>
                <Field label="IVA de la comisión (%)">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.mpFeeTax}
                    onChange={(event) => update("mpFeeTax", event.target.value)}
                  />
                </Field>
                <p className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600">
                  La comisión de Mercado Pago se descuenta del recaudo; no se suma al precio. El
                  cobro al cliente queda desactivado.
                </p>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-gray-900"
                    checked={form.active}
                    onChange={(event) => update("active", event.target.checked)}
                  />
                  Plan activo para nuevas suscripciones
                </label>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    className={buttonClass}
                    type="button"
                    disabled={previewing}
                    onClick={() => void runPreview()}
                  >
                    {previewing ? "Calculando…" : "Previsualizar"}
                  </button>
                  <button
                    className={buttonClass}
                    type="button"
                    disabled={saving}
                    onClick={() => void save()}
                  >
                    {saving ? "Guardando…" : "Guardar y crear versión"}
                  </button>
                </div>
              </div>
            </Box>

            <Box title="Desglose del borrador">
              {preview === null ? (
                <p className="text-sm text-gray-500">
                  Usá «Previsualizar» para ver el precio final, IVA, comisión y neto con estos
                  valores.
                </p>
              ) : (
                <PreviewRows preview={preview} />
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <Badge tone={selectedPlan.active ? "green" : "gray"}>
                  {selectedPlan.active ? "Activo" : "Inactivo"}
                </Badge>
                <span>Versión actual: {selectedPlan.version}</span>
              </div>
            </Box>
          </div>

          <div className="mt-6">
            <Box title="Historial de versiones">
              <Status loading={versions.loading} error={versions.error} />
              {versions.data !== null && versions.data.length === 0 && (
                <p className="text-sm text-gray-500">Sin versiones registradas.</p>
              )}
              {versions.data !== null && versions.data.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                        <th className="py-2 pr-3 font-medium">Versión</th>
                        <th className="py-2 pr-3 font-medium">Precio</th>
                        <th className="py-2 pr-3 font-medium">IVA</th>
                        <th className="py-2 pr-3 font-medium">Comisión</th>
                        <th className="py-2 font-medium">Vigente desde</th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.data.map((version) => (
                        <tr
                          key={version.version}
                          className="border-b border-gray-100 last:border-0"
                        >
                          <td className="py-2 pr-3 tabular-nums text-gray-900">
                            v{version.version}
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-gray-900">
                            {formatCOP(version.amountCents / 100)}
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-gray-700">
                            {(version.taxRateBps / 100).toFixed(2)}%
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-gray-700">
                            {(version.mpFeeBps / 100).toFixed(2)}% +{" "}
                            {formatCOP(version.mpFeeFixedCents / 100)}
                          </td>
                          <td className="py-2 text-gray-600">
                            {new Date(version.validFrom).toLocaleDateString("es-CO")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Box>
          </div>
        </>
      )}

      {plans.data !== null && plans.data.length === 0 && (
        <p className="mt-4 text-sm text-gray-600">No hay planes configurados.</p>
      )}
    </section>
  );
}
