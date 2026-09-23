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
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { ConflictError, NotFoundError } from "@/shared/errors";
import { uuid, nonEmptyString } from "@/shared/validation";
import { nonNegativeDecimalString } from "../domain/partida";
import { lockPartidaParaAccion, getPartidaParaAccion, updateCostoPartida } from "../infrastructure/partida-repository";

const corregirCostoPartidaInput = z.object({
  id: uuid,
  costoUnitarioNuevo: nonNegativeDecimalString,
  motivo: nonEmptyString,
});

export interface CorregirCostoPartidaInput {
  id: string;
  costoUnitarioNuevo: string;
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

    const costoNuevo = input.costoUnitarioNuevo.toString();
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
        valorNuevo: { costoUnitario: costoNuevo },
        motivo: input.motivo,
      },
    };
  },
});

export async function corregirCostoPartida(input: CorregirCostoPartidaInput): Promise<{ id: string; costoUnitario: string }> {
  return corregirCostoPartidaCommand.execute(input);
}
