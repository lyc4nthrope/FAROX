import { AssistantChat } from "../components/AssistantChat";

/**
 * /asistente — versión de pantalla completa del chat. El widget flotante usa
 * el mismo componente, así que la lógica y el alcance son idénticos.
 */
export function AssistantPage() {
  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Asistente</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Preguntá por stock o por el último pedido de un producto. Solo ves los datos de tu
        alcance.
      </p>

      <div className="mt-4 flex h-[60vh] min-h-[22rem] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <AssistantChat />
      </div>
    </section>
  );
}
