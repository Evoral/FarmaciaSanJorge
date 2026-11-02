/**
 * `guardarExcipienteBorrador` (migration 0092, openspec/specs/excipiente-preparacion/spec.md): the toma workspace saves the
 * excipiente of a ficha técnica as it is chosen/typed -- a droga of clase EXCIPIENTE (from the catalog, never free
 * text) and a weight in the droga's unidad base, of one unit or of the preparado (migration 0113) -- so nothing is lost before "Marcar como preparada". A draft:
 * nothing is reserved; the reserva re-validates it (`reservarExcipienteEnTx`). Only while the ítem has no live
 * preparación. Permiso `preparaciones.confirmar`, no re-authentication -- like the pesada en borrador.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { decimalString, uuid } from "@/shared/validation";
import { unidadesParaExcipiente } from "./excipiente-preparacion";
import { getDrogaExcipiente, getFichaParaIniciar, getPreparacionActivaDeFicha, listInsumosBorrador, upsertExcipienteBorrador } from "../infrastructure/preparacion-repository";

const guardarExcipienteBorradorInput = z.object({
  fichaTecnicaId: uuid,
  /** `null` = no excipiente. */
  drogaId: uuid.nullable(),
  cantidad: decimalString.optional(),
  /** `cantidad` is one unit's weight (only in a forma counted by units, migration 0113) instead of the preparado's. */
  porUnidad: z.boolean().default(false),
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
      // A droga is the excipiente or one insumo, never both (migration 0110).
      if ((await listInsumosBorrador(tx, session.tenantId, input.fichaTecnicaId)).some((i) => i.drogaId === input.drogaId)) {
        throw new DomainError(`${droga.nombre} ya está cargado como material o insumo: no lo elijas también como excipiente.`, { fields: ["excipienteDrogaId"] });
      }
    }
    if (input.cantidad && !input.cantidad.greaterThan(0)) throw new DomainError("La cantidad debe ser mayor que 0.", { fields: ["excipienteCantidad"] });
    if (input.porUnidad) await unidadesParaExcipiente(tx, session.tenantId, input.fichaTecnicaId);

    const nuevo = { drogaId: input.drogaId, cantidad: input.cantidad?.toString() ?? null, porUnidad: input.porUnidad };
    const anterior = await upsertExcipienteBorrador(tx, { tenantId: session.tenantId, fichaTecnicaId: input.fichaTecnicaId, ...nuevo, actualizadoPorId: session.usuario.id });
    return {
      output: nuevo,
      audit: { entidadId: input.fichaTecnicaId, valorAnterior: anterior ? { excipienteBorrador: anterior } : null, valorNuevo: { excipienteBorrador: nuevo } },
    };
  },
});

export async function guardarExcipienteBorrador(input: z.input<typeof guardarExcipienteBorradorInput>): Promise<{ drogaId: string | null; cantidad: string | null; porUnidad: boolean }> {
  return guardarExcipienteBorradorCommand.execute(input);
}
