/**
 * `leerFacturaCompraPdf` -- first step of the supplier invoice import
 * (/stock/ingresar), mirroring modules/recetas/application/leer-receta-pdf.ts:
 * permiso -> trust boundary -> extraction -> parser -> match. Returns the
 * preview the form is prefilled with; NOTHING is written and the PDF only
 * lives in memory for the duration of this call (the audit row belongs to
 * the confirmation, `stock.factura.importar`).
 *
 * Match: proveedor by the issuer's CUIT; each item's droga by remembered
 * alias, then by name (modules/recetas/domain/importacion-receta.ts's
 * `resolverDroga`, same rules as the receta import); the purchase unit by
 * símbolo/código. Whatever does not match is left for the user to pick.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineQuery } from "@/shared/usecase";
import { DomainError, ValidationError } from "@/shared/errors";
import { validarArchivoPdf } from "@/shared/pdf/validar-archivo-pdf";
import { normalizarTexto } from "@/modules/recetas/domain/normalizar";
import { resolverDroga, resolverUnidad } from "@/modules/recetas/domain/importacion-receta";
import { MAX_FACTURA_PDF_BYTES, MENSAJES_ARCHIVO_FACTURA, parsearFacturaCompraPdf } from "../domain/factura-compra-pdf-parser";
import type { AdvertenciaParserFactura, BorradorFactura } from "../domain/factura-compra-pdf-parser";
import { formatearComprobante, mensajeFacturaYaImportada } from "../domain/importacion-factura-compra";
import type { AdvertenciaFactura, LineaFacturaVistaPrevia, VistaPreviaFactura } from "../domain/importacion-factura-compra";
import { extraerTextoFacturaPdf } from "../infrastructure/factura-compra-pdf.server";
import {
  buscarComprobanteImportado,
  buscarProveedorPorCuit,
  listAliasesVigentes,
  listDrogasVigentesParaMatch,
  listUnidadesVigentesParaMatch,
} from "../infrastructure/factura-compra-repository";

export type { VistaPreviaFactura };

/** `archivo` is checked by `validarArchivoPdf`, not by zod, so every step keeps its own message and order. */
const leerFacturaCompraPdfInput = z.object({ archivo: z.unknown() });

async function construirVistaPrevia(
  tx: Prisma.TransactionClient,
  tenantId: string,
  borrador: BorradorFactura,
  advertenciasParser: readonly AdvertenciaParserFactura[],
): Promise<VistaPreviaFactura> {
  const { items, ...comprobante } = borrador;
  const advertencias: AdvertenciaFactura[] = [...advertenciasParser];

  const proveedorExistente = borrador.emisorCuit ? await buscarProveedorPorCuit(tx, tenantId, borrador.emisorCuit) : null;
  if (!proveedorExistente) {
    advertencias.push({ codigo: "PROVEEDOR_SIN_MATCH", mensaje: `No hay un proveedor con el CUIT ${borrador.emisorCuit ?? "de la factura"}: elegilo o dalo de alta.` });
  } else if (proveedorExistente.fechaBaja !== null) {
    advertencias.push({ codigo: "PROVEEDOR_DADO_DE_BAJA", mensaje: `El proveedor ${proveedorExistente.razonSocial} está dado de baja.` });
  } else if (borrador.letra) {
    // Without a letra the key is incomplete: the confirmation checks again with the one the user picks.
    const clave = { proveedorId: proveedorExistente.id, letra: borrador.letra, puntoVenta: borrador.puntoVenta, numero: borrador.numero };
    const registradoEn = await buscarComprobanteImportado(tx, tenantId, clave);
    if (registradoEn) throw new DomainError(mensajeFacturaYaImportada(formatearComprobante(borrador.letra, borrador.puntoVenta, borrador.numero), registradoEn));
  }

  const [aliases, drogas, unidades] = [
    await listAliasesVigentes(tx, tenantId, items.map((item) => normalizarTexto(item.drogaTexto))),
    await listDrogasVigentesParaMatch(tx, tenantId),
    await listUnidadesVigentesParaMatch(tx),
  ];
  const nombrePorId = new Map(drogas.map((d) => [d.id, d.nombre]));

  const lineas: LineaFacturaVistaPrevia[] = items.flatMap((item) => {
    const droga = resolverDroga(item.drogaTexto, aliases, drogas);
    const unidad = resolverUnidad(item.unidadTexto, unidades);
    if (!droga) advertencias.push({ codigo: "DROGA_SIN_MATCH", mensaje: `No se encontró la droga «${item.drogaTexto}» en el catálogo: elegila, creala o marcala para no ingresar.` });
    if (!unidad) advertencias.push({ codigo: "UNIDAD_SIN_MATCH", mensaje: `No se reconoció la unidad «${item.unidadTexto}» de «${item.drogaTexto}».` });
    return item.lotes.map((lote) => ({
      codigo: item.codigo,
      descripcion: item.descripcion,
      drogaTexto: item.drogaTexto,
      drogaId: droga?.drogaId ?? null,
      drogaNombre: droga ? (nombrePorId.get(droga.drogaId) ?? null) : null,
      via: droga?.via ?? null,
      unidadTexto: item.unidadTexto,
      unidadCompraId: unidad?.id ?? null,
      cantidad: lote.cantidad,
      precioUnitario: item.precioUnitario,
      lote: lote.lote,
      despacho: lote.despacho,
      paisOrigen: lote.paisOrigen,
      fechaVencimiento: lote.fechaVencimiento,
    }));
  });

  return {
    comprobante,
    proveedor: proveedorExistente && proveedorExistente.fechaBaja === null ? { id: proveedorExistente.id, razonSocial: proveedorExistente.razonSocial } : null,
    lineas,
    advertencias,
  };
}

export const leerFacturaCompraPdfQuery = defineQuery({
  name: "stock.factura.leer",
  permiso: "stock.partida.ingresar",
  input: leerFacturaCompraPdfInput,
  handler: async ({ tx, session, input }): Promise<VistaPreviaFactura> => {
    const bytes = await validarArchivoPdf(input.archivo, MAX_FACTURA_PDF_BYTES, MENSAJES_ARCHIVO_FACTURA);
    const resultado = parsearFacturaCompraPdf(await extraerTextoFacturaPdf(bytes));
    if (!resultado.ok) throw new ValidationError(resultado.error.mensaje);
    return construirVistaPrevia(tx, session.tenantId, resultado.borrador, resultado.advertencias);
  },
});

export async function leerFacturaCompraPdf(archivo: unknown): Promise<VistaPreviaFactura> {
  return leerFacturaCompraPdfQuery.execute({ archivo });
}
