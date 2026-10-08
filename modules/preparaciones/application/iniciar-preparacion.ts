/**
 * `iniciarPreparacion` (M11, FASE 8 point 8.1). FAR/DT (plan §7:
 * `preparaciones.iniciar`). INV-P02 (at most one non-DESCARTADA preparación
 * per ficha) is enforced by the DB's own partial unique index (migration
 * 0013) -- the app-level pre-check below exists purely to give a clear
 * Spanish message instead of a raw unique-violation.
 *
 * Starting does NOT move the receta's estado (docs/specs/reserva-stock-preparacion.md):
 * a receta stays PENDIENTE_PREPARACION until its first preparación is
 * CONFIRMADA (`confirmarPreparacionEnTx` moves it to EN_PREPARACION), so a
 * preparación discarded before that -- a released reserva de stock -- leaves
 * it editable again without any backward transition (INV-R08). While the
 * preparación is INICIADA the receta is still not editable (a LIVE
 * preparación blocks editing, `existeFichaConPreparacionParaReceta`). Both
 * paths behave the same: the toma workspace's "Reservar stock" and the ficha
 * técnica screen's "Preparar". A terminal receta (ENTREGADA/ANULADA) can
 * never start a new preparación.
 *
 * The toma (migration 0057, domain/toma.ts): the toma workspace's
 * "Continuar" dialog runs this (via `reservarStockPreparacion`, together
 * with the reserva de stock) on a receta its user already took. When it runs on
 * a receta nobody took (the ficha técnica screen's "Preparar"),
 * the starter takes it here too, so a receta with a preparación INICIADA is
 * always listed under En curso (taken + PENDIENTE_PREPARACION or
 * EN_PREPARACION). The receta is locked for that, after the ficha's
 * advisory lock -- same order as before.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { esEstadoTerminal } from "@/modules/recetas/domain/receta";
import {
  lockFichaTecnicaParaIniciar,
  getFichaParaIniciar,
  getPreparacionActivaDeFicha,
  insertPreparacion,
  lockRecetaParaTransicion,
  getTomaDeReceta,
  setTomaDeReceta,
} from "../infrastructure/preparacion-repository";

const iniciarPreparacionInput = z.object({ fichaTecnicaId: uuid });

export interface IniciarPreparacionInput {
  fichaTecnicaId: string;
}

export const iniciarPreparacionCommand = defineCommand({
  name: "preparaciones.iniciar",
  permiso: "preparaciones.iniciar",
  input: iniciarPreparacionInput,
  audit: { entidad: "preparacion", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    const iniciada = await iniciarPreparacionEnTx(tx, session, input.fichaTecnicaId);
    return {
      output: { id: iniciada.id },
      audit: {
        entidadId: iniciada.id,
        valorNuevo: {
          fichaTecnicaId: input.fichaTecnicaId,
          fichaTecnica: iniciada.fichaTecnica,
          // Only when this start also took the receta (see the module doc comment).
          ...(iniciada.tomadaPor ? { tomadaPor: iniciada.tomadaPor } : {}),
        },
      },
    };
  },
});

/**
 * The start itself (every check and write above), inside the caller's
 * transaction: also run by `reservarStockPreparacion`
 * (./reservar-stock-preparacion.ts), which starts and reserves stock in ONE
 * transaction. `fichaTecnica` is the audit's human label; `tomadaPor`, the
 * usuario's name when this start also took the receta.
 */
export async function iniciarPreparacionEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  fichaTecnicaId: string,
): Promise<{ id: string; fichaTecnica: string; tomadaPor: string | null }> {
  const locked = await lockFichaTecnicaParaIniciar(tx, session.tenantId, fichaTecnicaId);
  if (!locked) throw new NotFoundError("Ficha técnica no encontrada.");

  const ficha = await getFichaParaIniciar(tx, session.tenantId, fichaTecnicaId);
  if (!ficha) throw new NotFoundError("Ficha técnica no encontrada.");

  if (esEstadoTerminal(ficha.recetaEstado)) {
    throw new DomainError(`No se puede iniciar una preparación: la receta está en estado ${ficha.recetaEstado}.`);
  }

  const activa = await getPreparacionActivaDeFicha(tx, session.tenantId, fichaTecnicaId);
  if (activa) {
    throw new DomainError(`Ya existe una preparación activa (estado ${activa.estado}) para esta ficha técnica.`);
  }

  const preparacion = await insertPreparacion(tx, {
    tenantId: session.tenantId,
    fichaTecnicaId,
    iniciadaPorId: session.usuario.id,
  });

  let tomadaPor: string | null = null;
  const recetaLocked = await lockRecetaParaTransicion(tx, session.tenantId, ficha.recetaId);
  if (recetaLocked) {
    const toma = await getTomaDeReceta(tx, session.tenantId, ficha.recetaId);
    if (toma && toma.tomadaPorId === null) {
      await setTomaDeReceta(tx, session.tenantId, ficha.recetaId, session.usuario.id);
      tomadaPor = `${session.usuario.apellido}, ${session.usuario.nombre}`;
    }
  }

  return { id: preparacion.id, fichaTecnica: `Receta Nº ${ficha.recetaNumeroInterno} · versión ${ficha.version}`, tomadaPor };
}

export async function iniciarPreparacion(input: IniciarPreparacionInput): Promise<{ id: string }> {
  return iniciarPreparacionCommand.execute(input);
}
