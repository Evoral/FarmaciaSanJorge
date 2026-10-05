/**
 * `importarFacturaCompra` -- confirmation of a supplier invoice import
 * (/stock/ingresar). Permiso `stock.partida.ingresar`. ONE transaction,
 * all or nothing:
 *
 *   1. the invoice is checked again for a previous import (UNIQUE
 *      (tenant, proveedor, letra, punto_venta, numero), migration 0062) and
 *      inserted as fsj.comprobante_compra;
 *   2. one partida + INGRESO_COMPRA per row (lote), through the SAME rules
 *      as the manual alta (`registrarPartidaCompra`, ./ingresar-partida.ts):
 *      the invoice's price is per unidad de compra and is converted there;
 *   3. the droga aliases the user chose to remember (same table and rules
 *      as the receta import's "recordar esta equivalencia").
 *
 * The client only sends back the preview plus the user's edits (droga,
 * unidad, cantidad, precio, lote, vencimiento, pureza, vale); everything is
 * validated again here. Errors on a row point at that row's control
 * (`lineas.<i>.<campo>`).
 *
 * Audit: one row per created entity (comprobante, each partida, each
 * alias), recorded with `audit.record` in the same transaction -- the
 * pipeline's built-in audit writes exactly one, so this command opts out
 * (as modules/recetas/application/importar-receta.ts does).
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { record as auditRecord } from "@/shared/audit";
import { ConflictError, DomainError, ValidationError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { normalizarTexto } from "@/modules/recetas/domain/normalizar";
import { isoDate, nonNegativeDecimalString, positiveDecimalString, potenciaDeclaradaString } from "../domain/partida";
import { formatearComprobante, mensajeFacturaYaImportada } from "../domain/importacion-factura-compra";
import { buscarComprobanteImportado, getDrogaAlias, insertComprobanteCompra, insertDrogaAlias } from "../infrastructure/factura-compra-repository";
import { registrarPartidaCompra } from "./ingresar-partida";

const CONTEXTO_IMPORTACION = { origen: "importacion_factura_pdf" } as const;

const textoOpcional = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((v) => (v ? v : null));

const importeOpcional = nonNegativeDecimalString.nullish().transform((v) => (v == null ? null : v.toString()));

const lineaInput = z.object({
  drogaId: uuid,
  lote: nonEmptyString,
  /** Optional for an insumo (migration 0064) -- checked in `registrarPartidaCompra`. */
  fechaVencimiento: isoDate.optional(),
  cantidadCompra: positiveDecimalString,
  unidadCompraId: uuid,
  precioUnitario: nonNegativeDecimalString,
  potenciaDeclarada: potenciaDeclaradaString.optional(),
  numeroValeAdquisicion: z.string().trim().min(1).optional(),
  despachoImportacion: textoOpcional,
  paisOrigen: textoOpcional,
});

const importarFacturaCompraInput = z.object({
  proveedorId: uuid,
  letra: z.enum(["A", "B", "C", "M"]),
  puntoVenta: z.string().trim().regex(/^\d{1,5}$/, "Punto de venta inválido.").transform((v) => v.replace(/^0+(?=\d)/, "")),
  numero: z.string().trim().regex(/^\d{1,8}$/, "Número de comprobante inválido.").transform((v) => v.replace(/^0+(?=\d)/, "")),
  fechaEmision: isoDate,
  cae: textoOpcional,
  subtotal: importeOpcional,
  iva: importeOpcional,
  total: importeOpcional,
  lineas: z.array(lineaInput).min(1, "La factura no tiene ningún lote para ingresar."),
  equivalencias: z.array(z.object({ aliasTexto: z.string().trim().min(1).max(200), drogaId: uuid })).default([]),
});

/** What the form sends (decimals as strings, optional fields possibly absent). */
export type ImportarFacturaCompraWireInput = z.input<typeof importarFacturaCompraInput>;

