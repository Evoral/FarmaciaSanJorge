/**
 * `guardarBorradorPesada` (migration 0090, openspec/specs/pesada-real/spec.md "Pesada en la ficha"): the toma workspace saves
 * each línea of a ficha técnica as the lab fills it in while weighing -- the lots in the order they are used and the
 * real weighing (or an enrase manual línea's quantity, or the INV-S18 motivo) -- so nothing typed is lost before
 * "Marcar como preparada". A draft: nothing is reserved, descontado or registered; the reserva re-validates
 * everything under its locks (`planificarConsumoEnTx`).
 *
 * Only while the ítem has no live preparación (once its stock is reserved the reserva holds the weighing). The lots
 * must be this droga's; anything else (stock, purity, tolerance) is checked by the reserva, never here. Permiso
 * `preparaciones.confirmar` (the one "Marcar como preparada" uses), no re-authentication -- like the excipiente.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { decimalString, uuid } from "@/shared/validation";
import {
  getDrogaDePartidas,
  getLineaParaBorrador,
  getPreparacionActivaDeFicha,
  upsertBorradorPesada,
  type PesadaBorrador,
} from "../infrastructure/preparacion-repository";

const MOTIVO_MAX = 500;

const guardarBorradorPesadaInput = z.object({
  lineaPesajeId: uuid,
  /** In the order the lots are used (the first one is drained before the next). */
  partidaIds: z.array(uuid).max(20).default([]),
  cantidadReal: decimalString.optional(),
  cantidadManual: decimalString.optional(),
  motivoAperturaAdicional: z.string().trim().max(MOTIVO_MAX).optional(),
});

export const guardarBorradorPesadaCommand = defineCommand({
  name: "preparaciones.pesadaBorrador.guardar",
  permiso: "preparaciones.confirmar",
  input: guardarBorradorPesadaInput,
  audit: { entidad: "linea_pesaje", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    const linea = await getLineaParaBorrador(tx, session.tenantId, input.lineaPesajeId);
    if (!linea) throw new NotFoundError("Línea de la ficha técnica no encontrada.");
    if (await getPreparacionActivaDeFicha(tx, session.tenantId, linea.fichaTecnicaId)) {
      throw new DomainError("El ítem ya tiene el stock reservado: recargá la página.");
    }

    if (new Set(input.partidaIds).size !== input.partidaIds.length) throw new DomainError("Elegiste el mismo lote dos veces.", { fields: [`partidas_${input.lineaPesajeId}`] });
    const drogas = await getDrogaDePartidas(tx, session.tenantId, input.partidaIds);
    if (input.partidaIds.some((id) => drogas.get(id) !== linea.drogaId)) {
      throw new DomainError("Un lote elegido no corresponde a la droga de la línea: recargá la página.", { fields: [`partidas_${input.lineaPesajeId}`] });
    }
    for (const [campo, valor] of [
      ["cantidadReal", input.cantidadReal],
      ["cantidadManual", input.cantidadManual],
    ] as const) {
      if (valor && !valor.greaterThan(0)) throw new DomainError("La cantidad debe ser mayor que 0.", { fields: [`${campo}_${input.lineaPesajeId}`] });
    }

    const borrador: PesadaBorrador = {
      lineaPesajeId: input.lineaPesajeId,
      partidaIds: input.partidaIds,
      cantidadReal: input.cantidadReal?.toString() ?? null,
      cantidadManual: input.cantidadManual?.toString() ?? null,
      motivoAperturaAdicional: input.motivoAperturaAdicional || null,
    };
    const anterior = await upsertBorradorPesada(tx, { ...borrador, tenantId: session.tenantId, actualizadoPorId: session.usuario.id });
    return {
      output: borrador,
      audit: { entidadId: input.lineaPesajeId, valorAnterior: anterior ? { pesadaBorrador: anterior } : null, valorNuevo: { pesadaBorrador: borrador } },
    };
  },
});

export async function guardarBorradorPesada(input: z.input<typeof guardarBorradorPesadaInput>): Promise<PesadaBorrador> {
  return guardarBorradorPesadaCommand.execute(input);
}
