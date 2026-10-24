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

/** /tiendas/:storeId/qr — QR de vínculo de la tienda (dueño o admin). */
export function StoreQrPage() {
  const storeId = Number(useParams().storeId);
  const code = useLoad(() => getLinkCode(storeId), [storeId]);
  const links = useLoad(() => fetchLinkedDistributors(storeId), [storeId]);
  const [image, setImage] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({ error: null, ok: null });

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

  async function act(action: () => Promise<{ error: { message: string } | null }>, ok: string) {
    const error = await runAction(action);
    setMsg({ error, ok: error === null ? ok : null });
    if (error === null) {
      code.reload();
      links.reload();
    }
  }

  return (
    <section>
      <p>
        <Link className="underline" to={`/inventario/${storeId}`}>
          ← Inventario de la tienda
        </Link>
      </p>
      <h1 className="text-xl font-semibold">QR de vínculo — tienda #{storeId}</h1>
      <Status error={msg.error ?? code.error} ok={msg.ok} />
      <Box title="Código para el distribuidor">
        <p className="text-sm">
          El distribuidor escanea este QR con la cámara del celular (abre la app y lo vincula) o escribe el código en
          “Vincular tienda”.
        </p>
        <Status loading={code.loading} />
        {image && <img src={image} alt="Código QR de vínculo de la tienda" width={280} height={280} />}
        {code.data && (
          <p className="mt-2 font-mono text-lg" aria-label="Código de vínculo">
            {code.data}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <button className={buttonClass} type="button" onClick={() => window.print()}>
            Imprimir
          </button>
          <button
            className={buttonClass}
            type="button"
            onClick={() => {
              if (window.confirm("¿Generar un código nuevo? El QR anterior dejará de servir."))
                void act(() => regenerateLinkCode(storeId), "Código regenerado.");
            }}
          >
            Regenerar código
          </button>
        </div>
      </Box>
      <Box title="Distribuidores vinculados">
        <Status loading={links.loading} error={links.error} />
        {links.data?.length === 0 && <p>Ningún distribuidor vinculado todavía.</p>}
        <ul className="list-disc pl-5 text-sm">
          {links.data?.map((l) => (
            <li key={l.distributor_id}>
              {l.name} — desde {new Date(l.created_at).toLocaleDateString("es-CO")}
              <button
                className={`${buttonClass} ml-2`}
                type="button"
                onClick={() => {
                  if (window.confirm(`¿Desvincular a ${l.name}?`))
                    void act(() => unlinkDistributor(storeId, l.distributor_id), "Distribuidor desvinculado.");
                }}
              >
                Desvincular
              </button>
            </li>
          ))}
        </ul>
      </Box>
    </section>
  );
}

/** /vincular y /vincular/:code — el distribuidor se vincula a una tienda. */
export function LinkStorePage() {
  const { code: codeParam } = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(codeParam ?? "");
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({ error: null, ok: null });
  const [busy, setBusy] = useState(false);
  const autoTried = useRef(false);

  async function link(value: string) {
    setBusy(true);
    const error = await runAction(() => linkToStore(value.trim()));
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
        <p className="text-sm">Escaneá el QR de la tienda con la cámara del celular, o escribí el código.</p>
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