export const importarFacturaCompraCommand = defineCommand({
  name: "stock.factura.importar",
  permiso: "stock.partida.ingresar",
  input: importarFacturaCompraInput,
  audit: {
    skip: true,
    reason: "Writes one audit row per created entity (comprobante, each partida, each droga alias) itself, via audit.record in the same transaction -- see the module doc comment.",
  },
  handler: async ({ tx, session, input }) => {
    const auditar = (entidad: string, entidadId: string, valorNuevo: Prisma.InputJsonValue) =>
      auditRecord(tx, { tenantId: session.tenantId, usuarioId: session.usuario.id, entidad, entidadId, accion: TipoAccion.CREAR, contexto: CONTEXTO_IMPORTACION, valorNuevo });

    const comprobante = formatearComprobante(input.letra, input.puntoVenta, input.numero);
    const clave = { proveedorId: input.proveedorId, letra: input.letra, puntoVenta: input.puntoVenta, numero: input.numero };
    const registradoEn = await buscarComprobanteImportado(tx, session.tenantId, clave);
    if (registradoEn) throw new DomainError(mensajeFacturaYaImportada(comprobante, registradoEn));

    // Two rows for the same (droga, lote) would collide on partida's UNIQUE: point at the second one.
    const vistos = new Set<string>();
    input.lineas.forEach((linea, i) => {
      const clave = `${linea.drogaId}|${linea.lote}`;
      if (vistos.has(clave)) throw new ValidationError(`El lote ${linea.lote} está repetido para la misma droga.`, { fields: [`lineas.${i}.lote`] });
      vistos.add(clave);
    });

    const nuevo = await insertComprobanteCompra(tx, {
      tenantId: session.tenantId,
      ...clave,
      fechaEmision: input.fechaEmision,
      cae: input.cae,
      subtotal: input.subtotal,
      iva: input.iva,
      total: input.total,
      registradoPorId: session.usuario.id,
    });

    const partidas: string[] = [];
    for (const [i, linea] of input.lineas.entries()) {
      const { id, valorNuevo } = await registrarPartidaCompra(
        tx,
        session,
        {
          drogaId: linea.drogaId,
          proveedorId: input.proveedorId,
          lote: linea.lote,
          fechaVencimiento: linea.fechaVencimiento,
          cantidadCompra: linea.cantidadCompra.toString(),
          unidadCompraId: linea.unidadCompraId,
          costo: { porUnidadCompra: linea.precioUnitario.toString() },
          numeroValeAdquisicion: linea.numeroValeAdquisicion,
          potenciaDeclarada: linea.potenciaDeclarada?.toString(),
          comprobanteCompraId: nuevo.id,
          despachoImportacion: linea.despachoImportacion,
          paisOrigen: linea.paisOrigen,
        },
        (campo) => `lineas.${i}.${campo}`,
      );
      await auditar("partida", id, { ...valorNuevo, precioUnitarioFactura: linea.precioUnitario.toString() });
      partidas.push(id);
    }

    await auditar("comprobante_compra", nuevo.id, {
      ...clave,
      comprobante,
      fechaEmision: input.fechaEmision,
      cae: input.cae,
      subtotal: input.subtotal,
      iva: input.iva,
      total: input.total,
      partidas,
    });

    // "Recordar esta equivalencia": idempotent for the same droga, a conflict for another one.
    const aliasVistos = new Set<string>();
    for (const equivalencia of input.equivalencias) {
      const aliasNormalizado = normalizarTexto(equivalencia.aliasTexto);
      if (aliasNormalizado.length === 0 || aliasVistos.has(aliasNormalizado)) continue;
      aliasVistos.add(aliasNormalizado);
      const existente = await getDrogaAlias(tx, session.tenantId, aliasNormalizado);
      if (existente) {
        if (existente.drogaId === equivalencia.drogaId) continue;
        throw new ConflictError(`«${equivalencia.aliasTexto}» ya está asociado a otra droga. Volvé a leer la factura.`);
      }
      const alias = await insertDrogaAlias(tx, { tenantId: session.tenantId, drogaId: equivalencia.drogaId, aliasNormalizado, creadoPorId: session.usuario.id });
      await auditar("droga_alias", alias.id, { aliasNormalizado, drogaId: equivalencia.drogaId });
    }

    return { output: { id: nuevo.id, partidas: partidas.length } };
  },
});

export async function importarFacturaCompra(input: ImportarFacturaCompraWireInput): Promise<{ id: string; partidas: number }> {
  return importarFacturaCompraCommand.execute(input);
}
