/**
 * `anularAsiento` -- FASE 9, M12 point 9.2. Covers DP-16/DP-16c's "jornada
 * abierta" half; `rectificar-asiento.ts` (D1, 2026-09-23) covers the
 * already-signed-jornada half this file used to leave out of scope.
 *
 * FIX 4 (jd-fix-agent, 2026-09-23): the co-firma verification USED TO live
 * only in `modules/libro/ui/actions.ts` (call `verificarCoFirmaDtLibro`
 * first, and only on `{ ok: true }` call this module's exported command
 * with the verified id) -- a convention enforced by comments, not by the
 * type system. Any OTHER caller of the exported `anularAsientoCommand`
 * (a different Server Action, a script, a future refactor) could pass
 * ANY `autorizadoPorId` UUID with no co-firma check at all and still have
 * it recorded as the authorizing DT. The internal `defineCommand` instance
 * below (`anularAsientoInternalCommand`) is therefore NEVER exported --
 * `anularAsiento`, below, is the ONLY entry point this module exposes, and
 * it takes DT CREDENTIALS (`dtUsuarioId`/`dtPassword`), not a pre-verified
 * id: it runs `verificarCoFirmaDtLibroCommand` itself (own transaction, so
 * a rejected co-signature is still audited/counted even though the
 * anulación never runs), and only calls the internal command with the id
 * THAT verification returned. Same restructuring applied in lockstep to
 * `rectificar-asiento.ts` and `modules/stock/application/registrar-ajuste.ts`.
 *
 * Pipeline: `requireSession -> authorize('libro.anulacion.solicitar') ->
 * requireRecentReauth (INV-X02, the REQUESTER's own step-up) -> zod.parse`,
 * then inside the transaction:
 *   1. Lock the asiento `FOR UPDATE`; verify VIGENTE and its jornada is NOT
 *      signed (friendly pre-check, clear Spanish message -- the DB's own
 *      INV-L02 trigger is the real backstop for a race).
 *   2. INSERT `anulacion_asiento` with `autorizadoPorId` = the co-firma-
 *      verified DT id `anularAsiento` just resolved, and `anuladoPorId` =
 *      the SESSION's own user (never from input).
 *   3. D2 REVISED (2026-09-23, per-item rule): couples the underlying
 *      receta in the SAME transaction -- the receta moves to ANULADA only
 *      when, after this operation, EVERY item of the receta is "sin
 *      efecto" (own asiento ANULADO or rectificado); otherwise it is left
 *      unchanged -- see `../infrastructure/receta-coupling-repository.ts`.
 *
 * INV-L20: this command NEVER touches stock or asiento_contralor -- the
 * anulación only inserts one row (plus, per D2, the coupled receta write);
 * the DB's AFTER INSERT trigger flips the asiento's `estado` to ANULADO
 * (INV-L09), nothing else.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { ExecuteOptions } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { DomainError, NotFoundError, InvariantViolationError, mapDbError } from "@/shared/errors";
import { uuid, nonEmptyString } from "@/shared/validation";
import { mensajeParaInvarianteAnulacion } from "../domain/mensajes-invariantes";
import { lockAsientoParaAnular, getAsientoParaAnular, insertAnulacionAsiento } from "../infrastructure/asiento-repository";
import { desvincularRecetaPorAsiento } from "../infrastructure/receta-coupling-repository";
import { verificarCoFirmaDtLibroCommand } from "./verificar-co-firma-dt";

const anularAsientoInternalInput = z.object({
  asientoId: uuid,
  motivo: nonEmptyString,
  /** The id `verificarCoFirmaDtLibroCommand` returned -- NEVER trust this from raw client input, see this module's doc comment. Set ONLY by `anularAsiento`, below. */
  autorizadoPorId: uuid,
});

/** Public input: DT CREDENTIALS, not a pre-verified id -- see this module's doc comment (FIX 4). */
export interface AnularAsientoInput {
  asientoId: string;
  motivo: string;
  dtUsuarioId: string;
  dtPassword: string;
}

