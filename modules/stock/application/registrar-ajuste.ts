/**
 * `registrarAjusteStock` (M07, FASE 5 point 5.4, DP-21b RESUELTA). FAR/DT
 * (plan §7: `stock.ajuste.registrar`). Every AJUSTE SUBTRACTS -- there is
 * no positive-adjustment code path anywhere in this stack (a surplus is a
 * NEW partida, per DP-21b and migration 0008's own header).
 *
 * FIX 4 (jd-fix-agent, 2026-09-23): the co-firma verification USED TO live
 * only in `modules/stock/ui/actions.ts` (call `verificarCoFirmaDt` first,
 * and only on `{ ok: true }` call this module's exported command with the
 * verified id) -- a convention enforced by comments, not by the type
 * system. Any OTHER caller of the exported command could pass ANY
 * `autorizadoPorId` UUID with no co-firma check at all. The internal
 * `defineCommand` instance below (`registrarAjusteInternalCommand`) is
 * therefore NEVER exported -- `registrarAjusteStock`, below, is the ONLY
 * entry point this module exposes, and it takes DT CREDENTIALS
 * (`dtUsuarioId`/`dtPassword`), not a pre-verified id: it runs
 * `verificarCoFirmaDtCommand` itself (own transaction, so a rejected
 * co-signature is still audited/counted even though the ajuste never
 * runs), and only calls the internal command with the id THAT
 * verification returned. Same restructuring applied in lockstep to
 * `modules/libro/application/anular-asiento.ts` / `rectificar-asiento.ts`.
 * This command still re-validates the DT's vigency itself
 * (`lockPartidaParaAccion` + the DB's own INV-U05 trigger fire regardless)
 * as defense in depth -- a stale `autorizadoPorId` from a slow request can
 * never silently succeed.
 *
 * Lock-before-read (M3 discipline, this codebase's recurring concurrency
 * bug family -- see modules/usuarios/infrastructure/admin-guard.ts's header
 * comment): `lockPartidaParaAccion` runs FIRST, and the balance check below
 * reads the partida via a FRESH statement AFTER the lock, never from a
 * pre-lock read -- two concurrent ajustes on the same partida serialize
 * instead of both approving against the same stale balance.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { ExecuteOptions } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid, nonEmptyString } from "@/shared/validation";
import { MOTIVOS_AJUSTE, positiveDecimalString, ajusteExcedeSaldo } from "../domain/partida";
import { dec } from "@/shared/decimal";
import { lockPartidaParaAccion, getPartidaParaAccion, insertAjuste } from "../infrastructure/partida-repository";
import { verificarCoFirmaDtCommand } from "./verificar-co-firma-dt";

const registrarAjusteInternalInput = z.object({
  partidaId: uuid,
  cantidad: positiveDecimalString,
  motivoAjuste: z.enum(MOTIVOS_AJUSTE),
  observacion: nonEmptyString,
  /** The id `verificarCoFirmaDtCommand` returned -- NEVER trust this from raw client input, see this module's doc comment. Set ONLY by `registrarAjusteStock`, below. */
  autorizadoPorId: uuid,
});

/** Public input: DT CREDENTIALS, not a pre-verified id -- see this module's doc comment (FIX 4). */
export interface RegistrarAjusteInput {
  partidaId: string;
  cantidad: string;
  motivoAjuste: (typeof MOTIVOS_AJUSTE)[number];
  observacion: string;
  dtUsuarioId: string;
  dtPassword: string;
}

/** NOT exported -- see this module's doc comment (FIX 4). The only way to reach this is through `registrarAjusteStock`, below. */
const registrarAjusteInternalCommand = defineCommand({
  name: "stock.ajuste.registrar",
  permiso: "stock.ajuste.registrar",
  input: registrarAjusteInternalInput,
  audit: { entidad: "movimiento_stock", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockPartidaParaAccion(tx, session.tenantId, input.partidaId);
    if (!locked) throw new NotFoundError("Partida no encontrada.");

    const partida = await getPartidaParaAccion(tx, session.tenantId, input.partidaId);
    if (!partida) throw new NotFoundError("Partida no encontrada.");

    const cantidad = dec(input.cantidad.toString());
    const disponible = dec(partida.cantidadDisponible);
    if (ajusteExcedeSaldo(cantidad, disponible)) {
      throw new DomainError(`La cantidad del ajuste (${cantidad.toString()}) supera el saldo disponible de la partida (${disponible.toString()}).`);
    }

    const movimiento = await insertAjuste(tx, {
      tenantId: session.tenantId,
      partidaId: input.partidaId,
      cantidad: input.cantidad.toString(),
      motivoAjuste: input.motivoAjuste,
      observacion: input.observacion,
      registradoPorId: session.usuario.id,
      autorizadoPorId: input.autorizadoPorId,
    });

    return {
      output: { id: movimiento.id },
      audit: {
        entidadId: movimiento.id,
        valorNuevo: {
          partidaId: input.partidaId,
          cantidad: input.cantidad.toString(),
          motivoAjuste: input.motivoAjuste,
          observacion: input.observacion,
        },
        autorizadoPorId: input.autorizadoPorId,
      },
    };
  },
});

/**
 * The ONLY exported entry point for registrar-ajuste (FIX 4 -- see module
 * doc comment). Verifies the DT's co-firma FIRST (its own transaction,
 * `verificarCoFirmaDtCommand` -- rate-limited, audits failures), and ONLY
 * on success calls the internal command with the id THAT verification
 * returned. `options` exists solely so unit tests can inject a session
 * (`shared/usecase.ts#resolveSession` only honours it under
 * `NODE_ENV=test`) -- production callers (Server Actions) never pass it.
 */
export async function registrarAjusteStock(input: RegistrarAjusteInput, options?: ExecuteOptions): Promise<{ id: string }> {
  const coFirma = await verificarCoFirmaDtCommand.execute({ dtUsuarioId: input.dtUsuarioId, password: input.dtPassword }, options);
  if (!coFirma.ok) {
    throw new DomainError(coFirma.message);
  }
  return registrarAjusteInternalCommand.execute(
    {
      partidaId: input.partidaId,
      cantidad: input.cantidad,
      motivoAjuste: input.motivoAjuste,
      observacion: input.observacion,
      autorizadoPorId: coFirma.dtUsuarioId,
    },
    options,
  );
}
