/**
 * `guardarExcipienteBorrador` (migration 0092, openspec/specs/excipiente-preparacion/spec.md): the toma workspace saves the
 * excipiente of a ficha técnica as it is chosen/typed -- a droga of clase EXCIPIENTE (from the catalog, never free
 * text) and its quantity in the droga's unidad base -- so nothing is lost before "Marcar como preparada". A draft:
 * nothing is reserved; the reserva re-validates it (`reservarExcipienteEnTx`). Only while the ítem has no live
 * preparación. Permiso `preparaciones.confirmar`, no re-authentication -- like the pesada en borrador.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { decimalString, uuid } from "@/shared/validation";
import { getDrogaExcipiente, getFichaParaIniciar, getPreparacionActivaDeFicha, upsertExcipienteBorrador } from "../infrastructure/preparacion-repository";

const guardarExcipienteBorradorInput = z.object({
  fichaTecnicaId: uuid,
  /** `null` = no excipiente. */
  drogaId: uuid.nullable(),
  cantidad: decimalString.optional(),
});

export const guardarExcipienteBorradorCommand = defineCommand({
  name: "preparaciones.excipienteBorrador.guardar",
  permiso: "preparaciones.confirmar",
  input: guardarExcipienteBorradorInput,
  audit: { entidad: "ficha_tecnica", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    if (!(await getFichaParaIniciar(tx, session.tenantId, input.fichaTecnicaId))) throw new NotFoundError("Ficha técnica no encontrada.");
    if (await getPreparacionActivaDeFicha(tx, session.tenantId, input.fichaTecnicaId)) {
      throw new DomainError("El ítem ya tiene el stock reservado: recargá la página.");
    }
    if (input.drogaId) {
      const droga = await getDrogaExcipiente(tx, session.tenantId, input.drogaId);
      if (!droga?.esExcipiente || !droga.vigente) throw new DomainError("Elegí un excipiente del listado.", { fields: ["excipienteDrogaId"] });
    }
    if (input.cantidad && !input.cantidad.greaterThan(0)) throw new DomainError("La cantidad debe ser mayor que 0.", { fields: ["excipienteCantidad"] });

    const nuevo = { drogaId: input.drogaId, cantidad: input.cantidad?.toString() ?? null };
    const anterior = await upsertExcipienteBorrador(tx, { tenantId: session.tenantId, fichaTecnicaId: input.fichaTecnicaId, ...nuevo, actualizadoPorId: session.usuario.id });
    return {
      output: nuevo,
      audit: { entidadId: input.fichaTecnicaId, valorAnterior: anterior ? { excipienteBorrador: anterior } : null, valorNuevo: { excipienteBorrador: nuevo } },
    };
  },
});

export async function guardarExcipienteBorrador(input: z.input<typeof guardarExcipienteBorradorInput>): Promise<{ drogaId: string | null; cantidad: string | null }> {
  return guardarExcipienteBorradorCommand.execute(input);
}
