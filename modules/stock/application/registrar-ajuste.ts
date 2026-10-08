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
 *
 * Unit of the entered quantity: `unidadId` (optional, defaults to the
 * droga's unidad base) must pass `rechazoUnidadAjuste`
 * (modules/stock/domain/partida.ts) and is converted to the unidad base
 * via `fsj.convertir` (same as ingresar-partida.ts) AFTER the lock + fresh
 * read and BEFORE the saldo check, so the check and the stored AJUSTE
 * movement are always in the unidad base. Only the saldo-exceeded message
 * and the audit row also carry the quantity as entered.
 *
 * Reservas de stock (migration 0071, docs/specs/reserva-stock-preparacion.md):
 * an ajuste can only consume the FREE part of the partida -- saldo físico
 * minus what preparaciones INICIADA reserved. Otherwise it is refused with
 * the reserved amount and the recetas holding it (release or modify the
 * reserva first, or register the loss from the preparación itself). The
 * reservas are read AFTER the partida lock; a reserva is only ever written
 * under that same lock, so the check can not race with a new one.
 *
 * `registrarAjusteEnTx` (the checks + INSERT, inside the caller's
 * transaction) is also run by the toma workspace's "Registrar pérdida"
 * (modules/preparaciones/application/registrar-perdida-reserva.ts), which
 * links the movimiento to its preparación and may consume that preparación's
 * OWN reserva. Its `autorizadoPorId` MUST come from a co-firma verification
 * in the same request (FIX 4 above) -- that caller verifies it the same way.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { ExecuteOptions } from "@/shared/usecase";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { uuid, nonEmptyString } from "@/shared/validation";
import { MOTIVOS_AJUSTE, positiveDecimalString, ajusteExcedeSaldo, rechazoUnidadAjuste, type RechazoUnidadAjuste } from "../domain/partida";
import { dec, Decimal } from "@/shared/decimal";
import { formatCantidadExacta } from "@/shared/format/cantidad";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedSession } from "@/shared/auth/session";
import {
  lockPartidaParaAccion,
  getPartidaParaAccion,
  getUnidadesParaConversion,
  convertirUnidad,
  insertAjuste,
  getReservadoEnPreparacion,
} from "../infrastructure/partida-repository";
import { verificarCoFirmaDtCommand } from "./verificar-co-firma-dt";

const registrarAjusteInternalInput = z.object({
  partidaId: uuid,
  cantidad: positiveDecimalString,
  /** Unit `cantidad` is entered in; omitted = the droga's unidad base. */
  unidadId: uuid.optional(),
  motivoAjuste: z.enum(MOTIVOS_AJUSTE),
  observacion: nonEmptyString,
  /** The id `verificarCoFirmaDtCommand` returned -- NEVER trust this from raw client input, see this module's doc comment. Set ONLY by `registrarAjusteStock`, below. */
  autorizadoPorId: uuid,
});

/** Public input: DT CREDENTIALS, not a pre-verified id -- see this module's doc comment (FIX 4). */
export interface RegistrarAjusteInput {
  partidaId: string;
  cantidad: string;
  /** Unit `cantidad` is entered in; omitted = the droga's unidad base. */
  unidadId?: string;
  motivoAjuste: (typeof MOTIVOS_AJUSTE)[number];
  observacion: string;
  dtUsuarioId: string;
  dtPassword: string;
}

const MENSAJES_RECHAZO_UNIDAD: Record<RechazoUnidadAjuste, (simbolo: string, simboloBase: string) => string> = {
  BAJA: (simbolo) => `La unidad ${simbolo} está dada de baja. Elegí otra unidad.`,
  OTRA_MAGNITUD: (simbolo, simboloBase) => `La unidad ${simbolo} no corresponde a esta droga, que se mide en ${simboloBase}.`,
  NO_HABILITADA: (simbolo) => `La unidad ${simbolo} no está habilitada para ajustes de esta droga. Elegí una de las unidades ofrecidas.`,
};

/** NOT exported -- see this module's doc comment (FIX 4). The only way to reach this is through `registrarAjusteStock`, below. */
const registrarAjusteInternalCommand = defineCommand({
  name: "stock.ajuste.registrar",
  permiso: "stock.ajuste.registrar",
  input: registrarAjusteInternalInput,
  audit: { entidad: "movimiento_stock", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    const ajuste = await registrarAjusteEnTx(tx, session, input);
    return {
      output: { id: ajuste.id },
      audit: { entidadId: ajuste.id, valorNuevo: ajuste.valorNuevo, autorizadoPorId: input.autorizadoPorId },
    };
  },
});

