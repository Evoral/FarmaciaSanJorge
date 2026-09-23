/**
 * `cesarDesignacion` (M04, FASE 3 point 3.9, INV-DT-003/004). A cese sets
 * `vigente_hasta` + `motivo_cese` EXACTLY ONCE -- the row is never deleted
 * or otherwise rewritten (INV-DT-003). Requires recent re-authentication,
 * same sensitivity as `designar-director-tecnico.ts`.
 *
 * `TipoAccion` choice: audited as `BAJA`. There is no dedicated `CESAR`
 * value in the enum (prisma/schema.prisma's `TipoAccion`), and `BAJA`
 * already means "a definitive, terminal state change" elsewhere in this
 * codebase (modules/usuarios' `dar-de-baja-usuario.ts` uses it for exactly
 * that shape of transition) -- a cese is the same kind of event for a
 * designacion: it permanently closes the validity period and can never be
 * reopened or re-edited (INV-DT-003), which is a closer semantic match
 * than any of `MODIFICAR`/`ANULAR`/`CAMBIAR_ESTADO`.
 *
 * INV-DT-003 (immutable once set) and INV-DT-004 (a cese cannot retroactively
 * shorten a designation past a day an already-signed `cierre_diario`
 * references it -- migration 0021) are both DB-enforced triggers on
 * UPDATE. Neither is re-implemented here: both raise `INV-DT-00X: ...`
 * with SQLSTATE P0001, which `mapDbError` already recognizes via the
 * generic `INV-XXX` token extraction -- no new mapping needed in
 * shared/errors/index.ts for either (unlike INV-DT-002's EXCLUDE
 * constraint, see designar-director-tecnico.ts's doc comment). This
 * handler's job is only to load the row for the audit's `valorAnterior`,
 * reject an already-ceased designation with a clear Spanish message before
 * even hitting the DB (INV-DT-003 would also catch it, but with a generic
 * "system rule" message instead of this domain-specific one), and run the
 * same fast `vigente_hasta >= vigente_desde` pre-check the DB's own CHECK
 * constraint enforces.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid, nonEmptyString } from "@/shared/validation";
import { isoDate, validarRangoVigencia } from "../domain/designacion";
import { getDesignacionParaCese, cesarDesignacion as cesarDesignacionRepo } from "../infrastructure/designacion-repository";

/** Exported for tests/unit/directores-tecnicos-validacion.test.ts -- same convention as modules/farmacia/application/editar-datos-tenant.ts's `editarDatosTenantInput`. */
export const cesarDesignacionInput = z.object({
  designacionId: uuid,
  vigenteHasta: isoDate,
  motivoCese: nonEmptyString,
});

export type CesarDesignacionInput = z.infer<typeof cesarDesignacionInput>;

export interface CesarDesignacionResult {
  designacionId: string;
}

export const cesarDesignacionCommand = defineCommand({
  name: "dt.cesar",
  permiso: "dt.cesar",
  input: cesarDesignacionInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "designacion_director_tecnico", accion: TipoAccion.BAJA },
  handler: async ({ tx, session, input }) => {
    const actual = await getDesignacionParaCese(tx, session.tenantId, input.designacionId);
    if (!actual) throw new NotFoundError("Designación no encontrada.");

    if (actual.vigenteHasta !== null) {
      throw new DomainError("Esta designación ya tiene un cese registrado; el cese es definitivo y no puede modificarse.");
    }

    // Fast pre-DB check (UX only) -- mirrors designacion_dt_vigencia_check
    // (migration 0005). INV-DT-003/004 remain the DB's own job regardless
    // of this check -- see this file's module doc comment.
    const vigenteDesdeIso = actual.vigenteDesde.toISOString().slice(0, 10);
    const rangoError = validarRangoVigencia(vigenteDesdeIso, input.vigenteHasta);
    if (rangoError) {
      throw new DomainError(rangoError);
    }

    await cesarDesignacionRepo(tx, {
      tenantId: session.tenantId,
      designacionId: input.designacionId,
      vigenteHasta: input.vigenteHasta,
      motivoCese: input.motivoCese,
    });

    return {
      output: { designacionId: input.designacionId },
      audit: {
        entidadId: input.designacionId,
        motivo: input.motivoCese,
        valorAnterior: { vigenteHasta: null },
        valorNuevo: { vigenteHasta: input.vigenteHasta, motivoCese: input.motivoCese },
      },
    };
  },
});

export async function cesarDesignacion(input: CesarDesignacionInput): Promise<CesarDesignacionResult> {
  return cesarDesignacionCommand.execute(input);
}
