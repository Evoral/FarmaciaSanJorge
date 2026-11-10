/**
 * Repository for planilla de existencia inicial (`fsj.relevamiento_fila`, migration 0124).
 * Every function runs inside an open tenant transaction.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { Decimal } from "@/shared/decimal";

export interface UpsertFilaRelevamientoInput {
  id: string;
  tenantId: string;
  drogaId?: string | null;
  lote?: string | null;
  fechaVencimiento?: Date | null;
  cantidad?: Decimal | null;
  unidadMedidaId?: string | null;
  potenciaDeclarada?: Decimal | null;
  costoUnitario?: Decimal | null;
  proveedorId?: string | null;
  textoDroga?: string | null;
  creadoPorId: string;
}

export interface RelevamientoFilaRaw {
  id: string;
  tenant_id: string;
  droga_id: string | null;
  lote: string | null;
  fecha_vencimiento: string | null;
  cantidad: string | null;
  unidad_medida_id: string | null;
  potencia_declarada: string | null;
  costo_unitario: string | null;
  proveedor_id: string | null;
  texto_droga: string | null;
  creado_por_id: string;
  creado_en: Date;
  actualizado_en: Date;
}

export interface RelevamientoFilaConDetalles extends RelevamientoFilaRaw {
  droga_nombre: string | null;
  droga_clase: string | null;
  droga_unidad_base_id: string | null;
  unidad_simbolo: string | null;
  proveedor_razon_social: string | null;
  creado_por_nombre: string;
  creado_por_apellido: string;
}

export interface PartidaExistenciaInicialRaw {
  id: string;
  droga_id: string;
  droga_nombre: string;
  droga_clase: string;
  tipo_control: string | null;
  droga_unidad_base_id: string;
  unidad_simbolo: string;
  lote: string;
  proveedor_id: string | null;
  proveedor_razon_social: string | null;
  fecha_ingreso: Date;
  fecha_vencimiento: string | null;
  fecha_vencimiento_vigente: string | null;
  cantidad_inicial: string;
  cantidad_disponible: string;
  costo_unitario: string;
  potencia_declarada: string | null;
  fecha_apertura: Date | null;
  usada: boolean;
}

export interface DrogaFaltanCargarRaw {
  id: string;
  nombre: string;
  clase: string;
  unidad_base_simbolo: string;
}

export async function upsertFilaRelevamiento(
  tx: Prisma.TransactionClient,
  input: UpsertFilaRelevamientoInput,
) {
  return tx.relevamientoFila.upsert({
    where: { tenantId_id: { tenantId: input.tenantId, id: input.id } },
    create: {
      id: input.id,
      tenantId: input.tenantId,
      drogaId: input.drogaId ?? null,
      lote: input.lote ?? null,
      fechaVencimiento: input.fechaVencimiento ?? null,
      cantidad: input.cantidad ?? null,
      unidadMedidaId: input.unidadMedidaId ?? null,
      potenciaDeclarada: input.potenciaDeclarada ?? null,
      costoUnitario: input.costoUnitario ?? null,
      proveedorId: input.proveedorId ?? null,
      textoDroga: input.textoDroga ?? null,
      creadoPorId: input.creadoPorId,
    },
    update: {
      drogaId: input.drogaId ?? null,
      lote: input.lote ?? null,
      fechaVencimiento: input.fechaVencimiento ?? null,
      cantidad: input.cantidad ?? null,
      unidadMedidaId: input.unidadMedidaId ?? null,
      potenciaDeclarada: input.potenciaDeclarada ?? null,
      costoUnitario: input.costoUnitario ?? null,
      proveedorId: input.proveedorId ?? null,
      textoDroga: input.textoDroga ?? null,
    },
  });
}

export async function deleteFilaRelevamiento(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string,
): Promise<number> {
  const result = await tx.relevamientoFila.deleteMany({
    where: { tenantId, id },
  });
  return result.count;
}

export async function deleteFilasRelevamiento(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await tx.relevamientoFila.deleteMany({
    where: { tenantId, id: { in: [...ids] } },
  });
  return result.count;
}

export async function deleteAllFilasRelevamiento(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<number> {
  const result = await tx.relevamientoFila.deleteMany({
    where: { tenantId },
  });
  return result.count;
}

export async function lockFilasRelevamiento(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ids: readonly string[],
): Promise<RelevamientoFilaRaw[]> {
  if (ids.length === 0) return [];
  return tx.$queryRaw<RelevamientoFilaRaw[]>`
    SELECT id::text, tenant_id::text, droga_id::text, lote, fecha_vencimiento::text,
           cantidad::text, unidad_medida_id::text, potencia_declarada::text,
           costo_unitario::text, proveedor_id::text, texto_droga,
           creado_por_id::text, creado_en, actualizado_en
    FROM fsj.relevamiento_fila
    WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${[...ids]}::uuid[])
    ORDER BY id
    FOR UPDATE
  `;
}

export async function countFilasRelevamiento(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM fsj.relevamiento_fila
    WHERE tenant_id = ${tenantId}::uuid
  `;
  return rows[0]?.count ?? 0;
}

export interface PartidaLoteMatch {
  id: string;
  origen: "COMPRA" | "EXISTENCIA_INICIAL" | "ELABORACION_PROPIA";
  lote: string;
  fechaVencimiento: string | null;
  costoUnitario: string;
  potenciaDeclarada: string | null;
}

export async function findPartidaPorDrogaLoteProveedor(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
  lote: string,
  proveedorId?: string | null,
): Promise<PartidaLoteMatch | null> {
  const rows = await tx.$queryRaw<PartidaLoteMatch[]>`
    SELECT id::text, origen::text, lote, fecha_vencimiento::text,
           costo_unitario::text, potencia_declarada::text
    FROM fsj.partida
    WHERE tenant_id = ${tenantId}::uuid
      AND droga_id = ${drogaId}::uuid
      AND lote = ${lote}
      AND (
        (${proveedorId}::uuid IS NULL AND proveedor_id IS NULL)
        OR proveedor_id = ${proveedorId}::uuid
      )
    LIMIT 1
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function getCostoVigenteSugerido(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
  proveedorId?: string | null,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ costo_unitario: string }[]>`
    SELECT cp.costo_unitario::text
    FROM fsj.costo_proveedor cp
    WHERE cp.tenant_id = ${tenantId}::uuid
      AND cp.droga_id = ${drogaId}::uuid
      AND cp.vigente_hasta IS NULL
      AND (
        ${proveedorId}::uuid IS NULL
        OR cp.proveedor_id = ${proveedorId}::uuid
      )
    ORDER BY (cp.proveedor_id = ${proveedorId}::uuid) DESC NULLS LAST, cp.id DESC
    LIMIT 1
  `;
  return rows[0]?.costo_unitario ?? null;
}

export async function listFilasRelevamiento(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<RelevamientoFilaConDetalles[]> {
  return tx.$queryRaw<RelevamientoFilaConDetalles[]>`
    SELECT rf.id::text, rf.tenant_id::text, rf.droga_id::text, rf.lote,
           rf.fecha_vencimiento::text, rf.cantidad::text, rf.unidad_medida_id::text,
           rf.potencia_declarada::text, rf.costo_unitario::text, rf.proveedor_id::text,
           rf.texto_droga, rf.creado_por_id::text, rf.creado_en, rf.actualizado_en,
           d.nombre::text AS droga_nombre, d.clase::text AS droga_clase,
           d.unidad_base_id::text AS droga_unidad_base_id,
           u.simbolo::text AS unidad_simbolo,
           p.razon_social::text AS proveedor_razon_social,
           usr.nombre::text AS creado_por_nombre, usr.apellido::text AS creado_por_apellido
    FROM fsj.relevamiento_fila rf
    LEFT JOIN fsj.droga d ON d.tenant_id = rf.tenant_id AND d.id = rf.droga_id
    LEFT JOIN fsj.unidad_medida u ON u.id = rf.unidad_medida_id
    LEFT JOIN fsj.proveedor p ON p.tenant_id = rf.tenant_id AND p.id = rf.proveedor_id
    LEFT JOIN fsj.usuario usr ON usr.tenant_id = rf.tenant_id AND usr.id = rf.creado_por_id
    WHERE rf.tenant_id = ${tenantId}::uuid
    ORDER BY rf.creado_en ASC, rf.id ASC
  `;
}

export async function listPartidasExistenciaInicial(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<PartidaExistenciaInicialRaw[]> {
  return tx.$queryRaw<PartidaExistenciaInicialRaw[]>`
    SELECT p.id::text, p.droga_id::text, d.nombre::text AS droga_nombre,
           d.clase::text AS droga_clase, d.tipo_control::text AS tipo_control,
           d.unidad_base_id::text AS droga_unidad_base_id,
           u.simbolo::text AS unidad_simbolo,
           p.lote, p.proveedor_id::text, pr.razon_social::text AS proveedor_razon_social,
           p.fecha_ingreso, p.fecha_vencimiento::text, p.fecha_vencimiento_vigente::text,
           p.cantidad_inicial::text, p.cantidad_disponible::text,
           p.costo_unitario::text, p.potencia_declarada::text,
           p.fecha_apertura,
           (
             p.fecha_apertura IS NOT NULL
             OR EXISTS (
               SELECT 1 FROM fsj.movimiento_stock m
               WHERE m.tenant_id = p.tenant_id AND m.partida_id = p.id
                 AND m.tipo::text NOT IN ('INGRESO_INICIAL', 'CORRECCION_INICIAL_SUMA', 'CORRECCION_INICIAL_RESTA')
             )
             OR EXISTS (
               SELECT 1 FROM fsj.reserva_stock rs
               JOIN fsj.preparacion prep ON prep.tenant_id = rs.tenant_id AND prep.id = rs.preparacion_id
               WHERE rs.tenant_id = p.tenant_id AND rs.partida_id = p.id
                 AND prep.estado = 'INICIADA'
             )
             OR EXISTS (
               SELECT 1 FROM fsj.reanalisis_partida rp
               WHERE rp.tenant_id = p.tenant_id AND rp.partida_id = p.id
             )
           ) AS usada
    FROM fsj.partida p
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
    JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
    LEFT JOIN fsj.proveedor pr ON pr.tenant_id = p.tenant_id AND pr.id = p.proveedor_id
    WHERE p.tenant_id = ${tenantId}::uuid AND p.origen = 'EXISTENCIA_INICIAL'
    ORDER BY p.fecha_ingreso DESC, p.id DESC
  `;
}

export interface PartidaCoincidentePlanillaRaw {
  id: string;
  droga_id: string;
  lote: string;
  proveedor_id: string | null;
  origen: "COMPRA" | "EXISTENCIA_INICIAL" | "ELABORACION_PROPIA";
  fecha_vencimiento: string | null;
  potencia_declarada: string | null;
  costo_unitario: string | null;
}

export async function listPartidasCoincidentesFilas(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<PartidaCoincidentePlanillaRaw[]> {
  return tx.$queryRaw<PartidaCoincidentePlanillaRaw[]>`
    SELECT DISTINCT
      p.id::text,
      p.droga_id::text,
      btrim(p.lote) AS lote,
      p.proveedor_id::text,
      p.origen::text,
      p.fecha_vencimiento::text,
      p.potencia_declarada::text,
      p.costo_unitario::text
    FROM fsj.partida p
    JOIN fsj.relevamiento_fila rf
      ON rf.tenant_id = p.tenant_id
     AND rf.droga_id = p.droga_id
     AND btrim(rf.lote) = btrim(p.lote)
     AND (
       (rf.proveedor_id IS NULL AND p.proveedor_id IS NULL)
       OR rf.proveedor_id = p.proveedor_id
     )
    WHERE p.tenant_id = ${tenantId}::uuid
      AND rf.droga_id IS NOT NULL
      AND rf.lote IS NOT NULL
      AND btrim(rf.lote) <> ''
  `;
}

export async function listDrogasFaltanCargar(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<DrogaFaltanCargarRaw[]> {
  return tx.$queryRaw<DrogaFaltanCargarRaw[]>`
    SELECT d.id::text, d.nombre::text, d.clase::text, u.simbolo::text AS unidad_base_simbolo
    FROM fsj.droga d
    JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
    WHERE d.tenant_id = ${tenantId}::uuid
      AND d.fecha_baja IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM fsj.partida p
        WHERE p.tenant_id = d.tenant_id AND p.droga_id = d.id
          AND p.origen = 'EXISTENCIA_INICIAL' AND p.cantidad_inicial > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM fsj.relevamiento_fila rf
        WHERE rf.tenant_id = d.tenant_id AND rf.droga_id = d.id
      )
    ORDER BY d.nombre ASC
  `;
}

export async function countDrogasFaltanCargar(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM fsj.droga d
    WHERE d.tenant_id = ${tenantId}::uuid
      AND d.fecha_baja IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM fsj.partida p
        WHERE p.tenant_id = d.tenant_id AND p.droga_id = d.id
          AND p.origen = 'EXISTENCIA_INICIAL' AND p.cantidad_inicial > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM fsj.relevamiento_fila rf
        WHERE rf.tenant_id = d.tenant_id AND rf.droga_id = d.id
      )
  `;
  return rows[0]?.count ?? 0;
}
