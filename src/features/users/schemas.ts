import { z } from "zod";

import { ROLE_NAMES } from "../auth/types";
import { profileSchema } from "../profile/schemas";

// sdd/admin-console T-B3 (design #599 §2.5). Zod valida ANTES de cualquier
// request: input inválido ⇒ CERO invocaciones de red (convención global,
// ProductFormPage.test.tsx:201-229).

// ADM-4: ÚNICA fuente de verdad de las 3 columnas de perfil — se reutiliza el
// profileSchema de /profile porque es exactamente el GRANT UPDATE por columna
// de 0006:368-369 (D45). Ninguna columna privilegiada pasa por este form.
export const userProfileSchema = profileSchema;
export type UserProfileFormValues = z.infer<typeof userProfileSchema>;

// ADM-5 · M11: el cambio de rol SOLO viaja por la rpc update_user_role
// (0011:85-108) — nunca un UPDATE directo de role_id. Este superRefine es el
// ESPEJO CLIENTE de la guarda M11 del server (0011:93-95): es validación de
// formulario, NO un pre-check de permisos (el server sigue siendo autoridad).
export const roleChangeSchema = z
  .object({
    role: z.enum(ROLE_NAMES, { message: "Seleccioná un rol." }),
    // El select usa "" para "sin elegir": "" cae en !distributor_id abajo.
    distributor_id: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.role === "distribuidor" && !values.distributor_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distributor_id"],
        message: "El rol distribuidor requiere elegir un distribuidor.",
      });
    }
  });

export type RoleChangeFormValues = z.infer<typeof roleChangeSchema>;
