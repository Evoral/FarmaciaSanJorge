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
 *
 * The rules live in `registrarPartidaCompra`, shared with the supplier
 * invoice import (./importar-factura-compra.ts, one call per lote): there
 * the cost comes per unidad de compra (the invoice's price) and is divided
 * by the same `fsj.convertir` factor, and `campo` prefixes each error's
 * field with the lote's row so the right input is marked.
 */
import { z } from "zod";
import Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedSession } from "@/shared/auth/session";
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
  existePartidaLote,
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
  /** Migration 0058: the lot's purity (%). Optional: empty = 100 %. */
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

/** One purchase lote, every value already validated by the caller's zod schema (decimals as strings). */
export interface PartidaCompraInput {
  drogaId: string;
  proveedorId: string;
  lote: string;
  fechaVencimiento: string;
  cantidadCompra: string;
  unidadCompraId: string;
  /** Per unidad base (manual alta) or per unidad de compra (invoice price, converted here). */
  costo: { porUnidadBase: string } | { porUnidadCompra: string };
  numeroValeAdquisicion?: string;
  potenciaDeclarada?: string;
  /** Migration 0062 -- invoice import only. */
  comprobanteCompraId?: string;
  despachoImportacion?: string | null;
  paisOrigen?: string | null;
}

/**
 * Validates and inserts one partida with its INGRESO_COMPRA movement;
 * returns its id and the audit `valorNuevo`. `campo` maps a field name to
 * the form's control name (errors point at it).
 */
