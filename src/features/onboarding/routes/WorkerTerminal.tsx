import { useNavigate } from "react-router-dom";

import { WorkerConfirmation } from "../components/WorkerConfirmation";
import { useOnboarding } from "../context";

// Contenedor de la terminal [Trabajo en tienda] (S-D3.C · T2.6): pantalla
// PASIVA — CERO llamadas de escritura (la asignación la hace el admin con
// assign_user_stores, admin-only 0011:143-159). El ack es SOLO de sesión:
// sin señal persistente, el guard vuelve a preguntar en los próximos logins
// hasta que el admin asigne tiendas (re-preguntar es deseado, S-D3.C).
export function WorkerTerminal() {
  const navigate = useNavigate();
  const { acknowledge } = useOnboarding();

  return (
    <WorkerConfirmation
      onAck={() => {
        acknowledge();
        navigate("/");
      }}
    />
  );
}
