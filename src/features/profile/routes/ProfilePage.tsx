import { useEffect, useState } from "react";

import { useAuth } from "../../../app/providers/AuthProvider";
import { Box } from "../../../shared/ui/Box";
import { fetchMyProfile, updateMyProfile } from "../api";
import { ProfileForm, type ProfileFormErrors } from "../components/ProfileForm";
import { profileSchema, type ProfileFormValues } from "../schemas";

const EMPTY_VALUES: ProfileFormValues = {
  full_name: "",
  phone_number: "",
  contact_preference: "whatsapp",
};

// Contenedor de perfil (§S2 fila /profile): precarga la fila propia y al
// guardar envía SOLO { full_name, phone_number, contact_preference } —
// el §S2 profile-column-limit es el AC cargante.
export function ProfilePage() {
  const { userId, email } = useAuth();
  const [values, setValues] = useState<ProfileFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    void (async () => {
      const { row, error } = await fetchMyProfile(userId);
      if (cancelled) return;
      if (error !== null) {
        setFormError("No se pudo cargar tu perfil.");
        return;
      }
      if (row !== null) {
        setValues({
          full_name: row.full_name,
          phone_number: row.phone_number ?? "",
          contact_preference: row.contact_preference,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  function handleSubmit(): void {
    if (userId === null) return;
    const parsed = profileSchema.safeParse(values);
    if (!parsed.success) {
      const issues = parsed.error.flatten();
      setErrors({
        full_name: issues.fieldErrors.full_name?.[0],
        phone_number: issues.fieldErrors.phone_number?.[0],
        contact_preference: issues.fieldErrors.contact_preference?.[0],
      });
      setFormError(null);
      setNotice(null);
      return; // datos inválidos ⇒ cero requests (PROD-3)
    }
    setErrors({});
    setFormError(null);
    setNotice(null);
    setSaving(true);
    void (async () => {
      try {
        const { error } = await updateMyProfile(userId, parsed.data);
        if (error !== null) {
          setFormError("No se pudo guardar tu perfil. Intentá de nuevo.");
          return;
        }
        setNotice("Perfil actualizado.");
      } catch {
        setFormError("No se pudo conectar, revisá tu conexión.");
      } finally {
        setSaving(false);
      }
    })();
  }

  const initial =
    values.full_name.trim().charAt(0).toUpperCase() ||
    (email === null ? "" : email.charAt(0).toUpperCase()) ||
    "?";

  return (
    <section className="mx-auto max-w-2xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">Cuenta</p>
      <div className="mt-2 flex items-center gap-4">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gray-900 text-lg font-semibold text-white shadow-sm"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Perfil</h1>
          <p className="mt-1 text-sm text-gray-500">
            {email === null ? "" : `${email} · `}solo podés editar tu nombre, teléfono y preferencia
            de contacto.
          </p>
        </div>
      </div>
      <div className="mt-6">
        <Box title="Datos de contacto">
          <ProfileForm
            values={values}
            errors={errors}
            formError={formError}
            notice={notice}
            saving={saving}
            onChange={setValues}
            onSubmit={handleSubmit}
          />
        </Box>
      </div>
    </section>
  );
}
