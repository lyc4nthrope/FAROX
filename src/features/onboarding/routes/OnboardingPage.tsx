import { useState } from "react";

import { useAuth } from "../../../app/providers/AuthProvider";
import { OnboardingQuestion } from "../components/OnboardingQuestion";
import type { OnboardingStep } from "../types";
import { DistributorTerminal } from "./DistributorTerminal";
import { MyStoreTerminal } from "./MyStoreTerminal";
import { WorkerTerminal } from "./WorkerTerminal";

// Contenedor de /onboarding (T2.3–T2.6 · design #538 §5.2 árbol): máquina de
// pasos de la pregunta de 2 niveles y sus 3 terminales. El paso "role" es el
// nivel 1; "store" el nivel 2 (solo tras elegir Tienda + Seleccionar); y los
// 3 pasos terminales son las pantallas de alta/confirmación. Cada terminal
// navega a "/" por su cuenta tras producir su señal (o su ack de sesión);
// el guard derivado (OnboardingGate) es el que impide que la pregunta vuelva.
// Sin chrome de app: la ruta /onboarding vive FUERA del AppShell, así que
// este componente es la página completa (pantallas full-screen propias).
export function OnboardingPage() {
  const [step, setStep] = useState<OnboardingStep>("role");
  const { signOut } = useAuth();

  const volverALaPregunta = (): void => setStep("role");

  // MISMO camino de [Salir] del AppShell: AuthProvider.signOut compartido —
  // sin el header del shell, esta salida discreta evita quedar atrapado.
  const cerrarSesion = (): void => {
    void signOut();
  };

  if (step === "distributor" || step === "my-store" || step === "worker") {
    return (
      <main className="min-h-screen bg-white px-4 py-6 text-gray-900">
        {step === "distributor" && <DistributorTerminal onBack={volverALaPregunta} />}
        {step === "my-store" && <MyStoreTerminal onBack={volverALaPregunta} />}
        {step === "worker" && <WorkerTerminal />}
      </main>
    );
  }

  return (
    // key={step}: al cambiar de nivel (o volver de una terminal) la pregunta
    // REMONTA con la selección efímera vacía — nunca arrastra una selección
    // de otro nivel.
    <OnboardingQuestion
      key={step}
      step={step}
      onConfirmDistributor={() => setStep("distributor")}
      onConfirmStore={() => setStep("store")}
      onConfirmMyStore={() => setStep("my-store")}
      onConfirmWorker={() => setStep("worker")}
      onBack={volverALaPregunta}
      onSignOut={cerrarSesion}
    />
  );
}
