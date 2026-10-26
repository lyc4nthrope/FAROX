import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { mapError } from "../../../shared/lib/errors/mapError";
import { normalizeRole, type RoleName } from "../../auth/types";
import {
  fetchDistributorOptions,
  fetchUser,
  fetchUserStores,
  setUserActive,
  setUserPremium,
  updateUserProfile,
  updateUserRole,
} from "../api";
import { UserDetail } from "../components/UserDetail";
import {
  UserProfileForm,
  type ProfileFormErrors,
} from "../components/UserProfileForm";
import { UserRolePanel, type RoleFormErrors } from "../components/UserRolePanel";
import { UserStoresPanel } from "../components/UserStoresPanel";
import { roleChangeSchema, userProfileSchema } from "../schemas";
import type { UserProfileFormValues } from "../schemas";
import type {
  DistributorOption,
  UserDetailRow,
  UserStoreRow,
} from "../types";

// Contenedor de /users/:id (sdd/admin-console T-B5..T-B8). Tres mutaciones,
// cada una por SU vía autorizada (design #599 §2.1):
// · perfil ⇒ .update() de SOLO las 3 columnas GRANT'd (ADM-4);
// · rol ⇒ rpc update_user_role, NUNCA UPDATE de role_id (ADM-5, M11);
// · premium/activo ⇒ rpcs set_user_premium / set_user_active (ADM-6).
// TODA validación Zod corre ANTES de cualquier request: inválido ⇒ CERO red.
const EMPTY_PROFILE: UserProfileFormValues = {
  full_name: "",
  phone_number: "",
  contact_preference: "whatsapp",
};

type RoleValues = { role: RoleName | ""; distributorId: string };

// Misma forma que un error PGRST116 real: mapError lo traduce a notFound
// (mapError.ts:68-70) sin texto crudo (HARD-1).
const SIN_FILA = { code: "PGRST116", message: "no rows" };

