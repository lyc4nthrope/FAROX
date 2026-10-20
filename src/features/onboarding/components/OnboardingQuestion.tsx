import { useId, useRef, useState, type KeyboardEvent } from "react";

import type { OnboardingStep } from "../types";

export interface OnboardingQuestionProps {
  // "role" = nivel 1; "store" = nivel 2 (sub-pregunta Tienda). El contenedor
  // (routes/OnboardingPage) monta este componente con key={step}: cambiar de
  // nivel REMONTA y deja la selección efímera vacía.
  step: Extract<OnboardingStep, "role" | "store">;
  // onConfirm* se emiten SOLO al presionar [Seleccionar] con una selección
  // hecha: elegir una opción (clic o flechas) actualiza la selección y el
  // bloque superior, pero NO navega.
  onConfirmDistributor: () => void;
  onConfirmStore: () => void;
  onConfirmMyStore: () => void;
  onConfirmWorker: () => void;
  onBack: () => void;
  // Mismo camino de [Salir] del AppShell: AuthProvider.signOut compartido
  // (el contenedor lo pasa tal cual — sin chrome no hay header, así que esta
  // salida discreta evita quedar atrapado en el onboarding).
  onSignOut: () => void;
}

type RoleOptionId = "distribuidor" | "tienda";
type StoreOptionId = "mi-tienda" | "trabajo-en-tienda";
type QuestionOptionId = RoleOptionId | StoreOptionId;

interface QuestionOption {
  id: QuestionOptionId;
  label: string;
  // Texto del bloque superior cuando ESTA opción está seleccionada.
  selectedBody: string;
}

interface QuestionCopy {
  title: string;
  // Nombre accesible del radiogroup (legend visualmente oculta): conserva la
  // voz de la pregunta original ("¿Qué sos?" / "¿Ya tenés tu tienda?").
  groupLabel: string;
  // Texto del bloque superior SIN selección.
  idleBody: string;
  options: readonly QuestionOption[];
}

// Copy aprobado por el product owner (voseo, misma voz que el resto de la UI)
// — el bloque superior CAMBIA dinámicamente según la opción seleccionada.
const QUESTION_COPY: Record<Extract<OnboardingStep, "role" | "store">, QuestionCopy> = {
  role: {
    title: "Bienvenido a FAROX",
    groupLabel: "¿Qué sos?",
    idleBody:
      "FAROX conecta a los distribuidores con las tiendas para gestionar el catálogo de productos, los precios y los pedidos desde un solo lugar. Antes de empezar, contanos cómo vas a usar la plataforma.",
    options: [
      {
        id: "distribuidor",
        label: "Distribuidor",
        selectedBody:
          "Trabajás con productos y las tiendas te piden catálogo. Al continuar vas a registrar tu empresa como distribuidor en FAROX: nombre, NIT y datos de contacto. Ese registro queda asociado a tu cuenta y te habilita como rol distribuidor.",
      },
      {
        id: "tienda",
        label: "Tienda",
        selectedBody:
          "Tenés o trabajás en un negocio que vende al público. Al continuar vas a elegir si querés crear la tienda ahora, o si un administrador te va a asignar las tiendas donde trabajás.",
      },
    ],
  },
  store: {
    title: "Contanos sobre tu relación con la tienda",
    groupLabel: "¿Ya tenés tu tienda?",
    idleBody: "Esto define qué podés hacer desde hoy y qué necesita un administrador para habilitarte.",
    options: [
      {
        id: "mi-tienda",
        label: "Mi tienda",
        selectedBody:
          "Sos responsable del negocio. Vas a crear la tienda en FAROX con su nombre, tipo y ubicación. Queda asociada a tu cuenta como propietaria.",
      },
      {
        id: "trabajo-en-tienda",
        label: "Trabajo en tienda",
        selectedBody:
          "Trabajás en una tienda que ya existe. No tenés que crear nada: un administrador te va a asignar las tiendas a las que pertenecés. Vas a poder verlas apenas te habiliten.",
      },
    ],
  },
};

