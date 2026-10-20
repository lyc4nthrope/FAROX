import type { OnboardingStep } from "../types";

export interface OnboardingQuestionProps {
  // "role" = nivel 1 (¿Qué sos?); "store" = nivel 2 (sub-pregunta Tienda).
  step: Extract<OnboardingStep, "role" | "store">;
  onSelectDistributor: () => void;
  onSelectStore: () => void;
  onSelectMyStore: () => void;
  onSelectWorker: () => void;
  onBack: () => void;
}

const primaryButton =
  "rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700";
const secondaryButton =
  "rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";

// Presentacional pura: la pregunta de 2 niveles del onboarding v2
// (#527/#528 — design #538 §5.2 árbol). Nivel 1 "¿Qué sos?" define la rama;
// el nivel 2 solo aparece tras elegir [Tienda] (S-D3.0). El contenedor
// (routes/OnboardingPage) owns el estado del paso y renderiza la terminal
// correspondiente; acá SOLO se emiten las selecciones.
export function OnboardingQuestion({
  step,
  onSelectDistributor,
  onSelectStore,
  onSelectMyStore,
  onSelectWorker,
  onBack,
}: OnboardingQuestionProps) {
  if (step === "store") {
    return (
      <section className="mx-auto max-w-lg">
        <h1 className="text-xl font-semibold">¿Ya tenés tu tienda?</h1>
        <p className="mt-2 text-sm text-gray-600">
          Si tenés un negocio propio, creala ahora. Si trabajás en una tienda, un administrador
          te asigna las tiendas a las que pertenecés.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button type="button" className={primaryButton} onClick={onSelectMyStore}>
            Mi tienda
          </button>
          <button type="button" className={secondaryButton} onClick={onSelectWorker}>
            Trabajo en tienda
          </button>
        </div>
        <div className="mt-4">
          <button type="button" className="text-sm text-gray-600 hover:underline" onClick={onBack}>
            Volver
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold">¿Qué sos?</h1>
      <p className="mt-2 text-sm text-gray-600">Elegí la opción que mejor te describa.</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button type="button" className={primaryButton} onClick={onSelectDistributor}>
          Distribuidor
        </button>
        <button type="button" className={secondaryButton} onClick={onSelectStore}>
          Tienda
        </button>
      </div>
    </section>
  );
}
