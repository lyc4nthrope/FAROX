import { useState } from "react";

import { OnboardingQuestion } from "../components/OnboardingQuestion";
import type { OnboardingStep } from "../types";
import { DistributorTerminal } from "./DistributorTerminal";
import { MyStoreTerminal } from "./MyStoreTerminal";
import { WorkerTerminal } from "./WorkerTerminal";

// Contenedor de /onboarding (T2.3–T2.6 · design #538 §5.2 árbol): máquina de
// pasos de la pregunta de 2 niveles y sus 3 terminales. El paso "role" es el
// nivel 1 ("¿Qué sos?"); "store" el nivel 2 (solo tras elegir Tienda); y los
// 3 pasos terminales son las pantallas de alta/confirmación. Cada terminal
// navega a "/" por su cuenta tras producir su señal (o su ack de sesión);
// el guard derivado (OnboardingGate) es el que impide que la pregunta vuelva.
export function OnboardingPage() {
  const [step, setStep] = useState<OnboardingStep>("role");

  const volverALaPregunta = (): void => setStep("role");

  if (step === "distributor") {
    return <DistributorTerminal onBack={volverALaPregunta} />;
  }
  if (step === "my-store") {
    return <MyStoreTerminal onBack={volverALaPregunta} />;
  }
  if (step === "worker") {
    return <WorkerTerminal />;
  }

  return (
    <OnboardingQuestion
      step={step}
      onSelectDistributor={() => setStep("distributor")}
      onSelectStore={() => setStep("store")}
      onSelectMyStore={() => setStep("my-store")}
      onSelectWorker={() => setStep("worker")}
      onBack={volverALaPregunta}
    />
  );
}
