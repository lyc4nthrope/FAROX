import { useEffect, useState } from "react";

import { useLoad } from "../../../shared/hooks/useLoad";
import { Box, Field, Status, buttonClass, inputClass, runAction } from "../../../shared/ui/Box";
import { fetchUsers } from "../../users/api";
import type { UserListRow } from "../../users/types";
import { transferStore } from "../api";

/** 0034: admin transfiere una tienda a otro operador/admin activo. */
export function TransferStorePanel({
  storeId,
  currentOwnerId,
  onTransferred,
}: {
  storeId: number;
  currentOwnerId: string | null;
  onTransferred: () => void;
}) {
  const users = useLoad<UserListRow[]>(async () => {
    const result = await fetchUsers({ page: 0, pageSize: 200 });
    return { data: result.rows, error: result.error };
  }, []);
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = (users.data ?? []).filter(
    (user) =>
      user.is_active &&
      user.id !== currentOwnerId &&
      (user.role_name === "operador" || user.role_name === "admin"),
  );

  useEffect(() => {
    if (selected === "" && candidates.length > 0) {
      setSelected(candidates[0].id);
    }
  }, [candidates, selected]);

  async function onTransfer(): Promise<void> {
    if (selected === "") {
      setError("Elegí el nuevo dueño.");
      return;
    }
    const confirmed = window.confirm(
      "¿Transferir la propiedad de esta tienda? El dueño anterior perderá el acceso y el nuevo dueño deberá respetar el tope de su plan.",
    );
    if (!confirmed) return;
    setSaving(true);
    setError(null);
    const result = await runAction(() => transferStore(storeId, selected));
    setSaving(false);
    if (result !== null) {
      setError(result);
      return;
    }
    onTransferred();
  }

  return (
    <div className="mt-6">
      <Box title="Transferir propiedad">
        <p className="text-sm text-gray-600">
          Movés la tienda a otro operador o administrador activo. El dueño anterior deja de verla;
          el nuevo dueño queda sujeto a su tope de tiendas.
        </p>
        <Status loading={users.loading} error={users.error} />
        {!users.loading && users.error === null && candidates.length === 0 && (
          <p className="mt-3 text-sm text-gray-500">
            No hay otro operador o administrador activo para transferir.
          </p>
        )}
        {candidates.length > 0 && (
          <>
            <Field label="Nuevo dueño">
              <select
                className={inputClass}
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                {candidates.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name} · {user.role_name}
                  </option>
                ))}
              </select>
            </Field>
            <Status error={error} />
            <button
              className={buttonClass}
              type="button"
              disabled={saving}
              onClick={() => void onTransfer()}
            >
              {saving ? "Transfiriendo…" : "Transferir tienda"}
            </button>
          </>
        )}
      </Box>
    </div>
  );
}
