/**
 * `registrarRecepcionFisica` (M09, FASE 6 point 6.4). ATP/FAR/DT share
 * `recetas.fisica.registrar` (migration 0002's seed). INV-R09: this does
 * NOT block preparation (there is no estado gate here beyond "not already
 * registered") -- only ENTREGADA needs it, and that is INV-R07, already a
 * DB CHECK (migration 0011) this command never duplicates. Lock BEFORE the
 * fresh read (M3 discipline).
 *
 * FASE 11 / DP-34 decision 1 (2026-09-24): while the receta is
 * ENVIADA_PEND_FIRMA, this standalone path is REJECTED -- the courier
 * returns the patient's signed constancia together with the receta física
 * original, so recording "receta física recibida" for that receta must go
 * through `modules/entregas/application/confirmar-firma-recibida.ts`
 * (which sets it atomically alongside `entrega.firma_recibida` and
 * `receta.estado = ENTREGADA`), never through this bare command. Migration
 * 0040's INV-ENT-003 is a DB-level backstop for the same rule; this
 * app-level check is the primary one (clear Spanish message before ever
 * reaching the DB). The estado literal is NOT imported from
 * `modules/entregas` -- own copy per module, same discipline
 * `modules/libro/infrastructure/receta-coupling-repository.ts`'s doc
 * comment documents for `ESTADOS_TERMINALES_RECETA`.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { getRecetaParaAccion, lockRecetaParaAccion, registrarRecepcionFisica as registrarRecepcionFisicaRepo } from "../infrastructure/receta-repository";

/** FASE 11 / DP-34 decision 1: mirrors `modules/entregas/domain/entrega.ts`'s `MENSAJE_FISICA_RECHAZADA_EN_ENVIO`/`esRecepcionFisicaStandaloneRechazada` -- own copy, see module doc comment. */
const MENSAJE_FISICA_RECHAZADA_EN_ENVIO =
  'Esta receta está pendiente de confirmación de firma del envío. Usá la acción "Confirmar firma recibida" en lugar de registrar la recepción física por separado.';

const registrarRecepcionFisicaInput = z.object({ id: uuid });

export type RegistrarRecepcionFisicaInput = z.infer<typeof registrarRecepcionFisicaInput>;

export const registrarRecepcionFisicaCommand = defineCommand({
  name: "recetas.fisica.registrar",
  permiso: "recetas.fisica.registrar",
  input: registrarRecepcionFisicaInput,
  audit: { entidad: "receta", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const actual = await getRecetaParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Receta no encontrada.");

    if (actual.recetaFisicaRecibida) {
      throw new DomainError("La recepción física de esta receta ya fue registrada.");
    }

    if (actual.estado === "ENVIADA_PEND_FIRMA") {
      throw new DomainError(MENSAJE_FISICA_RECHAZADA_EN_ENVIO);
    }

    await registrarRecepcionFisicaRepo(tx, session.tenantId, input.id, session.usuario.id);

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        valorAnterior: { recetaFisicaRecibida: false },
        valorNuevo: { recetaFisicaRecibida: true, recetaFisicaRecibidaPorId: session.usuario.id },
      },
    };
  },
});

export async function registrarRecepcionFisica(input: RegistrarRecepcionFisicaInput): Promise<{ id: string }> {
  return registrarRecepcionFisicaCommand.execute(input);
}