export interface AjusteEnTxInput {
  partidaId: string;
  /** In `unidadId` (omitted = the droga's unidad base). */
  cantidad: Decimal;
  unidadId?: string;
  motivoAjuste: (typeof MOTIVOS_AJUSTE)[number];
  observacion: string;
  /** MUST come from a co-firma verification in the same request -- see this module's doc comment (FIX 4). */
  autorizadoPorId: string;
  /** A pérdida during this preparación: links the movimiento to it and lets it consume the preparación's OWN reserva. */
  preparacionId?: string;
}

/**
 * The ajuste itself (lock, fresh read, unit conversion, saldo + reserva check, INSERT), inside the caller's
 * transaction. Returns the movimiento and the audit's `valorNuevo`; the caller writes the audit.
 */
export async function registrarAjusteEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  input: AjusteEnTxInput,
): Promise<{ id: string; valorNuevo: Record<string, string> }> {
  const locked = await lockPartidaParaAccion(tx, session.tenantId, input.partidaId);
  if (!locked) throw new NotFoundError("Partida no encontrada.");

  const partida = await getPartidaParaAccion(tx, session.tenantId, input.partidaId);
  if (!partida) throw new NotFoundError("Partida no encontrada.");

  const unidadId = input.unidadId ?? partida.unidadBaseId;
  const unidades = await getUnidadesParaConversion(tx, [unidadId, partida.unidadBaseId]);
  const unidadBase = unidades.get(partida.unidadBaseId);
  if (!unidadBase) throw new Error(`registrarAjuste: unidad base ${partida.unidadBaseId} not found`);
  const unidad = unidades.get(unidadId);
  if (!unidad) throw new ValidationError("La unidad elegida no existe.", { fields: ["unidadId"] });
  const rechazo = rechazoUnidadAjuste(unidad, unidadBase);
  if (rechazo) {
    throw new ValidationError(MENSAJES_RECHAZO_UNIDAD[rechazo](unidad.simbolo, unidadBase.simbolo), { fields: ["unidadId"] });
  }

  const cantidadIngresada = input.cantidad.toFixed();
  const cantidadBase = dec(await convertirUnidad(tx, cantidadIngresada, unidad.id, unidadBase.id)).toFixed();
  const disponible = dec(partida.cantidadDisponible);
  if (ajusteExcedeSaldo(dec(cantidadBase), disponible)) {
    const disponibleEnUnidad = await convertirUnidad(tx, partida.cantidadDisponible, unidadBase.id, unidad.id);
    throw new DomainError(
      `La cantidad a descontar (${formatCantidadExacta(cantidadIngresada, unidad.simbolo)}) supera el saldo disponible de la partida (${formatCantidadExacta(disponibleEnUnidad, unidad.simbolo)}).`,
      { fields: ["cantidad"] },
    );
  }

  // Only the free part: saldo físico minus what OTHER preparaciones INICIADA reserved (all of them for a plain ajuste).
  const reservado = await getReservadoEnPreparacion(tx, session.tenantId, input.partidaId, input.preparacionId ?? null);
  const libre = Decimal.max(disponible.minus(dec(reservado.cantidad)), 0);
  if (ajusteExcedeSaldo(dec(cantidadBase), libre)) {
    const [reservadoEnUnidad, libreEnUnidad] = await Promise.all([
      convertirUnidad(tx, reservado.cantidad, unidadBase.id, unidad.id),
      convertirUnidad(tx, libre.toFixed(), unidadBase.id, unidad.id),
    ]);
    const recetas = reservado.recetas.map((n) => `Nº ${n}`).join(", ");
    throw new DomainError(
      `Hay ${formatCantidadExacta(reservadoEnUnidad, unidad.simbolo)} reservados en preparación (receta ${recetas}): solo podés ajustar ${formatCantidadExacta(libreEnUnidad, unidad.simbolo)}.`,
      { fields: ["cantidad"] },
    );
  }

  const movimiento = await insertAjuste(tx, {
    tenantId: session.tenantId,
    partidaId: input.partidaId,
    cantidad: cantidadBase,
    motivoAjuste: input.motivoAjuste,
    observacion: input.observacion,
    registradoPorId: session.usuario.id,
    autorizadoPorId: input.autorizadoPorId,
    preparacionId: input.preparacionId ?? null,
  });

  return {
    id: movimiento.id,
    valorNuevo: {
      partidaId: input.partidaId,
      partida: `${partida.drogaNombre} · lote ${partida.lote}`,
      cantidad: cantidadBase,
      unidadBase: unidadBase.simbolo,
      cantidadIngresada,
      unidadIngresada: unidad.simbolo,
      motivoAjuste: input.motivoAjuste,
      observacion: input.observacion,
      ...(input.preparacionId ? { preparacionId: input.preparacionId } : {}),
    },
  };
}

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
      unidadId: input.unidadId,
      motivoAjuste: input.motivoAjuste,
      observacion: input.observacion,
      autorizadoPorId: coFirma.dtUsuarioId,
    },
    options,
  );
}
