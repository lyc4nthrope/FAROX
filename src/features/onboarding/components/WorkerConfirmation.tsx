export interface WorkerConfirmationProps {
  onAck: () => void;
}

// Presentacional pura: terminal [Trabajo en tienda] — pantalla PASIVA, sin
// ningún request (spec S-D3.C). El usuario entra a la app con scope vacío y
// la señal la pone el admin luego con assign_user_stores (admin-only,
// 0011:143-159). Como no hay señal persistente, la próxima vez que inicie
// sesión sin tiendas la pregunta vuelve a aparecer — RE-PREGUNTAR ES DESEADO
// (S-D3.C); el ack del botón vale solo para ESTA sesión.
export function WorkerConfirmation({ onAck }: WorkerConfirmationProps) {
  return (
    <section className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold tracking-tight">Trabajo en tienda</h1>
      <p className="mt-4 text-sm text-gray-700">
        No hace falta que crees nada: un administrador te va a asignar las tiendas a las que
        pertenecés. Hasta entonces no vas a ver pedidos ni stock.
      </p>
      <div className="mt-6">
        <button
          type="button"
          onClick={onAck}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Entendido
        </button>
      </div>
    </section>
  );
}