export function UserDetailPage() {
  const { id } = useParams();
  const { userId: currentUserId } = useAuth();

  const [usuario, setUsuario] = useState<UserDetailRow | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  // ADM-4 · perfil (3 columnas)
  const [valoresPerfil, setValoresPerfil] =
    useState<UserProfileFormValues>(EMPTY_PROFILE);
  const [erroresPerfil, setErroresPerfil] = useState<ProfileFormErrors>({});
  const [errorPerfil, setErrorPerfil] = useState<string | null>(null);
  const [avisoPerfil, setAvisoPerfil] = useState<string | null>(null);
  const [guardandoPerfil, setGuardandoPerfil] = useState(false);

  // ADM-5 · rol vía rpc
  const [valoresRol, setValoresRol] = useState<RoleValues>({
    role: "",
    distributorId: "",
  });
  const [erroresRol, setErroresRol] = useState<RoleFormErrors>({});
  const [errorRol, setErrorRol] = useState<string | null>(null);
  const [avisoRol, setAvisoRol] = useState<string | null>(null);
  const [guardandoRol, setGuardandoRol] = useState(false);

  // ADM-6 · toggles premium/activo
  const [busyPremium, setBusyPremium] = useState(false);
  const [busyActivo, setBusyActivo] = useState(false);
  const [errorToggles, setErrorToggles] = useState<string | null>(null);
  const [avisoToggles, setAvisoToggles] = useState<string | null>(null);

  // ADM-7 · tiendas (query independiente: su error NO tumba la página)
  const [tiendas, setTiendas] = useState<UserStoreRow[]>([]);
  const [cargandoTiendas, setCargandoTiendas] = useState(true);
  const [errorTiendas, setErrorTiendas] = useState<string | null>(null);

  // Picker de distribuidor (M11) + nombre para la cabecera.
  const [opciones, setOpciones] = useState<DistributorOption[]>([]);
  const [errorOpciones, setErrorOpciones] = useState<string | null>(null);

  const cargarUsuario = useCallback(async (): Promise<void> => {
    if (id === undefined) return;
    try {
      const { row, error } = await fetchUser(id);
      if (error !== null) {
        setUsuario(null);
        setErrorCarga(mapError(error));
        return;
      }
      if (row === null) {
        setUsuario(null);
        setErrorCarga(mapError(SIN_FILA));
        return;
      }
      setUsuario(row);
      setErrorCarga(null);
      // Sincroniza los forms con los valores REALES del server (refetch
      // posterior a cada mutación exitosa — HARD-3, sin optimistic).
      setValoresPerfil({
        full_name: row.full_name,
        phone_number: row.phone_number ?? "",
        contact_preference: row.contact_preference,
      });
      setValoresRol({
        role: normalizeRole(row.role?.name ?? null) ?? "",
        distributorId: row.distributor_id === null ? "" : String(row.distributor_id),
      });
    } catch (thrown) {
      setUsuario(null);
      setErrorCarga(mapError(thrown));
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => {
    void cargarUsuario();
  }, [cargarUsuario]);

  // Lectura de tiendas asignadas (ADM-7 · solo posible tras D2a). El error
  // crudo se mapea ACÁ: en runtime sin el GRANT el panel muestra un
  // ErrorBanner amigable y la página sigue viva (invariante I4).
  useEffect(() => {
    if (id === undefined) return;
    let cancelled = false;
    setCargandoTiendas(true);
    void (async () => {
      try {
        const result = await fetchUserStores(id);
        if (cancelled) return;
        setTiendas(result.rows);
        setErrorTiendas(result.error === null ? null : mapError(result.error));
      } catch (thrown) {
        if (cancelled) return;
        setTiendas([]);
        setErrorTiendas(mapError(thrown));
      } finally {
        if (!cancelled) setCargandoTiendas(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Opciones del picker de distribuidor (M11).
  useEffect(() => {
    if (id === undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchDistributorOptions();
        if (cancelled) return;
        setOpciones(result.options);
        setErrorOpciones(result.error === null ? null : mapError(result.error));
      } catch (thrown) {
        if (cancelled) return;
        setOpciones([]);
        setErrorOpciones(mapError(thrown));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // ADM-4 · guardar perfil: Zod ANTES del request; inválido ⇒ CERO red.
  function guardarPerfil(): void {
    if (usuario === null) return;
    const parsed = userProfileSchema.safeParse(valoresPerfil);
    if (!parsed.success) {
      const issues = parsed.error.flatten();
      setErroresPerfil({
        full_name: issues.fieldErrors.full_name?.[0],
        phone_number: issues.fieldErrors.phone_number?.[0],
        contact_preference: issues.fieldErrors.contact_preference?.[0],
      });
      setErrorPerfil(null);
      setAvisoPerfil(null);
      return;
    }
    setErroresPerfil({});
    setErrorPerfil(null);
    setAvisoPerfil(null);
    setGuardandoPerfil(true);
    void (async () => {
      try {
        const { error } = await updateUserProfile(usuario.id, parsed.data);
        if (error !== null) {
          setErrorPerfil(mapError(error)); // 42501 ⇒ «No tenés permisos…»
          return;
        }
        setAvisoPerfil("Perfil actualizado.");
        await cargarUsuario(); // refetch de la fila (ADM-4.1)
      } catch (thrown) {
        setErrorPerfil(mapError(thrown));
      } finally {
        setGuardandoPerfil(false);
      }
    })();
  }

  // ADM-5 · cambiar rol SOLO vía update_user_role. El superRefine de Zod es el
  // espejo de M11: sin distribuidor para el rol «distribuidor» ⇒ CERO rpc.
  function guardarRol(): void {
    if (usuario === null) return;
    const parsed = roleChangeSchema.safeParse({
      role: valoresRol.role,
      distributor_id:
        valoresRol.distributorId === "" ? undefined : valoresRol.distributorId,
    });
    if (!parsed.success) {
      const issues = parsed.error.flatten();
      setErroresRol({
        role: issues.fieldErrors.role?.[0],
        distributor_id:
          issues.fieldErrors.distributor_id?.[0] ?? issues.formErrors[0],
      });
      setErrorRol(null);
      setAvisoRol(null);
      return;
    }
    setErroresRol({});
    setErrorRol(null);
    setAvisoRol(null);

    // ADM-6 (spec): cambio de rol PROPIO permitido CON confirmación — el
    // riesgo es la auto-degradación. (La auto-desactivación no: ver abajo.)
    // A0.3: todo cambio de rol pide confirmación (propio o ajeno).
    const esPropio = currentUserId !== null && usuario.id === currentUserId;
    const confirmado = window.confirm(
      esPropio
        ? "Vas a cambiar tu propio rol. ¿Querés continuar?"
        : `Vas a cambiar el rol de ${usuario.full_name} a «${parsed.data.role}». ¿Querés continuar?`,
    );
    if (!confirmado) return;

    setGuardandoRol(true);
    const distribuidor =
      parsed.data.role === "distribuidor" && parsed.data.distributor_id != null
        ? Number(parsed.data.distributor_id)
        : null;
    void (async () => {
      try {
        const { error } = await updateUserRole(
          usuario.id,
          parsed.data.role,
          distribuidor,
        );
        if (error !== null) {
          setErrorRol(mapError(error));
          return;
        }
        setAvisoRol("Rol actualizado.");
        await cargarUsuario(); // el badge se actualiza tras refetch (ADM-5.1)
      } catch (thrown) {
        setErrorRol(mapError(thrown));
      } finally {
        setGuardandoRol(false);
      }
    })();
  }

  // ADM-6.1 · premium SOLO vía set_user_premium; refetch posterior (HARD-3).
  function alternarPremium(value: boolean): void {
    if (usuario === null) return;
    // A0.3: confirmación antes de cambiar el plan.
    if (
      !window.confirm(
        value
          ? `¿Dar Premium a ${usuario.full_name}?`
          : `¿Quitar Premium a ${usuario.full_name}? Perderá movimientos manuales, dashboard y QR masivo.`,
      )
    )
      return;
    setBusyPremium(true);
    setErrorToggles(null);
    setAvisoToggles(null);
    void (async () => {
      try {
        const { error } = await setUserPremium(usuario.id, value);
        if (error !== null) {
          setErrorToggles(mapError(error));
          return;
        }
        setAvisoToggles(value ? "Ahora es premium." : "Se quitó el estado premium.");
        await cargarUsuario();
      } catch (thrown) {
        setErrorToggles(mapError(thrown));
      } finally {
        setBusyPremium(false);
      }
    })();
  }

  // ADM-6.3 · activo SOLO vía set_user_active. ADM-6.2 (R5): el backend NO
  // tiene guard de auto-desactivación ⇒ además del control deshabilitado de
  // UserDetail, este handler corta la llamada: CERO requests para uno mismo.
  function alternarActivo(value: boolean): void {
    if (usuario === null) return;
    if (currentUserId !== null && usuario.id === currentUserId && !value) return;
    // A0.3: confirmación explícita; desactivar deja al usuario sin acceso.
    if (
      !window.confirm(
        value
          ? `¿Reactivar a ${usuario.full_name}?`
          : `¿Desactivar a ${usuario.full_name}? No podrá entrar al sistema.`,
      )
    )
      return;
    setBusyActivo(true);
    setErrorToggles(null);
    setAvisoToggles(null);
    void (async () => {
      try {
        const { error } = await setUserActive(usuario.id, value);
        if (error !== null) {
          setErrorToggles(mapError(error));
          return;
        }
        setAvisoToggles(value ? "Usuario activado." : "Usuario desactivado.");
        await cargarUsuario(); // la fila queda visible con su estado nuevo
      } catch (thrown) {
        setErrorToggles(mapError(thrown));
      } finally {
        setBusyActivo(false);
      }
    })();
  }

  if (cargando) {
    return (
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Usuario</h1>
        <p className="mt-4 text-sm text-gray-600">Cargando…</p>
      </section>
    );
  }

  if (usuario === null) {
    return (
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Usuario</h1>
        <div className="mt-4">
          {/* errorCarga SIEMPRE viene de mapError() (HARD-1) */}
          <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errorCarga ?? "Ocurrió un error inesperado. Intentá de nuevo."}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <Link to="/users" className="text-sm text-gray-600 underline">
        ← Volver a Usuarios
      </Link>
      <div className="mt-3">
        <UserDetail
          user={usuario}
          isSelf={currentUserId !== null && usuario.id === currentUserId}
          distributorOptions={opciones}
          premiumBusy={busyPremium}
          activeBusy={busyActivo}
          error={errorToggles}
          notice={avisoToggles}
          onTogglePremium={alternarPremium}
          onToggleActive={alternarActivo}
        />
      </div>
      <div className="mt-6">
        <h2 className="text-lg font-semibold">Perfil</h2>
        <p className="mt-1 text-sm text-gray-600">
          Solo se editan nombre, teléfono y preferencia de contacto.
        </p>
        <UserProfileForm
          values={valoresPerfil}
          errors={erroresPerfil}
          formError={errorPerfil}
          notice={avisoPerfil}
          saving={guardandoPerfil}
          onChange={setValoresPerfil}
          onSubmit={guardarPerfil}
        />
      </div>
      <UserRolePanel
        role={valoresRol.role}
        distributorId={valoresRol.distributorId}
        distributorOptions={opciones}
        errors={erroresRol}
        error={errorRol ?? errorOpciones}
        notice={avisoRol}
        saving={guardandoRol}
        onChange={setValoresRol}
        onSubmit={guardarRol}
      />
      <UserStoresPanel
        stores={tiendas}
        loading={cargandoTiendas}
        error={errorTiendas}
      />
    </section>
  );
}
