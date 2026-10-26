import QRCode from "qrcode";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useLoad } from "../../../shared/hooks/useLoad";
import { Box, Field, Status, buttonClass, inputClass, runAction } from "../../../shared/ui/Box";
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
          <p className="text-sm">
            Todavía no vinculaste ningún distribuidor. Generá el código de abajo y compartilo: en
            cuanto lo escanee, aparece en esta lista.
          </p>
        )}
        {links.data !== null && links.data.length > 0 && (
          <ul className="divide-y divide-gray-100 text-sm">
            {links.data.map((l) => (
              <li key={l.distributor_id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium">{l.name}</span>
                <span className="text-gray-500">
                  desde {new Date(l.created_at).toLocaleDateString("es-CO")}
                </span>
                <Link
                  className="underline"
                  to={`/pedidos/nuevo?storeId=${storeId}&distributorId=${l.distributor_id}`}
                >
                  Solicitar productos
                </Link>
                <button
                  className={buttonClass}
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
            className={`${buttonClass} mt-3`}
            type="button"
            onClick={() => setShowCode((value) => !value)}
          >
            {showCode ? "Ocultar código" : "Vincular otro distribuidor"}
          </button>
        )}
      </Box>
      {showCode && (
        <Box title={hasLinks ? "Código para vincular otro distribuidor" : "Vinculá algún distribuidor"}>
          <p className="text-sm">Así funciona el vínculo, en tres pasos:</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-gray-700">
            <li>Generá el código de tu tienda (abajo ya hay uno listo para usar).</li>
            <li>Compartí el QR o el código con el distribuidor.</li>
            <li>
              El distribuidor lo escanea desde “Vincular tienda” o escribe el código, y queda
              vinculado al instante.
            </li>
          </ol>
          <p className="mt-1 text-sm text-gray-700">
            Si generás un código nuevo, el anterior deja de servir: los ya vinculados siguen
            vinculados.
          </p>
          <Status loading={code.loading} />
          {image && <img src={image} alt="Código QR de vínculo de la tienda" width={280} height={280} />}
          {code.data && (
            <p className="mt-2 font-mono text-lg" aria-label="Código de vínculo">
              {code.data}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button className={buttonClass} type="button" onClick={() => window.print()}>
              Imprimir
            </button>
            <button
              className={buttonClass}
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
      <p>
        <Link className="underline" to={`/inventario/${storeId}`}>
          ← Inventario de la tienda
        </Link>
      </p>
      <h1 className="text-xl font-semibold">QR de vínculo — tienda #{storeId}</h1>
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
    <section>
      <h1 className="text-xl font-semibold">Vincular tienda</h1>
      <Status loading={busy} error={msg.error} ok={msg.ok} />
      <Box title="Código de la tienda">
        <p className="text-sm">
          Escaneá el QR de la tienda con el botón “Escanear QR”, o escribí el código manualmente.
        </p>
        <QrScanner disabled={busy} onCode={(raw) => void link(raw)} />
        <form onSubmit={onSubmit}>
          <Field label="Código">
            <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <button className={buttonClass} type="submit" disabled={busy}>
            Vincular
          </button>
        </form>
        {msg.ok && (
          <button className={`${buttonClass} mt-2`} type="button" onClick={() => navigate("/pedidos")}>
            Ir a mis pedidos
          </button>
        )}
      </Box>
    </section>
  );
}
