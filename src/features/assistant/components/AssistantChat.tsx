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
];

/**
 * Chat del asistente, compartido por /asistente y el widget flotante.
 * La privacidad la resuelve la RLS: el mismo endpoint atiende a todos, pero
 * cada herramienta corre con el JWT del usuario.
 */
export function AssistantChat({ compact = false }: { compact?: boolean }) {
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
  // Se lee en cada render para que el valor de entorno se pueda cambiar sin
  // reimportar el módulo (tests y despliegues con distinta configuración).
  const whatsappNumber = String(import.meta.env.VITE_WHATSAPP_AGENT_NUMBER ?? "").replace(
    /\D/g,
    "",
  );
  const whatsappHref =
    whatsappNumber === ""
      ? null
      : `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
          "Hola, quiero consultar por mi inventario en FARØX.",
        )}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        {(stores.data?.length ?? 0) > 0 && (
          <label className="min-w-0 flex-1">
            <span className="sr-only">Tienda (opcional)</span>
            <select
              className={`${inputClass} w-full px-2 py-1 text-xs`}
              value={storeId}
              onChange={(event) => resetConversation(event.target.value)}
            >
              <option value="">Todas las tiendas</option>
              {stores.data?.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {whatsappHref !== null && (
          <a
            className="ml-auto shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100"
            href={whatsappHref}
            target="_blank"
            rel="noreferrer"
            aria-label="Abrir el asistente en WhatsApp"
          >
            WhatsApp ↗
          </a>
        )}
      </div>

      <Status loading={stores.loading} error={stores.error} />

      <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto ${compact ? "p-2" : "p-3"}`}>
        {visible.length === 0 ? (
          <div>
            <p className="text-sm text-gray-500">Preguntá por stock o por el último pedido:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50"
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
            Solo consultas por ahora.
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
  );
}
