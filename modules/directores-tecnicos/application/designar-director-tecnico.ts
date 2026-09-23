/**
 * `designarDirectorTecnico` (M04, FASE 3 point 3.9, INV-DT-001/002/005).
 * INSERT-only: a designation is never edited, only ceased (see
 * `cesar-designacion.ts`). Requires recent re-authentication -- designating
 * (or re-designating) the tenant's Director Tecnico is exactly the kind of
 * sensitive admin action the rest of this codebase already gates behind
 * step-up (crear-usuario/cambiar-roles/suspender-usuario, etc.).
 *
 * INV-DT-001 (usuario must hold role DIRECTOR_TECNICO), INV-DT-002 (no two
 * overlapping TITULAR periods per tenant, a GiST EXCLUDE constraint) and
 * INV-DT-005 (usuario must be ACTIVO, migration 0022) are all enforced by
 * DB triggers/constraints on INSERT -- this command does not duplicate the
 * role or overlap checks in application code, but DOES re-check ACTIVO
 * below with a fresh read inside this same transaction, purely for a clear
 * Spanish message before the round trip to the DB trigger (review finding
 * M1): `listUsuariosElegibles`'s `estado: "ACTIVO"` filter (the "nuevo"
 * form's usuario picker) is UI-only and does not stop a crafted call with
 * an arbitrary `usuarioId`. The DB's INV-DT-005 trigger remains the real
 * guarantee regardless of this pre-check. A violation surfaces as a thrown
 * Postgres/Prisma error from `insertDesignacion`, which
 * `withTenantTransaction` (shared/db/transaction.ts) runs through
 * `mapDbError` before it ever reaches this handler's caller:
 *   - INV-DT-001 raises `RAISE EXCEPTION 'INV-DT-001: ...' USING ERRCODE =
 *     'P0001'` -- `mapDbError` already recognizes the `INV-XXX` token in
 *     the message and returns an `InvariantViolationError` for any INV code,
 *     with no change needed here.
 *   - INV-DT-002 is a raw Postgres EXCLUDE constraint violation (SQLSTATE
 *     23P01), which carries NO `INV-XXX` text. `shared/errors/index.ts` did
 *     not previously map it: it was added there as part of this task (one
 *     extra `if` branch, see that file's comment) after inspecting the
 *     REAL error Prisma 7.10.0 + @prisma/adapter-pg throws for
 *     `tx.designacionDirectorTecnico.create()` against this constraint --
 *     empirically, Prisma wraps it as `PrismaClientKnownRequestError` with
 *     `e.code === "P2039"` (a generic "Database error" bucket, NOT a
 *     constraint-specific P2xxx code), and the real SQLSTATE `23P01` is
 *     only recoverable from `e.meta.driverAdapterError.cause.code` (or, as
 *     a fallback, substring-matched out of `e.message`, which also embeds
 *     it as literal text: "Database error. Code: `23P01`."). That mapping
 *     now returns a `ConflictError` with the Spanish message "Ya existe
 *     una designación TITULAR vigente que se superpone con ese período."
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid, nonEmptyString } from "@/shared/validation";
import { CARACTERES_DESIGNACION, isoDate } from "../domain/designacion";
import { insertDesignacion, getUsuarioEstado } from "../infrastructure/designacion-repository";

/** Exported for tests/unit/directores-tecnicos-validacion.test.ts -- same convention as modules/farmacia/application/editar-datos-tenant.ts's `editarDatosTenantInput`. */
export const designarDirectorTecnicoInput = z.object({
  usuarioId: uuid,
  caracter: z.enum(CARACTERES_DESIGNACION),
  matricula: nonEmptyString,
  expedienteDesignacion: z.string().trim().max(200).optional(),
  vigenteDesde: isoDate,
});

export type DesignarDirectorTecnicoInput = z.infer<typeof designarDirectorTecnicoInput>;

export interface DesignarDirectorTecnicoResult {
  designacionId: string;
}

export const designarDirectorTecnicoCommand = defineCommand({
  name: "dt.designar",
  permiso: "dt.designar",
  input: designarDirectorTecnicoInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "designacion_director_tecnico", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    // Fresh read inside THIS transaction (not the picker's stale list) --
    // review finding M1: UX-only pre-check, mirrors modules/usuarios'
    // suspender-usuario.ts style Spanish message. INV-DT-005 (migration
    // 0022) is the real guarantee regardless of this check.
    const estado = await getUsuarioEstado(tx, session.tenantId, input.usuarioId);
    if (estado === null) throw new NotFoundError("Usuario no encontrado.");
    if (estado !== "ACTIVO") {
      throw new DomainError("Solo se puede designar como Director Técnico a un usuario ACTIVO.");
    }

    const nueva = await insertDesignacion(tx, {
      tenantId: session.tenantId,
      usuarioId: input.usuarioId,
      caracter: input.caracter,
      matricula: input.matricula,
      expedienteDesignacion: input.expedienteDesignacion ?? null,
      vigenteDesde: input.vigenteDesde,
      registradoPorId: session.usuario.id,
    });

    return {
      output: { designacionId: nueva.id },
      audit: {
        entidadId: nueva.id,
        valorNuevo: {
          usuarioId: input.usuarioId,
          caracter: input.caracter,
          matricula: input.matricula,
          expedienteDesignacion: input.expedienteDesignacion ?? null,
          vigenteDesde: input.vigenteDesde,
        },
      },
    };
  },
});

export async function designarDirectorTecnico(input: DesignarDirectorTecnicoInput): Promise<DesignarDirectorTecnicoResult> {
  return designarDirectorTecnicoCommand.execute(input);
}
