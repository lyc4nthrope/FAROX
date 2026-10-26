import QRCode from "qrcode";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useLoad } from "../../../shared/hooks/useLoad";
import { EmptyState } from "../../../shared/ui";
import {
  Box,
  Field,
  Status,
  buttonClass,
  inputClass,
  runAction,
  secondaryButtonClass,
} from "../../../shared/ui/Box";
import {
  fetchLinkedDistributors,
  getLinkCode,
  linkToStore,
  linkUrl,
  regenerateLinkCode,
  unlinkDistributor,
} from "../api";
import { QrScanner } from "../components/QrScanner";
import { parseLinkCode } from "../scan";

/** Código + QR + distribuidores vinculados de UNA tienda. */
export function StoreLinkPanel({ storeId }: { storeId: number }) {
  const code = useLoad(() => getLinkCode(storeId), [storeId]);
  const links = useLoad(() => fetchLinkedDistributors(storeId), [storeId]);
  const [image, setImage] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(true);
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });

  useEffect(() => {
    if (!code.data) return;
    let cancelled = false;
    void QRCode.toDataURL(linkUrl(code.data), { width: 280, margin: 2 }).then((url) => {
      if (!cancelled) setImage(url);
    });
    return () => {
      cancelled = true;
    };
  }, [code.data]);

  // Sin vínculos el código es la acción principal; con vínculos queda plegado
  // detrás de “Vincular otro distribuidor”.
  useEffect(() => {
    if (!links.loading && links.data !== null) setShowCode(links.data.length === 0);
  }, [links.loading, links.data]);

  async function act(action: () => Promise<{ error: { message: string } | null }>, ok: string) {
    const error = await runAction(action);
    setMsg({ error, ok: error === null ? ok : null });
    if (error === null) {
      code.reload();
      links.reload();
    }
  }

  // Sin vínculos el código es la acción principal; con vínculos queda plegado
  // detrás de “Vincular otro distribuidor”.
  const hasLinks = links.data !== null && links.data.length > 0;

  return (
    <>
      <Status error={msg.error ?? code.error ?? links.error} ok={msg.ok} />
      <Box title="Distribuidores vinculados">
        <Status loading={links.loading} />
        {links.data?.length === 0 && (
          <EmptyState
            title="Todavía no vinculaste ningún distribuidor"
            hint="Generá el código de abajo y compartilo: en cuanto lo escanee, aparece en esta lista."
          />
        )}
        {links.data !== null && links.data.length > 0 && (
          <ul className="grid gap-2">
            {links.data.map((l) => (
              <li
                key={l.distributor_id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 text-sm shadow-sm"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-xs font-semibold text-white">
                  {l.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-gray-900">{l.name}</span>
                  <span className="text-xs text-gray-500">
                    desde {new Date(l.created_at).toLocaleDateString("es-CO")}
                  </span>
                </span>
                <Link
                  className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-gray-900"
                  to={`/pedidos/nuevo?storeId=${storeId}&distributorId=${l.distributor_id}`}
                >
                  Solicitar productos
                </Link>
                <button
                  className={`${secondaryButtonClass} px-2.5 py-1.5 text-xs`}
                  type="button"
                  onClick={() => {
                    if (window.confirm(`¿Desvincular a ${l.name}?`))
                      void act(
                        () => unlinkDistributor(storeId, l.distributor_id),
                        "Distribuidor desvinculado.",
                      );
                  }}
                >
                  Desvincular
                </button>
              </li>
            ))}
          </ul>
        )}
        {links.data !== null && links.data.length > 0 && (
          <button
            className={`${secondaryButtonClass} mt-3`}
            type="button"
            onClick={() => setShowCode((value) => !value)}
          >
            {showCode ? "Ocultar código" : "Vincular otro distribuidor"}
          </button>
        )}
      </Box>
      {showCode && (
        <Box
          title={hasLinks ? "Código para vincular otro distribuidor" : "Vinculá algún distribuidor"}
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_1fr]">
            <div className="mx-auto w-full max-w-xs rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                QR de vínculo
              </p>
              <div className="mt-3 flex justify-center rounded-xl bg-gray-50 p-3">
                {image ? (
                  <img
                    src={image}
                    alt="Código QR de vínculo de la tienda"
                    width={280}
                    height={280}
                    className="h-auto w-full max-w-56"
                  />
                ) : (
                  <div className="h-48 w-48 animate-pulse rounded-lg bg-gray-100" />
                )}
              </div>
              <Status loading={code.loading} />
              {code.data && (
                <p
                  className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 py-2 text-center font-mono text-base tracking-[0.14em] text-gray-900"
                  aria-label="Código de vínculo"
                >
                  {code.data}
                </p>
              )}
              <div className="mt-3 flex flex-col gap-2">
                <button className={buttonClass} type="button" onClick={() => window.print()}>
                  Imprimir
                </button>
                <button
                  className={secondaryButtonClass}
                  type="button"
                  onClick={() => {
                    if (
                      !hasLinks ||
                      window.confirm("¿Generar un código nuevo? El QR anterior dejará de servir.")
                    ) {
                      void act(
                        () => regenerateLinkCode(storeId),
                        hasLinks ? "Código regenerado." : "Código generado.",
                      );
                    }
                  }}
                >
                  {hasLinks ? "Generar código nuevo" : "Generar código"}
                </button>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                Así funciona el vínculo, en tres pasos:
              </p>
              <ol className="mt-3 space-y-3 text-sm text-gray-700">
                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white">
                    1
                  </span>
                  <span>Generá el código de tu tienda (abajo ya hay uno listo para usar).</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white">
                    2
                  </span>
                  <span>Compartí el QR o el código con el distribuidor.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white">
                    3
                  </span>
                  <span>
                    El distribuidor lo escanea desde “Vincular tienda” o escribe el código, y queda
                    vinculado al instante.
                  </span>
                </li>
              </ol>
              <p className="mt-4 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2 text-xs text-amber-900">
                Si generás un código nuevo, el anterior deja de servir: los ya vinculados siguen
                vinculados.
              </p>
            </div>
          </div>
        </Box>
      )}
    </>
  );
}

