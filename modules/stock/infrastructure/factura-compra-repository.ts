/**
 * Prisma access for the supplier invoice import (migration 0062,
 * fsj.comprobante_compra) -- ../application/leer-factura-compra-pdf.ts and
 * ../application/importar-factura-compra.ts. The droga/alias/unidad
 * lookups mirror modules/recetas/infrastructure/importacion-repository.ts
 * (same tables, same "vigentes only" rule); modules never share
 * infrastructure.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { AliasDroga, DrogaCandidata, UnidadCandidata } from "@/modules/recetas/domain/importacion-receta";

export interface ComprobanteClave {
  proveedorId: string;
  letra: string;
  puntoVenta: string;
  numero: string;
}

/** When the invoice was already imported (its registradoEn), else `null`. */
export async function buscarComprobanteImportado(tx: Prisma.TransactionClient, tenantId: string, clave: ComprobanteClave): Promise<Date | null> {
  const row = await tx.comprobanteCompra.findFirst({ where: { tenantId, ...clave }, select: { registradoEn: true } });
  return row?.registradoEn ?? null;
}

export interface ProveedorParaImportacion {
  id: string;
  razonSocial: string;
  fechaBaja: Date | null;
}

/** `cuit`: the 11 digits, as stored (migration 0028). Bajas included, so the preview can say so. */
export async function buscarProveedorPorCuit(tx: Prisma.TransactionClient, tenantId: string, cuit: string): Promise<ProveedorParaImportacion | null> {
  return tx.proveedor.findFirst({ where: { tenantId, cuit }, select: { id: true, razonSocial: true, fechaBaja: true } });
}

export interface NuevoComprobanteInput {
  tenantId: string;
  proveedorId: string;
  letra: string;
  puntoVenta: string;
  numero: string;
  fechaEmision: string; // YYYY-MM-DD
  cae: string | null;
  subtotal: string | null;
  iva: string | null;
  total: string | null;
  registradoPorId: string;
}

export async function insertComprobanteCompra(tx: Prisma.TransactionClient, input: NuevoComprobanteInput): Promise<{ id: string }> {
  return tx.comprobanteCompra.create({
    data: { ...input, fechaEmision: new Date(`${input.fechaEmision}T00:00:00Z`) },
    select: { id: true },
  });
}

export async function listDrogasVigentesParaMatch(tx: Prisma.TransactionClient, tenantId: string): Promise<DrogaCandidata[]> {
  return tx.droga.findMany({ where: { tenantId, fechaBaja: null }, select: { id: true, nombre: true } });
}

export async function listAliasesVigentes(tx: Prisma.TransactionClient, tenantId: string, aliasesNormalizados: string[]): Promise<AliasDroga[]> {
  if (aliasesNormalizados.length === 0) return [];
  return tx.drogaAlias.findMany({
    where: { tenantId, aliasNormalizado: { in: [...new Set(aliasesNormalizados)] }, droga: { fechaBaja: null } },
    select: { aliasNormalizado: true, drogaId: true },
  });
}

export async function getDrogaAlias(tx: Prisma.TransactionClient, tenantId: string, aliasNormalizado: string): Promise<{ id: string; drogaId: string } | null> {
  return tx.drogaAlias.findFirst({ where: { tenantId, aliasNormalizado }, select: { id: true, drogaId: true } });
}

export async function insertDrogaAlias(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; drogaId: string; aliasNormalizado: string; creadoPorId: string },
): Promise<{ id: string }> {
  return tx.drogaAlias.create({ data: input, select: { id: true } });
}

export async function listUnidadesVigentesParaMatch(tx: Prisma.TransactionClient): Promise<UnidadCandidata[]> {
  return tx.unidadMedida.findMany({ where: { fechaBaja: null }, select: { id: true, codigo: true, simbolo: true } });
}
