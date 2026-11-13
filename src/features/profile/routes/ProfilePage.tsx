import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { Box, buttonClass, runAction } from "../../../shared/ui/Box";
import { PremiumStatusCard } from "../../premium";
import { fetchMyProfile, setMyMargin, updateMyProfile } from "../api";
import { MarginCard } from "../components/MarginCard";
import { PhoneVerificationCard } from "../components/PhoneVerificationCard";
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
  const { userId, email, role } = useAuth();
  const [values, setValues] = useState<ProfileFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [savedPhone, setSavedPhone] = useState("");
  const [margin, setMargin] = useState<number | null>(null);

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
        setVerifiedAt(row.phone_verified_at);
        setSavedPhone(row.phone_number ?? "");
        setMargin(row.default_margin_pct);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function refreshProfile(): Promise<void> {
    if (userId === null) return;
    const { row, error } = await fetchMyProfile(userId);
    if (error !== null || row === null) return;
    if (row.phone_verified_at !== null) {
      // La confirmación normaliza a E.164: reflejamos el número canónico.
      setValues((current) => ({
        ...current,
        phone_number: row.phone_number ?? current.phone_number,
      }));
      setSavedPhone(row.phone_number ?? "");
    }
    setVerifiedAt(row.phone_verified_at);
  }

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
        // El trigger de 0042 borra la verificación si el número cambia; el
        // estado local lo refleja sin esperar otro fetch.
        if (parsed.data.phone_number.trim() !== savedPhone.trim()) {
          setVerifiedAt(null);
          setSavedPhone(parsed.data.phone_number.trim());
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
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Cuenta</p>
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
            {email === null ? "" : `${email} · `}solo podés editar tus datos de contacto y tu margen
            de precios.
          </p>
        </div>
      </div>
      <div className="mt-6">
        <Box title="Plan">
          <PremiumStatusCard />
        </Box>
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
          <PhoneVerificationCard
            phone={values.phone_number}
            verifiedAt={verifiedAt}
            onRefresh={refreshProfile}
          />
        </Box>
      </div>
      {role === "distribuidor" && (
        <div className="mt-6">
          <Box title="Tiendas">
            <p className="text-sm text-gray-600">
              Vinculá tu distribuidora con las tiendas que atendés escaneando su QR o escribiendo el
              código.
            </p>
            <Link className={`${buttonClass} mt-3`} to="/vincular">
              Vincular tienda
            </Link>
          </Box>
        </div>
      )}
      <div className="mt-6">
        <Box title="Precios">
          <MarginCard
            initial={margin}
            onSave={async (value) => {
              const failure = await runAction(() => setMyMargin(value));
              if (failure === null) setMargin(value);
              return failure;
            }}
          />
        </Box>
      </div>
    </section>
  );
}
