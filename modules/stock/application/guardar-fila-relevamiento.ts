/**
 * `guardarFilaRelevamiento` (openspec/changes/planilla-existencia-inicial).
 * Saves a draft row of the planilla de existencia inicial (upsert by client id).
 * Permiso `stock.relevamiento.editar` (not PIN-configurable).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { fechaIso, uuid } from "@/shared/validation";
import { nonNegativeDecimalString, positiveDecimalString, potenciaDeclaradaString } from "../domain/partida";
import { dec } from "@/shared/decimal";
import { MENSAJE_RELEVAMIENTO_CERRADO } from "../domain/existencia-inicial";
import { upsertFilaRelevamiento } from "../infrastructure/relevamiento-fila-repository";
import {
  lockTenantRelevamientoCompartido,
  relevamientoInicialAbierto,
} from "../infrastructure/existencia-inicial-repository";

const guardarFilaRelevamientoInput = z.object({
  id: uuid,
  drogaId: uuid.optional().nullable(),
  lote: z.string().trim().optional().nullable(),
  fechaVencimiento: fechaIso.optional().nullable(),
  cantidad: positiveDecimalString.optional().nullable(),
  unidadMedidaId: uuid.optional().nullable(),
  potenciaDeclarada: potenciaDeclaradaString.optional().nullable(),
  costoUnitario: nonNegativeDecimalString.optional().nullable(),
  proveedorId: uuid.optional().nullable(),
  textoDroga: z.string().trim().optional().nullable(),
});

export type GuardarFilaRelevamientoInput = z.input<typeof guardarFilaRelevamientoInput>;

export const guardarFilaRelevamientoCommand = defineCommand({
  name: "stock.relevamiento.guardar_fila",
  permiso: "stock.relevamiento.editar",
  input: guardarFilaRelevamientoInput,
  audit: { entidad: "relevamiento_fila", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    await lockTenantRelevamientoCompartido(tx, session.tenantId);
    const abierto = await relevamientoInicialAbierto(tx, session.tenantId);
    if (!abierto) {
      throw new DomainError(MENSAJE_RELEVAMIENTO_CERRADO);
    }

    const fila = await upsertFilaRelevamiento(tx, {
      id: input.id,
      tenantId: session.tenantId,
      drogaId: input.drogaId || null,
      lote: input.lote || null,
      fechaVencimiento: input.fechaVencimiento ? new Date(input.fechaVencimiento) : null,
      cantidad: input.cantidad ? dec(input.cantidad) : null,
      unidadMedidaId: input.unidadMedidaId || null,
      potenciaDeclarada: input.potenciaDeclarada ? dec(input.potenciaDeclarada) : null,
      costoUnitario: input.costoUnitario ? dec(input.costoUnitario) : null,
      proveedorId: input.proveedorId || null,
      textoDroga: input.textoDroga || null,
      creadoPorId: session.usuario.id,
    });

    return {
      output: { id: fila.id },
      audit: {
        entidadId: fila.id,
        valorNuevo: {
          drogaId: fila.drogaId,
          lote: fila.lote,
          cantidad: fila.cantidad?.toString() ?? null,
          unidadMedidaId: fila.unidadMedidaId,
          proveedorId: fila.proveedorId,
        },
      },
    };
  },
});

export async function guardarFilaRelevamiento(input: GuardarFilaRelevamientoInput) {
  return guardarFilaRelevamientoCommand.execute(input);
}
