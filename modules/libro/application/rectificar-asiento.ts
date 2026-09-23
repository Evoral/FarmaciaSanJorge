/**
 * `rectificarAsiento` -- D1 (user decision, 2026-09-23). The "jornada
 * firmada" half of DP-16/DP-16c that `anular-asiento.ts` explicitly left
 * out of scope (see that file's header comment): when a SISTEMA asiento's
 * jornada is already SIGNED, it can never be anulled (INV-L02) -- the only
 * correction is a NEW asiento_recetario, origen RECTIFICATIVO, in the
 * jornada EN CURSO, that references the original (INV-L18) and is itself
 * authorized by a `rectificacion_asiento` row (INV-L21, migration 0033).
 *
 * D3: a rectificativo ONLY leaves the original "sin efecto" -- no data is
 * transcribed. The new row copies the ORIGINAL's frozen snapshot
 * (paciente/medico/formula texto) verbatim, has NO detalle_asiento lines
 * (D4 exempts RECTIFICATIVO from INV-L22's ">= 1 detalle" rule), and never
 * touches stock or asiento_contralor (INV-L20, unchanged).
 *
 * FIX 4 (jd-fix-agent, 2026-09-23): same restructuring as
 * `anular-asiento.ts` -- see that file's doc comment for the full
 * rationale. The internal `defineCommand` instance below
 * (`rectificarAsientoInternalCommand`) is NEVER exported; `rectificarAsiento`,
 * below, is the ONLY entry point this module exposes, and it takes DT
 * CREDENTIALS (`dtUsuarioId`/`dtPassword`), not a pre-verified id.
 *
 * Pipeline: SAME shape as `anular-asiento.ts` -- `requireSession ->
 * authorize('libro.anulacion.solicitar') -> requireRecentReauth (the
 * REQUESTER's own step-up) -> zod.parse`, then inside the transaction:
 *   1. Lock the ORIGINAL asiento `FOR UPDATE`; verify it is SISTEMA,
 *      VIGENTE, its jornada IS signed (otherwise: friendly message
 *      pointing to `anularAsiento` instead -- D1: "only for SISTEMA
 *      asientos whose jornada IS signed; otherwise message pointing to
 *      anulación"), and it has no rectificativo yet (INV-L19).
 *   2. INSERT the RECTIFICATIVO asiento_recetario (copies the snapshot).
 *   3. INSERT `rectificacion_asiento` with `autorizadoPorId` = the
 *      co-firma-verified DT id `rectificarAsiento` just resolved, and
 *      `registradoPorId` = the SESSION's own user.
 *   4. D2 REVISED (per-item rule): couples the receta reached via the
 *      ORIGINAL asiento's preparacion in the SAME transaction -- it moves
 *      to ANULADA only once EVERY item of the receta is "sin efecto" (this
 *      one included); otherwise it is left unchanged -- see
 *      `../infrastructure/receta-coupling-repository.ts`.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { ExecuteOptions } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { DomainError, NotFoundError, InvariantViolationError, mapDbError } from "@/shared/errors";
import { uuid, nonEmptyString } from "@/shared/validation";
import { mensajeParaInvarianteRectificacion } from "../domain/mensajes-invariantes";
import {
  lockAsientoParaAnular,
  getAsientoParaRectificar,
  insertAsientoRectificativo,
  insertRectificacionAsiento,
} from "../infrastructure/asiento-repository";
import { desvincularRecetaPorAsiento } from "../infrastructure/receta-coupling-repository";
import { verificarCoFirmaDtLibroCommand } from "./verificar-co-firma-dt";

const rectificarAsientoInternalInput = z.object({
  asientoOriginalId: uuid,
  motivo: nonEmptyString,
  /** The id `verificarCoFirmaDtLibroCommand` returned -- NEVER trust this from raw client input, see this module's doc comment. Set ONLY by `rectificarAsiento`, below. */
  autorizadoPorId: uuid,
});

/** Public input: DT CREDENTIALS, not a pre-verified id -- see this module's doc comment (FIX 4). */
export interface RectificarAsientoInput {
  asientoOriginalId: string;
  motivo: string;
  dtUsuarioId: string;
  dtPassword: string;
}

