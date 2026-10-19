/**
 * `reanclarLibro` -- the DT accepts ONE hole in a libro's hash chain from `/libro/integridad` (migration 0087,
 * docs/specs/libro-recetario-y-contralor.md "Reanclaje de la cadena").
 *
 * Only a HOLE is re-anchorable: rows missing from the numbering, so the next existing row points to a hash that is
 * gone. A row sitting at the broken number (content edited) and a missing tail are refused: those are not a deletion
 * of whole rows and nothing here can vouch for them. Rows are never renumbered nor re-hashed, so the printed libro
 * keeps matching the database. The record is append-only and audited; the aviso goes away only because
 * `fsj.verificar_cadena` now accepts exactly this hole.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { DomainError } from "@/shared/errors";
import { uuid, nonEmptyString } from "@/shared/validation";
import { verificarCadenaLibro } from "../infrastructure/asiento-repository";
import { insertReanclaje, leerHuecoDesde } from "../infrastructure/reanclaje-repository";

const reanclarLibroInput = z.object({
  libroId: uuid,
  motivo: nonEmptyString,
});

export const reanclarLibroCommand = defineCommand({
  name: "libro.integridad.reanclar",
  permiso: "libro.anulacion.autorizar",
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  input: reanclarLibroInput,
  audit: { entidad: "libro_reanclaje", accion: TipoAccion.AUTORIZAR },
  handler: async ({ tx, session, input }) => {
    const quiebre = await verificarCadenaLibro(tx, session.tenantId, input.libroId);
    if (quiebre === null) throw new DomainError("La cadena de este libro está intacta: no hay nada que reanclar.");

    const hueco = await leerHuecoDesde(tx, session.tenantId, input.libroId, quiebre);
    if (!hueco) {
      throw new DomainError("La cadena se cortó al final del libro (faltan asientos finales o el contador no coincide). No se puede reanclar: revisá la auditoría.");
    }
    if (hueco.hayFilaEnElQuiebre) {
      throw new DomainError(`El asiento Nº ${quiebre} existe pero su contenido o su enlace no coincide con el hash guardado: eso no es un asiento faltante y no se puede reanclar. Revisá la auditoría.`);
    }

    const reanclaje = await insertReanclaje(tx, {
      tenantId: session.tenantId,
      libroId: input.libroId,
      numeroEsperado: quiebre,
      desdeNumero: hueco.desdeNumero,
      hashAnteriorAceptado: hueco.hashAnterior,
      motivo: input.motivo,
      registradoPorId: session.usuario.id,
    });

    return {
      output: { id: reanclaje.id, numeroEsperado: quiebre, desdeNumero: hueco.desdeNumero },
      audit: {
        entidadId: reanclaje.id,
        motivo: input.motivo,
        valorNuevo: { libroId: input.libroId, faltante: `Nº ${quiebre}`, retomaEn: `Nº ${hueco.desdeNumero}` },
      },
    };
  },
});

export async function reanclarLibro(input: z.input<typeof reanclarLibroInput>): Promise<{ id: string; numeroEsperado: string; desdeNumero: string }> {
  return reanclarLibroCommand.execute(input);
}