export async function registrarPartidaCompra(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  input: PartidaCompraInput,
  campo: (nombre: string) => string = (nombre) => nombre,
): Promise<{ id: string; valorNuevo: Prisma.InputJsonObject }> {
  const droga = await getDrogaParaIngreso(tx, session.tenantId, input.drogaId);
  if (!droga) throw new NotFoundError("Droga no encontrada.");
  if (droga.fechaBaja !== null) throw new DomainError(`La droga ${droga.nombre} está dada de baja.`, { fields: [campo("drogaId")] });

  const proveedor = await getProveedorParaIngreso(tx, session.tenantId, input.proveedorId);
  if (!proveedor) throw new NotFoundError("Proveedor no encontrado.");
  if (proveedor.fechaBaja !== null) throw new DomainError("El proveedor está dado de baja.", { fields: ["proveedorId"] });

  if (await existePartidaLote(tx, session.tenantId, input.drogaId, input.proveedorId, input.lote)) {
    throw new ValidationError(`Ya existe una partida de ${droga.nombre} con el lote ${input.lote} de este proveedor.`, { fields: [campo("lote")] });
  }

  const jornadaActual = await jornadaActualTenant(tx, session.tenantId);
  if (!esFechaVencimientoFutura(input.fechaVencimiento, jornadaActual)) {
    throw new ValidationError("La fecha de vencimiento debe ser posterior a la fecha actual.", { fields: [campo("fechaVencimiento")] });
  }

  // INV-L16 pre-check (mirrors migration 0014's
  // fsj.movimiento_stock_validar_vale -- this is a fast app-level check
  // for a clear Spanish message; the DB trigger is the real invariant).
  const fechaActivacionContralor = await getFechaActivacionContralor(tx, session.tenantId);
  const requiereVale = droga.tipoControl !== "NINGUNO" && fechaActivacionContralor !== null;
  if (requiereVale && !input.numeroValeAdquisicion) {
    throw new ValidationError(`${droga.nombre} es controlada y el contralor está activo: el número de vale de adquisición es obligatorio.`, {
      fields: [campo("numeroValeAdquisicion")],
    });
  }

  if (input.unidadCompraId !== droga.unidadBaseId) {
    const unidades = await getUnidadesParaConversion(tx, [input.unidadCompraId, droga.unidadBaseId]);
    const unidadCompra = unidades.get(input.unidadCompraId);
    const unidadBase = unidades.get(droga.unidadBaseId);
    if (!unidadCompra) throw new ValidationError("La unidad de compra elegida no existe.", { fields: [campo("unidadCompraId")] });
    if (unidadBase && unidadCompra.tipoMagnitud !== unidadBase.tipoMagnitud) {
      throw new ValidationError(
        `La unidad de compra (${unidadCompra.simbolo}) no corresponde a ${droga.nombre}, que se mide en ${unidadBase.simbolo}. Elegí una unidad de la misma magnitud.`,
        { fields: [campo("unidadCompraId")] },
      );
    }
    if (unidadCompra.fechaBaja !== null) {
      throw new ValidationError(`La unidad de compra (${unidadCompra.simbolo}) está dada de baja. Elegí otra unidad.`, { fields: [campo("unidadCompraId")] });
    }
  }

  const cantidadInicialBase = await convertirUnidad(tx, input.cantidadCompra, input.unidadCompraId, droga.unidadBaseId);
  const costoUnitario =
    "porUnidadBase" in input.costo
      ? input.costo.porUnidadBase
      : new Decimal(input.costo.porUnidadCompra)
          .dividedBy(await convertirUnidad(tx, "1", input.unidadCompraId, droga.unidadBaseId))
          .toDecimalPlaces(6)
          .toString();

  const nueva = await insertPartidaConIngreso(tx, {
    tenantId: session.tenantId,
    drogaId: input.drogaId,
    proveedorId: input.proveedorId,
    lote: input.lote,
    costoUnitario,
    cantidadInicialBase,
    fechaVencimiento: input.fechaVencimiento,
    registradoPorId: session.usuario.id,
    numeroValeAdquisicion: input.numeroValeAdquisicion ?? null,
    potenciaDeclarada: input.potenciaDeclarada ?? null,
    comprobanteCompraId: input.comprobanteCompraId ?? null,
    despachoImportacion: input.despachoImportacion ?? null,
    paisOrigen: input.paisOrigen ?? null,
  });

  return {
    id: nueva.id,
    valorNuevo: {
      drogaId: input.drogaId,
      droga: droga.nombre,
      proveedorId: input.proveedorId,
      proveedor: proveedor.razonSocial,
      lote: input.lote,
      fechaVencimiento: input.fechaVencimiento,
      cantidadCompra: input.cantidadCompra,
      unidadCompraId: input.unidadCompraId,
      unidadCompra: await getEtiquetaUnidad(tx, input.unidadCompraId),
      cantidadInicialBase,
      costoUnitario,
      numeroValeAdquisicion: input.numeroValeAdquisicion ?? null,
      potenciaDeclarada: input.potenciaDeclarada ?? null,
      ...(input.comprobanteCompraId
        ? { comprobanteCompraId: input.comprobanteCompraId, despachoImportacion: input.despachoImportacion ?? null, paisOrigen: input.paisOrigen ?? null }
        : {}),
    },
  };
}

export const ingresarPartidaCommand = defineCommand({
  name: "stock.partida.ingresar",
  permiso: "stock.partida.ingresar",
  input: ingresarPartidaInput,
  audit: { entidad: "partida", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    const { id, valorNuevo } = await registrarPartidaCompra(tx, session, {
      drogaId: input.drogaId,
      proveedorId: input.proveedorId,
      lote: input.lote,
      fechaVencimiento: input.fechaVencimiento,
      cantidadCompra: input.cantidadCompra.toString(),
      unidadCompraId: input.unidadCompraId,
      costo: { porUnidadBase: input.costoUnitario.toString() },
      numeroValeAdquisicion: input.numeroValeAdquisicion,
      potenciaDeclarada: input.potenciaDeclarada?.toString(),
    });
    return { output: { id }, audit: { entidadId: id, valorNuevo } };
  },
});

export async function ingresarPartida(input: IngresarPartidaInput): Promise<{ id: string }> {
  return ingresarPartidaCommand.execute(input);
}