/** NOT exported -- see this module's doc comment (FIX 4). The only way to reach this is through `rectificarAsiento`, below. */
const rectificarAsientoInternalCommand = defineCommand({
  name: "libro.asiento.rectificar",
  // Same permiso as anularAsiento -- D1: "same permiso libro.anulacion.solicitar".
  permiso: "libro.anulacion.solicitar",
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  input: rectificarAsientoInternalInput,
  audit: { entidad: "asiento_recetario", accion: TipoAccion.ANULAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockAsientoParaAnular(tx, session.tenantId, input.asientoOriginalId);
    if (!locked) throw new NotFoundError("Asiento no encontrado.");

    const original = await getAsientoParaRectificar(tx, session.tenantId, input.asientoOriginalId);
    if (!original) throw new NotFoundError("Asiento no encontrado.");

    if (original.origen !== "SISTEMA") {
      throw new DomainError("Solo un asiento de origen sistema puede tener un rectificativo.");
    }
    if (original.estado !== "VIGENTE") {
      throw new DomainError("El asiento ya fue anulado: no corresponde un rectificativo.");
    }
    if (original.cierreDiarioId === null) {
      throw new DomainError(
        "La jornada de este asiento todavía está abierta: corresponde anularlo, no generar un rectificativo.",
      );
    }
    if (original.tieneRectificativo) {
      throw new DomainError("Este asiento ya tiene un rectificativo.");
    }

    try {
      const rectificativo = await insertAsientoRectificativo(tx, {
        tenantId: session.tenantId,
        asientoOriginalId: input.asientoOriginalId,
        pacienteTexto: original.pacienteTexto,
        medicoTexto: original.medicoTexto,
        formulaTexto: original.formulaTexto,
        registradoPorId: session.usuario.id,
      });

      await insertRectificacionAsiento(tx, {
        tenantId: session.tenantId,
        asientoRectificativoId: rectificativo.id,
        motivo: input.motivo,
        autorizadoPorId: input.autorizadoPorId,
        registradoPorId: session.usuario.id,
      });

      // D2 REVISED (per-item rule): couple the underlying receta (reached
      // via the ORIGINAL's preparacion -- the rectificativo row itself has
      // no preparacionId). Only moves the receta to ANULADA once EVERY item
      // is sin efecto.
      await desvincularRecetaPorAsiento(tx, {
        tenantId: session.tenantId,
        preparacionId: original.preparacionId,
        numeroCorrelativo: original.numeroCorrelativo,
        motivo: input.motivo,
        usuarioId: session.usuario.id,
      });

      return {
        output: { id: rectificativo.id, asientoOriginalId: input.asientoOriginalId, numeroCorrelativo: rectificativo.numeroCorrelativo },
        audit: {
          entidadId: rectificativo.id,
          motivo: input.motivo,
          autorizadoPorId: input.autorizadoPorId,
          valorNuevo: { asientoOriginalId: input.asientoOriginalId, motivo: input.motivo },
        },
      };
    } catch (e) {
      // Same discipline as anular-asiento.ts/confirmar-preparacion.ts.
      const mapped = mapDbError(e);
      if (mapped instanceof InvariantViolationError) {
        throw new DomainError(mensajeParaInvarianteRectificacion(mapped.invariantCode));
      }
      throw mapped;
    }
  },
});

/**
 * The ONLY exported entry point for rectificar-asiento (FIX 4 -- see module
 * doc comment). Verifies the DT's co-firma FIRST (its own transaction,
 * `verificarCoFirmaDtLibroCommand` -- rate-limited, audits failures), and
 * ONLY on success calls the internal command with the id THAT verification
 * returned. `options` exists solely so unit tests can inject a session
 * (`shared/usecase.ts#resolveSession` only honours it under
 * `NODE_ENV=test`) -- production callers (Server Actions) never pass it.
 */
export async function rectificarAsiento(
  input: RectificarAsientoInput,
  options?: ExecuteOptions,
): Promise<{ id: string; asientoOriginalId: string; numeroCorrelativo: string }> {
  const coFirma = await verificarCoFirmaDtLibroCommand.execute({ dtUsuarioId: input.dtUsuarioId, password: input.dtPassword }, options);
  if (!coFirma.ok) {
    throw new DomainError(coFirma.message);
  }
  return rectificarAsientoInternalCommand.execute(
    { asientoOriginalId: input.asientoOriginalId, motivo: input.motivo, autorizadoPorId: coFirma.dtUsuarioId },
    options,
  );
}