const optionButtonBase =
  "min-h-20 flex-1 rounded-lg border-2 px-6 py-6 text-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2";
const optionUnselected = "border-gray-300 bg-white text-gray-900 hover:border-gray-500";
const optionSelected = "border-gray-900 bg-gray-900 text-white";

// Presentacional de la pregunta de 2 niveles (onboarding full-screen v2).
// Sin chrome de app: pantalla propia (min-h-screen, columna centrada) con un
// BLOQUE superior dinámico, dos opciones GRANDES como grupo de radios (no dos
// acciones independientes — role=radiogroup, roving tabindex) y [Seleccionar]
// deshabilitado hasta elegir. El contenedor owns el paso; acá SOLO vive la
// selección efímera (se limpia al remontar por key={step}).
export function OnboardingQuestion({
  step,
  onConfirmDistributor,
  onConfirmStore,
  onConfirmMyStore,
  onConfirmWorker,
  onBack,
  onSignOut,
}: OnboardingQuestionProps) {
  const copy = QUESTION_COPY[step];
  const [selected, setSelected] = useState<QuestionOptionId | null>(null);
  const groupLabelId = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedOption = copy.options.find((option) => option.id === selected);
  const body = selectedOption?.selectedBody ?? copy.idleBody;

  function confirmar(): void {
    // El botón está deshabilitado sin selección; el default cubre ese caso
    // y NUNCA emite una confirmación sin opción elegida.
    switch (selected) {
      case "distribuidor":
        onConfirmDistributor();
        break;
      case "tienda":
        onConfirmStore();
        break;
      case "mi-tienda":
        onConfirmMyStore();
        break;
      case "trabajo-en-tienda":
        onConfirmWorker();
        break;
      default:
        break;
    }
  }

  // Radio group con activación automática (APG): las flechas MUEVEN el foco y
  // SELECCIONAN; Space/Enter sobre el <button> dispara el click nativo y
  // selecciona la opción enfocada.
  function moverSeleccion(event: KeyboardEvent<HTMLButtonElement>, desde: number): void {
    const ultimo = copy.options.length - 1;
    let hacia: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        hacia = desde === ultimo ? 0 : desde + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        hacia = desde === 0 ? ultimo : desde - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const option = copy.options[hacia];
    setSelected(option.id);
    optionRefs.current[hacia]?.focus();
  }

  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <section className="w-full max-w-lg">
          <h1 className="text-2xl font-semibold">{copy.title}</h1>
          <p className="mt-3 text-base leading-relaxed text-gray-600">{body}</p>
          <span id={groupLabelId} className="sr-only">
            {copy.groupLabel}
          </span>
          <div
            role="radiogroup"
            aria-labelledby={groupLabelId}
            className="mt-8 flex flex-col gap-3 sm:flex-row"
          >
            {copy.options.map((option, index) => {
              const isSelected = selected === option.id;
              return (
                <button
                  key={option.id}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  // Roving tabindex: UNA opción lleva el Tab (la seleccionada,
                  // o la primera si no hay selección).
                  tabIndex={
                    isSelected || (selected === null && index === 0) ? 0 : -1
                  }
                  onKeyDown={(event) => moverSeleccion(event, index)}
                  onClick={() => setSelected(option.id)}
                  className={`${optionButtonBase} ${
                    isSelected ? optionSelected : optionUnselected
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              disabled={selected === null}
              onClick={confirmar}
              className="rounded bg-gray-900 px-6 py-3 text-base font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Seleccionar
            </button>
            {step === "store" && (
              <button
                type="button"
                className="text-sm text-gray-600 hover:underline"
                onClick={onBack}
              >
                Volver
              </button>
            )}
          </div>
        </section>
      </main>
      <footer className="pb-6 text-center">
        <button
          type="button"
          className="text-sm text-gray-500 hover:underline"
          onClick={onSignOut}
        >
          Salir
        </button>
      </footer>
    </div>
  );
}
