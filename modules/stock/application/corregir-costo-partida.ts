/**
 * `corregirCostoPartida` (M07, FASE 5 point 5.5, DP-13 RESUELTA per plan
 * §7: DT/ADM). Motivo required, audited with old and new values.
 * `costo_unitario` is not referenced by any historical snapshot/cotización
 * in this codebase (M08 reglas de precio are versioned independently, plan
 * §9 M08 INV-PR-001) -- correcting it here never rewrites a past
 * calculation.
 *
 * Lock-before-read (same M3 discipline as `registrar-ajuste.ts`):
 * `lockPartidaParaAccion` first, then a FRESH read, then an optimistic
 * `updateMany` keyed on the OLD value (mirrors
 * `modules/proveedores/infrastructure/proveedor-repository.ts#updateProveedorDatos`)
 * -- belt AND suspenders against two concurrent corrections racing.
 *
 * `unidadId` (optional, the unidad base when absent) is the unit the costo
 * was typed per -- the price of a kg, as on the invoice. It must be vigente
 * and of the droga's magnitude, and the costo is divided by the same
 * `fsj.convertir` factor as `registrarPartidaCompra`'s porUnidadCompra
 * (6 decimals). The audit keeps what was typed and in which unit.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { ConflictError, NotFoundError, ValidationError } from "@/shared/errors";
import { dec } from "@/shared/decimal";
import { uuid, nonEmptyString } from "@/shared/validation";
import { nonNegativeDecimalString } from "../domain/partida";
import {
  lockPartidaParaAccion,
  getPartidaParaAccion,
  updateCostoPartida,
  getDrogaParaIngreso,
  getUnidadesParaConversion,
  convertirUnidad,
} from "../infrastructure/partida-repository";

const corregirCostoPartidaInput = z.object({
  id: uuid,
  costoUnitarioNuevo: nonNegativeDecimalString,
  unidadId: uuid.optional(),
  motivo: nonEmptyString,
});

export interface CorregirCostoPartidaInput {
  id: string;
  costoUnitarioNuevo: string;
  /** Unit the costo was typed per; the droga's unidad base when absent. */
  unidadId?: string;
  motivo: string;
}

export const corregirCostoPartidaCommand = defineCommand({
  name: "stock.partida.costo.corregir",
  permiso: "stock.partida.costo.corregir",
  input: corregirCostoPartidaInput,
  audit: { entidad: "partida", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockPartidaParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Partida no encontrada.");

    const partida = await getPartidaParaAccion(tx, session.tenantId, input.id);
    if (!partida) throw new NotFoundError("Partida no encontrada.");

    const droga = await getDrogaParaIngreso(tx, session.tenantId, partida.drogaId);
    if (!droga) throw new NotFoundError("Droga no encontrada.");

    const costoIngresado = input.costoUnitarioNuevo.toString();
    let costoNuevo = costoIngresado;
    let ingresado: { costoIngresado: string; unidadIngresada: string } | null = null;
    if (input.unidadId && input.unidadId !== droga.unidadBaseId) {
      const unidades = await getUnidadesParaConversion(tx, [input.unidadId, droga.unidadBaseId]);
      const unidad = unidades.get(input.unidadId);
      const unidadBase = unidades.get(droga.unidadBaseId);
      if (!unidad || unidad.fechaBaja !== null) {
        throw new ValidationError("La unidad elegida no existe o está dada de baja.", { fields: ["unidadId"] });
      }
      if (unidadBase && unidad.tipoMagnitud !== unidadBase.tipoMagnitud) {
        throw new ValidationError(
          `La unidad (${unidad.simbolo}) no corresponde a ${droga.nombre}, que se mide en ${unidadBase.simbolo}.`,
          { fields: ["unidadId"] },
        );
      }
      const factor = await convertirUnidad(tx, "1", input.unidadId, droga.unidadBaseId);
      costoNuevo = dec(costoIngresado).dividedBy(factor).toDecimalPlaces(6).toString();
      ingresado = { costoIngresado, unidadIngresada: unidad.simbolo };
    }

    const updated = await updateCostoPartida(tx, {
      tenantId: session.tenantId,
      id: input.id,
      costoUnitarioNuevo: costoNuevo,
      costoUnitarioAnterior: partida.costoUnitario,
    });
    if (!updated) {
      throw new ConflictError("La partida fue modificada por otra operación. Volvé a intentarlo.");
    }

    return {
      output: { id: input.id, costoUnitario: costoNuevo },
      audit: {
        entidadId: input.id,
        valorAnterior: { costoUnitario: partida.costoUnitario },
        valorNuevo: { costoUnitario: costoNuevo, ...(ingresado ?? {}) },
        motivo: input.motivo,
      },
    };
  },
});

export async function corregirCostoPartida(input: CorregirCostoPartidaInput): Promise<{ id: string; costoUnitario: string }> {
  return corregirCostoPartidaCommand.execute(input);
}