/** /tiendas/:storeId/qr — QR de vínculo de la tienda (dueño o admin). */
export function StoreQrPage() {
  const storeId = Number(useParams().storeId);
  return (
    <section>
      <Link
        to={`/inventario/${storeId}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 transition hover:text-gray-900"
      >
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Inventario de la tienda
      </Link>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Vínculos
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        QR de vínculo — tienda #{storeId}
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Compartí este código con tus distribuidores para que queden vinculados y puedan recibir
        pedidos.
      </p>
      <StoreLinkPanel storeId={storeId} />
    </section>
  );
}

/** /vincular y /vincular/:code — el distribuidor se vincula a una tienda. */
export function LinkStorePage() {
  const { code: codeParam } = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(codeParam ?? "");
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });
  const [busy, setBusy] = useState(false);
  const autoTried = useRef(false);

  async function link(value: string) {
    const parsed = parseLinkCode(value);
    if (parsed === null) {
      setMsg({
        error: "Ese código o QR no es válido. Escaneá el QR de la tienda o revisá el código.",
        ok: null,
      });
      return;
    }
    setCode(parsed);
    setBusy(true);
    const error = await runAction(() => linkToStore(parsed));
    setBusy(false);
    setMsg({ error, ok: error === null ? "¡Listo! Quedaste vinculado a la tienda." : null });
  }

  // Llegó desde el QR: vincula automáticamente una sola vez.
  useEffect(() => {
    if (codeParam && !autoTried.current) {
      autoTried.current = true;
      void link(codeParam);
    }
  }, [codeParam]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (code.trim() !== "") void link(code);
  }

  return (
    <section className="mx-auto max-w-xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">Vínculos</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Vincular tienda</h1>
      <p className="mt-1 text-sm text-gray-500">
        Escaneá el QR que te compartió la tienda o escribí el código para quedar vinculado.
      </p>
      <Status loading={busy} error={msg.error} ok={msg.ok} />
      <Box title="Código de la tienda">
        <p className="text-sm text-gray-600">
          Escaneá el QR de la tienda con el botón “Escanear QR”, o escribí el código manualmente.
        </p>
        <div className="mt-3">
          <QrScanner disabled={busy} onCode={(raw) => void link(raw)} />
        </div>
        <form className="mt-4" onSubmit={onSubmit}>
          <Field label="Código">
            <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <button className={buttonClass} type="submit" disabled={busy}>
            Vincular
          </button>
        </form>
        {msg.ok && (
          <button
            className={`${secondaryButtonClass} mt-2`}
            type="button"
            onClick={() => navigate("/pedidos")}
          >
            Ir a mis pedidos
          </button>
        )}
      </Box>
    </section>
  );
}
