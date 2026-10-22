import { z } from "zod";

import { ROLE_NAMES } from "../auth/types";

// sdd/admin-console T-C1 (design #599 §2.5, mitigación R3). Zod valida ANTES
// de cualquier request: input inválido ⇒ CERO invocaciones de red (convención
// global, ProductFormPage.test.tsx:201-229).

// ADM-8 / R3 — LA guarda más importante del lote C: name = z.enum(ROLE_NAMES)
// (auth/types.ts:3). Un nombre fuera del catálogo de la app ("superuser")
// haría que normalizeRole (auth/types.ts:16-19) degradara a esos usuarios a
// role:null ⇒ AccessDenied total. Esta UI no puede CREAR ese estado: el
// request ni se emite. El server sigue siendo autoridad (UNIQUE 0002:43 ⇒
// 23505 amigable vía mapError).
export const roleSchema = z.object({
  name: z.enum(ROLE_NAMES, {
    message:
      "Elegí un nombre de rol del catálogo de la app (admin, operador o distribuidor).",
  }),
  // roles.description es nullable (0002:44): "" viaja como NULL (convención
  // profile/api → users/api updateUserProfile).
  description: z.string().trim(),
});

export type RoleFormValues = z.infer<typeof roleSchema>;

// Estado CRUDO del form: strings libres mientras el usuario tipea. Zod
// (roleSchema) es quien garantiza que name ∈ ROLE_NAMES ANTES del request —
// safeParse acepta unknown, así que el form nunca finge el tipo del enum.
export interface RoleFormState {
  name: string;
  description: string;
}