/** NOT exported -- see this module's doc comment (FIX 4). The only way to reach this is through `anularAsiento`, below. */
const anularAsientoInternalCommand = defineCommand({
  name: "libro.asiento.anular",
  permiso: "libro.anulacion.solicitar",
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  input: anularAsientoInternalInput,
  audit: { entidad: "asiento_recetario", accion: TipoAccion.ANULAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockAsientoParaAnular(tx, session.tenantId, input.asientoId);
    if (!locked) throw new NotFoundError("Asiento no encontrado.");

    const asiento = await getAsientoParaAnular(tx, session.tenantId, input.asientoId);
    if (!asiento) throw new NotFoundError("Asiento no encontrado.");

    if (asiento.estado !== "VIGENTE") {
      throw new DomainError("El asiento ya fue anulado.");
    }
    if (asiento.cierreDiarioId !== null) {
      throw new DomainError("La jornada del asiento ya está firmada; corresponde un asiento rectificativo.");
    }

    try {
      const anulacion = await insertAnulacionAsiento(tx, {
        tenantId: session.tenantId,
        asientoId: input.asientoId,
        motivo: input.motivo,
        autorizadoPorId: input.autorizadoPorId,
        anuladoPorId: session.usuario.id,
      });

      // D2 REVISED (2026-09-23, per-item rule): anulla la receta subyacente
      // en la MISMA transacción SOLO si, tras esta operación, TODOS sus
      // ítems quedaron sin efecto -- ver receta-coupling-repository.ts.
      await desvincularRecetaPorAsiento(tx, {
        tenantId: session.tenantId,
        preparacionId: asiento.preparacionId,
        numeroCorrelativo: asiento.numeroCorrelativo,
        motivo: input.motivo,
        usuarioId: session.usuario.id,
      });

      return {
        output: { id: anulacion.id, asientoId: input.asientoId, numeroCorrelativo: asiento.numeroCorrelativo },
        audit: {
          entidadId: input.asientoId,
          motivo: input.motivo,
          autorizadoPorId: input.autorizadoPorId,
          valorNuevo: { asientoId: input.asientoId, motivo: input.motivo },
        },
      };
    } catch (e) {
      // Same discipline as confirmar-preparacion.ts: withTenantTransaction
      // only maps errors escaping the WHOLE handler, too late for this
      // catch, so a defense-in-depth DB rejection (a race that slips past
      // the pre-checks above) is mapped explicitly here into a clear
      // Spanish DomainError before it leaves this command.
      const mapped = mapDbError(e);
      if (mapped instanceof InvariantViolationError) {
        throw new DomainError(mensajeParaInvarianteAnulacion(mapped.invariantCode));
      }
      throw mapped;
    }
  },
});

/**
 * The ONLY exported entry point for anular-asiento (FIX 4 -- see module doc
 * comment). Verifies the DT's co-firma FIRST (its own transaction,
 * `verificarCoFirmaDtLibroCommand` -- rate-limited, audits failures), and
 * ONLY on success calls the internal command with the id THAT verification
 * returned. `options` exists solely so unit tests can inject a session
 * (`shared/usecase.ts#resolveSession` only honours it under
 * `NODE_ENV=test`) -- production callers (Server Actions) never pass it.
 */
export async function anularAsiento(
  input: AnularAsientoInput,
  options?: ExecuteOptions,
): Promise<{ id: string; asientoId: string; numeroCorrelativo: string }> {
  const coFirma = await verificarCoFirmaDtLibroCommand.execute({ dtUsuarioId: input.dtUsuarioId, password: input.dtPassword }, options);
  if (!coFirma.ok) {
    throw new DomainError(coFirma.message);
  }
  return anularAsientoInternalCommand.execute(
    { asientoId: input.asientoId, motivo: input.motivo, autorizadoPorId: coFirma.dtUsuarioId },
    options,
  );
}
