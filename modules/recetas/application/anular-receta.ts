/**
 * `anularReceta` (M09, FASE 6 point 6.5). ONLY FAR/DT hold
 * `recetas.anular` (migration 0002's seed -- unlike crear/editar,
 * which ATP also holds). The state machine allows ANULADA from any
 * non-terminal estado (INV-R08, DB trigger), but a DIRECT anulación is
 * refused (domain/anulacion.ts, checked after the lock on a fresh read):
 *
 *   - while any item's CONFIRMADA preparación still has its SISTEMA asiento
 *     in effect (D2's "sin efecto" definition, read through
 *     modules/libro/application/asientos-en-efecto.ts): the libro would
 *     keep recording the preparación of an ANULADA receta. The asiento is
 *     anulled/rectified from the Libro (DT co-signature) and D2 then
 *     anulls the receta by itself (docs/specs/libro-recetario-y-contralor.md §1);
 *   - while any preparación is still INICIADA: confirming it afterwards
 *     would create that same asiento for an ANULADA receta.
 *
 * The libro half is also a DB backstop (INV-R12, migration 0050), which
 * D2's own auto-anulación passes by construction (it only runs once no
 * asiento is in effect). The INICIADA half is app-only.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { listAsientosEnEfectoDeReceta } from "@/modules/libro/application/asientos-en-efecto";
import { MENSAJE_ANULACION_BLOQUEADA_POR_LIBRO, decidirAnulacion, mensajePreparacionEnCurso } from "../domain/anulacion";
import { puedeAnular } from "../domain/receta";
import {
  anularReceta as anularRecetaRepo,
  getRecetaParaAccion,
  itemsConPreparacionIniciada,
  listItemIds,
  lockRecetaParaAccion,
} from "../infrastructure/receta-repository";

const anularRecetaInput = z.object({ id: uuid, motivo: nonEmptyString });

export type AnularRecetaInput = z.infer<typeof anularRecetaInput>;

export const anularRecetaCommand = defineCommand({
  name: "recetas.anular",
  permiso: "recetas.anular",
  input: anularRecetaInput,
  audit: { entidad: "receta", accion: TipoAccion.ANULAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const actual = await getRecetaParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Receta no encontrada.");

    if (!puedeAnular(actual.estado)) {
      throw new DomainError(`La receta no se puede anular: su estado (${actual.estado}) ya es terminal.`);
    }

    const decision = decidirAnulacion({
      estado: actual.estado,
      itemIds: await listItemIds(tx, session.tenantId, input.id),
      asientosEnEfecto: await listAsientosEnEfectoDeReceta(tx, session.tenantId, input.id),
      itemsConPreparacionIniciada: await itemsConPreparacionIniciada(tx, session.tenantId, input.id),
    });
    if (decision.tipo === "bloqueada-libro") throw new ValidationError(MENSAJE_ANULACION_BLOQUEADA_POR_LIBRO);
    if (decision.tipo === "bloqueada-preparacion") throw new ValidationError(mensajePreparacionEnCurso(decision.item));

    await anularRecetaRepo(tx, session.tenantId, input.id, input.motivo);

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        motivo: input.motivo,
        valorAnterior: { estado: actual.estado },
        valorNuevo: { estado: "ANULADA" },
      },
    };
  },
});

export async function anularReceta(input: AnularRecetaInput): Promise<{ id: string }> {
  return anularRecetaCommand.execute(input);
}
