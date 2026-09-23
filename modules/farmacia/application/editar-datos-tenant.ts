/**
 * `editarDatosTenant` (FASE 3 point 3.10a). Edits ONLY the 4 institutional
 * fields fsj_app is granted UPDATE on post-migration 0020: razonSocial,
 * nombreFantasia, domicilio, matriculaFarmacia. `cuit`, `zonaHoraria`,
 * `fechaBaja` and `fechaActivacionContralor` are NEVER accepted as input --
 * the zod schema below does not declare them at all (`.strict()` rejects
 * any extra key outright, it does not just silently drop it), so a stale
 * form field or a hand-crafted request body containing one of those keys
 * fails validation before this handler ever runs. Defense in depth on top
 * of that: even if a bad build somehow tried to send one of them, the
 * narrowed column-level GRANT (migration 0020) would reject it at the DB
 * layer with SQLSTATE 42501, and `shared/errors#mapDbError` maps any
 * unrecognized Prisma/Postgres error (no INV-XXX token, no known P-code) to
 * a generic `INTERNAL_ERROR` -- never leaking the raw permission-denied
 * message to the client. This should not normally be reachable at all by a
 * correctly built form/zod schema; it exists purely as a backstop.
 *
 * This is a sensitive action (institutional/legal data) -- `requireRecentReauth`
 * applies, same as usuarios' suspender/reactivar/baja/restablecerCredencial.
 *
 * No optimistic-concurrency version check (unlike editar-usuario.ts):
 * `fsj.tenant` has exactly ONE row per tenant, so two admins racing to edit
 * it concurrently is a rare edge case, not the routine "someone else edited
 * this same usuario row" scenario editar-usuario.ts guards against. A
 * lost-update here just means the last save wins overall -- acceptable for
 * this single, low-contention row, and the audit trail (valorAnterior/
 * valorNuevo below) still records exactly what changed and when.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { nonEmptyString } from "@/shared/validation";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { getTenantDetalle, updateDatosEditablesTenant } from "../infrastructure/tenant-repository";

/** Optional free-text field: empty/omitted clears the column to NULL (mirrors editar-usuario.ts's numeroMatricula convention). */
const optionalText = z.string().trim().max(300).optional();

/** Exported for tests/unit/parametros-validacion.test.ts (asserts the 4 non-editable tenant fields are provably NOT accepted, via `.safeParse`/`.strict()`) -- not otherwise imported outside this module. */
export const editarDatosTenantInput = z
  .object({
    razonSocial: nonEmptyString,
    nombreFantasia: optionalText,
    domicilio: optionalText,
    matriculaFarmacia: optionalText,
  })
  .strict();

export type EditarDatosTenantInput = z.infer<typeof editarDatosTenantInput>;

export const editarDatosTenantCommand = defineCommand({
  name: "farmacia.editarDatosTenant",
  permiso: "config.editar",
  input: editarDatosTenantInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "tenant", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const actual = await getTenantDetalle(tx, session.tenantId);
    if (!actual) throw new NotFoundError("No se encontró la farmacia.");

    const nombreFantasiaNuevo = input.nombreFantasia || null;
    const domicilioNuevo = input.domicilio || null;
    const matriculaFarmaciaNuevo = input.matriculaFarmacia || null;

    await updateDatosEditablesTenant(tx, session.tenantId, {
      razonSocial: input.razonSocial,
      nombreFantasia: nombreFantasiaNuevo,
      domicilio: domicilioNuevo,
      matriculaFarmacia: matriculaFarmaciaNuevo,
    });

    return {
      output: { id: session.tenantId },
      audit: {
        entidadId: session.tenantId,
        valorAnterior: {
          razonSocial: actual.razonSocial,
          nombreFantasia: actual.nombreFantasia,
          domicilio: actual.domicilio,
          matriculaFarmacia: actual.matriculaFarmacia,
        },
        valorNuevo: {
          razonSocial: input.razonSocial,
          nombreFantasia: nombreFantasiaNuevo,
          domicilio: domicilioNuevo,
          matriculaFarmacia: matriculaFarmaciaNuevo,
        },
      },
    };
  },
});

export async function editarDatosTenant(input: EditarDatosTenantInput): Promise<{ id: string }> {
  return editarDatosTenantCommand.execute(input);
}
