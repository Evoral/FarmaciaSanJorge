/**
 * `listUsuariosElegiblesDt` (M04, FASE 3 point 3.9). Read-only: usuarios
 * eligible to be designated (role DIRECTOR_TECNICO, estado ACTIVO, current
 * tenant) -- feeds the usuario picker on `/admin/directores-tecnicos/nuevo`.
 * A thin `defineQuery` wrapper around the repository is required here (not
 * just the repository function) because `app/**` may not import a
 * module's `infrastructure/` layer directly (eslint.config.mjs's
 * `appBoundaryPatterns`). Same permiso-reuse rationale as
 * `list-designaciones.ts`.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listUsuariosElegibles as listUsuariosElegiblesRepo } from "../infrastructure/designacion-repository";
import type { UsuarioElegible } from "../infrastructure/designacion-repository";

const listUsuariosElegiblesInput = z.object({});

export const listUsuariosElegiblesQuery = defineQuery({
  name: "dt.usuariosElegibles",
  permiso: "dt.designar",
  input: listUsuariosElegiblesInput,
  handler: async ({ tx, session }) => listUsuariosElegiblesRepo(tx, session.tenantId),
});

export async function listUsuariosElegiblesDt(): Promise<UsuarioElegible[]> {
  return listUsuariosElegiblesQuery.execute({});
}
