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
    where: { tenantId, aliasNormalizado: { in: [...new Set(aliasesNormalizados)] }, fechaBaja: null, droga: { fechaBaja: null } },
    select: { aliasNormalizado: true, drogaId: true },
  });
}

/**
 * What `aliasNormalizado` already resolves to, for "recordar esta
 * equivalencia" (docs/specs/sinonimos-droga.md): a VIGENTE synonym of a
 * VIGENTE droga (`id` = the synonym's), or else -- `esNombre: true`, `id` =
 * the droga's -- the normalized name of a vigente droga (a synonym can never
 * repeat a droga's name, INV-DRG-002). Removed synonyms and synonyms of
 * drogas dadas de baja never block a text. `null` = free.
 */
export async function getDrogaAlias(
  tx: Prisma.TransactionClient,
  tenantId: string,
  aliasNormalizado: string,
): Promise<{ id: string; drogaId: string; esNombre?: boolean } | null> {
  const rows = await tx.$queryRaw<{ id: string; droga_id: string; es_nombre: boolean }[]>`
    SELECT id, droga_id, es_nombre FROM (
      SELECT 1 AS orden, a.id, a.droga_id, false AS es_nombre
      FROM fsj.droga_alias a
      JOIN fsj.droga d ON d.tenant_id = a.tenant_id AND d.id = a.droga_id
      WHERE a.tenant_id = ${tenantId}::uuid AND a.alias_normalizado = ${aliasNormalizado}::text AND a.fecha_baja IS NULL AND d.fecha_baja IS NULL
      UNION ALL
      SELECT 2, d.id, d.id, true
      FROM fsj.droga d
      WHERE d.tenant_id = ${tenantId}::uuid AND d.fecha_baja IS NULL AND fsj.normalizar_nombre(d.nombre) = fsj.normalizar_nombre(${aliasNormalizado}::text)
    ) t
    ORDER BY orden
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { id: row.id, drogaId: row.droga_id, esNombre: row.es_nombre } : null;
}

/** `texto` = the synonym as written on the document (display); `aliasNormalizado` = its normalized form (match key). */
export async function insertDrogaAlias(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; drogaId: string; aliasNormalizado: string; texto: string; creadoPorId: string },
): Promise<{ id: string }> {
  return tx.drogaAlias.create({ data: input, select: { id: true } });
}

export async function listUnidadesVigentesParaMatch(tx: Prisma.TransactionClient): Promise<UnidadCandidata[]> {
  return tx.unidadMedida.findMany({ where: { fechaBaja: null }, select: { id: true, codigo: true, simbolo: true } });
}
