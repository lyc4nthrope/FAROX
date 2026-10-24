import { useState } from "react";

import { useAuth } from "../../app/providers/AuthProvider";
import { useLoad } from "../hooks/useLoad";
import { supabase } from "../lib/supabase/client";
import { buttonClass, runAction, Status } from "./Box";

type ReactivatableTable = "products" | "stores" | "distributors";

/**
 * C0.2: aviso de registro inactivo con botón "Reactivar" (solo admin).
 * Reactivar = UPDATE is_active = true; 0 filas afectadas ⇒ 42501 (sin éxito falso).
 * Para tiendas, el tope por usuario lo sigue validando el trigger de la BD.
 */
export function ReactivateBanner({ table, id }: { table: ReactivatableTable; id: number }) {
  const { role } = useAuth();
  const state = useLoad(async () => {
    const { data, error } = await supabase.from(table).select("is_active").eq("id", id).maybeSingle();
    return { data: data === null ? null : (data as { is_active: boolean }).is_active, error };
  }, [table, id]);
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({ error: null, ok: null });

  if (state.data !== false) return msg.ok ? <Status ok={msg.ok} /> : null;

  async function onReactivate() {
    const error = await runAction(async () => {
      const { data, error: updateError } = await supabase
        .from(table)
        .update({ is_active: true })
        .eq("id", id)
        .select("id");
      if (updateError) return { error: updateError };
      if (!Array.isArray(data) || data.length === 0) {
        return { error: { message: "permission denied (0 rows affected)", code: "42501" } };
      }
      return { error: null };
    });
    setMsg({ error, ok: error === null ? "Registro reactivado." : null });
    if (error === null) state.reload();
  }

  return (
    <div role="status" className="my-3 rounded border border-amber-400 bg-amber-50 p-3 text-sm">
      Este registro está <strong>inactivo</strong>: no aparece para operar.
      {role === "admin" && (
        <button className={`${buttonClass} ml-2`} type="button" onClick={() => void onReactivate()}>
          Reactivar
        </button>
      )}
      <Status error={msg.error} />
    </div>
  );
}
