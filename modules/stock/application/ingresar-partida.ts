/**
 * `ingresarPartida` (M07, FASE 5 point 5.1). FAR/DT (plan §7:
 * `stock.partida.ingresar`). Registers a purchase batch: the partida INSERT
 * and its mandatory INGRESO_COMPRA movement happen in the SAME transaction
 * -- migration 0008's deferred constraint trigger (INV-STK-002) requires
 * exactly that by commit time, so there is nothing extra to orchestrate
 * here beyond calling `insertPartidaConIngreso` once.
 *
 * `cantidadCompra` is entered in whatever unit the pharmacy buys in
 * (`unidadCompraId`) and converted to the droga's unidad base via
 * `fsj.convertir` (migration 0006, INV-M01) BEFORE the INSERT -- never
 * ad-hoc arithmetic (task instruction). The purchase unit is checked FIRST
 * (exists, vigente, same `tipo_magnitud` as the unidad base) so the user
 * gets a clear Spanish message on `unidadCompraId` instead of INV-M01's.
 * `costoUnitario` is entered directly
 * per unidad base (`fsj.partida.costo_unitario`'s own definition, plan §9
 * M07), so it needs no conversion.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import {
  isoDate,
  positiveDecimalString,
  nonNegativeDecimalString,
  potenciaDeclaradaString,
  esFechaVencimientoFutura,
} from "../domain/partida";
import {
  getDrogaParaIngreso,
  getProveedorParaIngreso,
  getFechaActivacionContralor,
  getEtiquetaUnidad,
  getUnidadesParaConversion,
  convertirUnidad,
  jornadaActualTenant,
  insertPartidaConIngreso,
} from "../infrastructure/partida-repository";

const ingresarPartidaInput = z.object({
  drogaId: uuid,
  proveedorId: uuid,
  lote: nonEmptyString,
  fechaVencimiento: isoDate,
  cantidadCompra: positiveDecimalString,
  unidadCompraId: uuid,
  costoUnitario: nonNegativeDecimalString,
  numeroValeAdquisicion: z.string().trim().min(1).optional(),
  /** Migration 0058: the lot's purity (%). Optional, unless the droga requiere corrección por pureza. */
  potenciaDeclarada: potenciaDeclaradaString.optional(),
});

export interface IngresarPartidaInput {
  drogaId: string;
  proveedorId: string;
  lote: string;
  fechaVencimiento: string;
  cantidadCompra: string;
  unidadCompraId: string;
  costoUnitario: string;
  numeroValeAdquisicion?: string;
  potenciaDeclarada?: string;
}

export const ingresarPartidaCommand = defineCommand({
  name: "stock.partida.ingresar",
  permiso: "stock.partida.ingresar",
  input: ingresarPartidaInput,
  audit: { entidad: "partida", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    const droga = await getDrogaParaIngreso(tx, session.tenantId, input.drogaId);
    if (!droga) throw new NotFoundError("Droga no encontrada.");
    if (droga.fechaBaja !== null) throw new DomainError("La droga está dada de baja.", { fields: ["drogaId"] });

    const proveedor = await getProveedorParaIngreso(tx, session.tenantId, input.proveedorId);
    if (!proveedor) throw new NotFoundError("Proveedor no encontrado.");
    if (proveedor.fechaBaja !== null) throw new DomainError("El proveedor está dado de baja.", { fields: ["proveedorId"] });

    const jornadaActual = await jornadaActualTenant(tx, session.tenantId);
    if (!esFechaVencimientoFutura(input.fechaVencimiento, jornadaActual)) {
      throw new ValidationError("La fecha de vencimiento debe ser posterior a la fecha actual.", { fields: ["fechaVencimiento"] });
    }

    // INV-L16 pre-check (mirrors migration 0014's
    // fsj.movimiento_stock_validar_vale -- this is a fast app-level check
    // for a clear Spanish message; the DB trigger is the real invariant).
    const fechaActivacionContralor = await getFechaActivacionContralor(tx, session.tenantId);
    const requiereVale = droga.tipoControl !== "NINGUNO" && fechaActivacionContralor !== null;
    if (requiereVale && !input.numeroValeAdquisicion) {
      throw new ValidationError(
        "Esta droga es controlada y el contralor está activo: el número de vale de adquisición es obligatorio.",
        { fields: ["numeroValeAdquisicion"] },
      );
    }

    if (input.unidadCompraId !== droga.unidadBaseId) {
      const unidades = await getUnidadesParaConversion(tx, [input.unidadCompraId, droga.unidadBaseId]);
      const unidadCompra = unidades.get(input.unidadCompraId);
      const unidadBase = unidades.get(droga.unidadBaseId);
      if (!unidadCompra) throw new ValidationError("La unidad de compra elegida no existe.", { fields: ["unidadCompraId"] });
      if (unidadBase && unidadCompra.tipoMagnitud !== unidadBase.tipoMagnitud) {
        throw new ValidationError(
          `La unidad de compra (${unidadCompra.simbolo}) no corresponde a esta droga, que se mide en ${unidadBase.simbolo}. Elegí una unidad de la misma magnitud.`,
          { fields: ["unidadCompraId"] },
        );
      }
      if (unidadCompra.fechaBaja !== null) {
        throw new ValidationError(`La unidad de compra (${unidadCompra.simbolo}) está dada de baja. Elegí otra unidad.`, { fields: ["unidadCompraId"] });
      }
    }

    const cantidadInicialBase = await convertirUnidad(tx, input.cantidadCompra.toString(), input.unidadCompraId, droga.unidadBaseId);

    const nueva = await insertPartidaConIngreso(tx, {
      tenantId: session.tenantId,
      drogaId: input.drogaId,
      proveedorId: input.proveedorId,
      lote: input.lote,
      costoUnitario: input.costoUnitario.toString(),
      cantidadInicialBase,
      fechaVencimiento: input.fechaVencimiento,
      registradoPorId: session.usuario.id,
      numeroValeAdquisicion: input.numeroValeAdquisicion ?? null,
      potenciaDeclarada: input.potenciaDeclarada?.toString() ?? null,
    });

    return {
      output: { id: nueva.id },
      audit: {
        entidadId: nueva.id,
        valorNuevo: {
          drogaId: input.drogaId,
          droga: droga.nombre,
          proveedorId: input.proveedorId,
          proveedor: proveedor.razonSocial,
          lote: input.lote,
          fechaVencimiento: input.fechaVencimiento,
          cantidadCompra: input.cantidadCompra.toString(),
          unidadCompraId: input.unidadCompraId,
          unidadCompra: await getEtiquetaUnidad(tx, input.unidadCompraId),
          cantidadInicialBase,
          costoUnitario: input.costoUnitario.toString(),
          numeroValeAdquisicion: input.numeroValeAdquisicion ?? null,
          potenciaDeclarada: input.potenciaDeclarada?.toString() ?? null,
        },
      },
    };
  },
});

export async function ingresarPartida(input: IngresarPartidaInput): Promise<{ id: string }> {
  return ingresarPartidaCommand.execute(input);
}
