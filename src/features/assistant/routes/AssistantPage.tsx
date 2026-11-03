import { useState, type FormEvent } from "react";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { mapError } from "../../../shared/lib/errors/mapError";
import { Status, buttonClass, inputClass } from "../../../shared/ui/Box";
import { fetchDistributorStores, fetchMyStores } from "../../inventory/api";
import {
  askAgent,
  createConversation,
  sendMessage,
  type AssistantMessage,
} from "../api";

const SUGGESTIONS: readonly string[] = [
  "¿Cuánto hay de arroz?",
  "¿Hace cuánto no se pide café?",
  "Buscá leche",
  "¿Cuánto stock hay de panela?",
];

/**
 * /asistente — fase 1: solo consultas (stock y último pedido por producto).
 * La privacidad la resuelve la RLS: el mismo endpoint atiende a todos, pero
 * cada herramienta corre con el JWT del usuario.
 */
export function AssistantPage() {
  const { role } = useAuth();
  const stores = useLoad(
    () => (role === "distribuidor" ? fetchDistributorStores() : fetchMyStores(role === "admin")),
    [role],
  );

  const [storeId, setStoreId] = useState("");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetConversation(nextStore = storeId): void {
    setStoreId(nextStore);
    setConversationId(null);
    setMessages([]);
    setError(null);
  }

  async function send(raw: string): Promise<void> {
    const content = raw.trim();
    if (content === "" || sending) return;
    setSending(true);
    setError(null);
    setInput("");
    setMessages((current) => [
      ...current,
      { id: -Date.now(), role: "user", content, created_at: new Date().toISOString() },
    ]);

    let id = conversationId;
    if (id === null) {
      const created = await createConversation({
        title: content.slice(0, 60),
        storeId: storeId === "" ? null : Number(storeId),
      });
      if (created.error !== null) {
        setError(mapError(created.error));
        setSending(false);
        return;
      }
      if (created.data === null) {
        setError("No pude iniciar la conversación.");
        setSending(false);
        return;
      }
      id = created.data;
      setConversationId(id);
    }

    const sent = await sendMessage(id, content);
    if (sent.error !== null) {
      setError(mapError(sent.error));
      setSending(false);
      return;
    }

    const answer = await askAgent({ conversationId: id, message: content });
    setSending(false);
    if (answer.error !== null) {
      setError(answer.error);
      return;
    }
    setMessages((current) => [
      ...current,
      {
        id: -Date.now() - 1,
        role: "assistant",
        content: answer.reply ?? "",
        created_at: new Date().toISOString(),
      },
    ]);
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    void send(input);
  }

  const visible = messages.filter((message) => message.role !== "tool");

  return (
    <section className="mx-auto max-w-3xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Asistente
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Asistente</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Preguntá por stock o por el último pedido de un producto. Solo ves los datos de tu
        alcance.
      </p>

      <Status loading={stores.loading} error={stores.error} />
      {(stores.data?.length ?? 0) > 0 && (
        <label className="mt-4 flex max-w-xs flex-col gap-1.5 text-sm">
          <span className="text-xs font-semibold tracking-wide text-gray-600">
            Tienda (opcional)
          </span>
          <select
            className={`${inputClass} w-full`}
            value={storeId}
            onChange={(event) => resetConversation(event.target.value)}
          >
            <option value="">Todas</option>
            {stores.data?.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="mt-4 flex h-[60vh] min-h-[22rem] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {visible.length === 0 ? (
            <div>
              <p className="text-sm text-gray-500">
                Escribí una consulta o probá con un ejemplo:
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                    disabled={sending}
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            visible.map((message) => (
              <div
                key={message.id}
                data-role={message.role}
                className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm ${
                  message.role === "user"
                    ? "ml-auto bg-gray-900 text-white"
                    : "mr-auto bg-gray-100 text-gray-900"
                }`}
              >
                {message.content}
              </div>
            ))
          )}
          {sending && (
            <p role="status" className="mr-auto text-xs text-gray-500">
              Pensando…
            </p>
          )}
        </div>

        <form className="border-t border-gray-100 p-3" onSubmit={onSubmit}>
          <Status error={error} />
          <div className="flex items-end gap-2">
            <input
              className={`${inputClass} w-full`}
              aria-label="Consulta para el asistente"
              placeholder="Ej.: ¿cuánto hay de arroz?"
              value={input}
              maxLength={800}
              disabled={sending}
              onChange={(event) => setInput(event.target.value)}
            />
            <button
              className={buttonClass}
              type="submit"
              disabled={sending || input.trim() === ""}
            >
              {sending ? "Enviando…" : "Enviar"}
            </button>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-[11px] text-gray-500">
              Solo consultas por ahora. Las ventas y compras se registran desde Inventario.
            </p>
            {conversationId !== null && (
              <button
                type="button"
                className="shrink-0 text-xs font-medium text-gray-500 transition hover:text-gray-900"
                onClick={() => resetConversation()}
              >
                Nueva conversación
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
