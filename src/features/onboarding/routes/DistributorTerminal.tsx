import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { mapError } from "../../../shared/lib/errors/mapError";
import { registerDistributor } from "../api";
import { useOnboarding } from "../context";
import { DistributorRegistrationForm, type DistributorFormErrors } from "../components/DistributorRegistrationForm";
import { distributorSchema, type DistributorRegistrationValues } from "../schemas";

const EMPTY_VALUES: DistributorRegistrationValues = {
  name: "",
  nit: "",
  contact_name: "",
  phone: "",
  email: "",
  contact_preference: "whatsapp",
};

// Contenedor de la terminal [Distribuidor] (S-D3.A · T2.4): llama a la RPC
// register_distributor (design #538 §2.1 — NIT obligatorio, contacto
// opcional). Éxito ⇒ la RPC ya seteó users.role_id + distributor_id en la
// MISMA transacción (M11) ⇒ refreshPrivileges() revalida el rol en memoria y
// refresh() re-deriva la señal para que el guard no vuelva a preguntar
// (S-D3.A AC: "la pregunta no reaparece"). Error server-side (NIT duplicado,
// cap-1 "ya tenés un distribuidor asociado", inactivo) ⇒ mapError en el call
// site (HARD-1) y el usuario se queda en el form con opción de reintentar o
// volver a la pregunta.
export function DistributorTerminal({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const { refreshPrivileges } = useAuth();
  const { refresh } = useOnboarding();

  const [values, setValues] = useState<DistributorRegistrationValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<DistributorFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function handleSubmit(): void {
    const parsed = distributorSchema.safeParse(values);
    if (!parsed.success) {
      const issues = parsed.error.flatten();
      setErrors({
        name: issues.fieldErrors.name?.[0],
        nit: issues.fieldErrors.nit?.[0],
        contact_name: issues.fieldErrors.contact_name?.[0],
        phone: issues.fieldErrors.phone?.[0],
        email: issues.fieldErrors.email?.[0],
        contact_preference: issues.fieldErrors.contact_preference?.[0],
      });
      setFormError(null);
      return; // inválido ⇒ CERO requests (idea:198)
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    void (async () => {
      try {
        const result = await registerDistributor(parsed.data);
        if (result.error !== null) {
          setFormError(mapError(result.error)); // mapError en el call site (B3)
          return;
        }
        // El rol acaba de cambiar operador → distribuidor en la DB: el
        // AuthProvider relee my_role()/is_premium antes de entrar al app.
        await refreshPrivileges();
        await refresh();
        navigate("/inicio");
      } catch (thrown) {
        setFormError(mapError(thrown));
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <section className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold">Registro de distribuidor</h1>
      <p className="mt-2 text-sm text-gray-600">
        Creá tu distribuidor con el NIT del negocio. Un administrador puede auditar o revertir
        esta alta después.
      </p>
      <div className="mt-6">
        <DistributorRegistrationForm
          values={values}
          errors={errors}
          formError={formError}
          saving={saving}
          onChange={setValues}
          onSubmit={handleSubmit}
          onBack={onBack}
        />
      </div>
    </section>
  );
}
