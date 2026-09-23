/**
 * `iniciarPreparacion` (M11, FASE 8 point 8.1). FAR/DT (plan §7:
 * `preparaciones.iniciar`). INV-P02 (at most one non-DESCARTADA preparación
 * per ficha) is enforced by the DB's own partial unique index (migration
 * 0013) -- the app-level pre-check below exists purely to give a clear
 * Spanish message instead of a raw unique-violation.
 *
 * "Starting moves the receta to EN_PREPARACION" (task scope): only when the
 * receta is still PENDIENTE_PREPARACION -- if it is already EN_PREPARACION
 * (a second ítem being started), this is a no-op (the DB's state-machine
 * trigger, migration 0011, only allows PENDIENTE_PREPARACION ->
 * EN_PREPARACION once anyway). A terminal receta (ENTREGADA/ANULADA) can
 * never start a new preparación.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { esEstadoTerminal } from "@/modules/recetas/domain/receta";
import {
  lockFichaTecnicaParaIniciar,
  getFichaParaIniciar,
  getPreparacionActivaDeFicha,
  insertPreparacion,
  lockRecetaParaTransicion,
  getRecetaEstado,
  updateRecetaEstado,
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
    const locked = await lockFichaTecnicaParaIniciar(tx, session.tenantId, input.fichaTecnicaId);
    if (!locked) throw new NotFoundError("Ficha técnica no encontrada.");

    const ficha = await getFichaParaIniciar(tx, session.tenantId, input.fichaTecnicaId);
    if (!ficha) throw new NotFoundError("Ficha técnica no encontrada.");

    if (esEstadoTerminal(ficha.recetaEstado)) {
      throw new DomainError(`No se puede iniciar una preparación: la receta está en estado ${ficha.recetaEstado}.`);
    }

    const activa = await getPreparacionActivaDeFicha(tx, session.tenantId, input.fichaTecnicaId);
    if (activa) {
      throw new DomainError(`Ya existe una preparación activa (estado ${activa.estado}) para esta ficha técnica.`);
    }

    const preparacion = await insertPreparacion(tx, {
      tenantId: session.tenantId,
      fichaTecnicaId: input.fichaTecnicaId,
      iniciadaPorId: session.usuario.id,
    });

    if (ficha.recetaEstado === "PENDIENTE_PREPARACION") {
      const recetaLocked = await lockRecetaParaTransicion(tx, session.tenantId, ficha.recetaId);
      if (recetaLocked) {
        const estadoFresco = await getRecetaEstado(tx, session.tenantId, ficha.recetaId);
        if (estadoFresco === "PENDIENTE_PREPARACION") {
          await updateRecetaEstado(tx, session.tenantId, ficha.recetaId, "EN_PREPARACION");
        }
      }
    }

    return {
      output: { id: preparacion.id },
      audit: { entidadId: preparacion.id, valorNuevo: { fichaTecnicaId: input.fichaTecnicaId } },
    };
  },
});

export async function iniciarPreparacion(input: IniciarPreparacionInput): Promise<{ id: string }> {
  return iniciarPreparacionCommand.execute(input);
}
