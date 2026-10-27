/**
 * `ingresarExistenciaInicial` (openspec/specs/existencia-inicial/spec.md R2-R5). A
 * physical envase counted at the relevamiento inicial becomes a partida of
 * origen EXISTENCIA_INICIAL with its INGRESO_INICIAL, through the SAME rules
 * as a manual purchase alta (`registrarPartidaCompra`): unit conversion,
 * vencimiento, potencia, lote uniqueness. Differences: proveedor optional, no
 * vale de adquisición, and only while the relevamiento is open (checked
 * there with a clear message; INV-S24 is the real invariant).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { nonEmptyString, uuid } from "@/shared/validation";
import { isoDate, positiveDecimalString, nonNegativeDecimalString, potenciaDeclaradaString } from "../domain/partida";
import { registrarPartidaCompra } from "./ingresar-partida";

const ingresarExistenciaInicialInput = z.object({
  drogaId: uuid,
  proveedorId: uuid.optional(),
  lote: nonEmptyString,
  fechaVencimiento: isoDate.optional(),
  cantidadCompra: positiveDecimalString,
  unidadCompraId: uuid,
  costoUnitario: nonNegativeDecimalString,
  potenciaDeclarada: potenciaDeclaradaString.optional(),
});

export interface IngresarExistenciaInicialInput {
  drogaId: string;
  proveedorId?: string;
  lote: string;
  fechaVencimiento?: string;
  /** The counted quantity, in `unidadCompraId`. */
  cantidadCompra: string;
  unidadCompraId: string;
  /** Per unidad base. */
  costoUnitario: string;
  potenciaDeclarada?: string;
}

export const ingresarExistenciaInicialCommand = defineCommand({
  name: "stock.partida.existencia_inicial",
  permiso: "stock.partida.ingresar",
  input: ingresarExistenciaInicialInput,
  audit: { entidad: "partida", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    const { id, valorNuevo } = await registrarPartidaCompra(tx, session, {
      origen: "EXISTENCIA_INICIAL",
      drogaId: input.drogaId,
      proveedorId: input.proveedorId ?? null,
      lote: input.lote,
      fechaVencimiento: input.fechaVencimiento,
      cantidadCompra: input.cantidadCompra.toString(),
      unidadCompraId: input.unidadCompraId,
      costo: { porUnidadBase: input.costoUnitario.toString() },
      potenciaDeclarada: input.potenciaDeclarada?.toString(),
    });
    return { output: { id }, audit: { entidadId: id, valorNuevo } };
  },
});

export async function ingresarExistenciaInicial(input: IngresarExistenciaInicialInput): Promise<{ id: string }> {
  return ingresarExistenciaInicialCommand.execute(input);
}
