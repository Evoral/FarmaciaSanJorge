/**
 * Prisma-backed access to `fsj.entrega` + the `fsj.receta` reads/writes M14
 * (FASE 11) needs. Every function runs inside an ALREADY OPEN tenant
 * transaction. `modules/entregas` cannot import
 * `modules/recetas/infrastructure/**` (eslint's `appBoundaryPatterns`
 * forbids ANY `modules/**\/*.ts` from reaching into another module's
 * `infrastructure/` layer) -- so the receta reads/locks/estado-transition
 * helpers below are OWN COPIES, same "own copy per module" discipline
 * `modules/cierres/infrastructure/cierre-repository.ts` and
 * `modules/libro/infrastructure/receta-coupling-repository.ts` already
 * establish. The DB remains authoritative for every invariant duplicated
 * here (INV-R08, INV-ENT-001/002, migrations 0011/0016/0040).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EstadoReceta } from "@/modules/recetas/domain/receta";
import type { ModalidadEntrega, ItemParaEntrega } from "../domain/entrega";

// ============================================================================
// jornada helper -- own copy (see module doc comment).
// ============================================================================

export async function jornadaActualTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ jornada: string }[]>`
    SELECT fsj.jornada_actual(${tenantId}::uuid)::text AS jornada
  `;
  if (!rows[0]) throw new Error(`jornadaActualTenant: no row for tenant ${tenantId}`);
  return rows[0].jornada;
}

// ============================================================================
// receta lock/read (own copy of modules/recetas/infrastructure/receta-repository.ts's
// lockRecetaParaAccion/getRecetaParaAccion, trimmed to what M14 needs).
// ============================================================================

/** Locks the target receta row (`SELECT ... FOR UPDATE`) BEFORE reading its state -- M3 discipline. `fsj.entrega` only has an UPDATE grant on firma_recibida/firma_recibida_en (migration 0016), so the receta row -- which fsj_app CAN lock -- is the right lock point, not the entrega row. */
export async function lockRecetaParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.receta WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

export interface RecetaParaEntrega {
  id: string;
  estado: EstadoReceta;
}

export async function getRecetaParaEntrega(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<RecetaParaEntrega | null> {
  return tx.receta.findUnique({ where: { id, tenantId }, select: { id: true, estado: true } }) as Promise<RecetaParaEntrega | null>;
}

/** One batched query resolving every item's `estadoAsiento` for a receta -- same query as `modules/recetas/infrastructure/receta-repository.ts`'s private `getEstadoAsientoPorItem` (own copy, see module doc comment). */
export async function getItemsParaEntrega(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<ItemParaEntrega[]> {
  const rows = await tx.$queryRaw<{ item_id: string; estado: "PENDIENTE" | "VIGENTE" | "SIN_EFECTO" }[]>`
    SELECT
      ir.id AS item_id,
      CASE
        WHEN a.id IS NULL THEN 'PENDIENTE'
        WHEN a.estado = 'ANULADO' OR EXISTS (
          SELECT 1 FROM fsj.asiento_recetario r WHERE r.tenant_id = a.tenant_id AND r.asiento_original_id = a.id
        ) THEN 'SIN_EFECTO'
        ELSE 'VIGENTE'
      END AS estado
    FROM fsj.item_receta ir
    LEFT JOIN fsj.preparacion p ON p.tenant_id = ir.tenant_id AND p.item_receta_id = ir.id AND p.estado = 'CONFIRMADA'
    LEFT JOIN fsj.asiento_recetario a ON a.tenant_id = p.tenant_id AND a.preparacion_id = p.id AND a.origen = 'SISTEMA'
    WHERE ir.tenant_id = ${tenantId}::uuid AND ir.receta_id = ${recetaId}::uuid
  `;
  return rows.map((r) => ({ id: r.item_id, estadoAsiento: r.estado }));
}

/** A single receta.estado UPDATE (the state machine trigger, migration 0011, validates each individual transition). Callers issue TWO of these in sequence for the PREPARADA -> LISTA_PARA_RETIRAR -> {ENTREGADA|ENVIADA_PEND_FIRMA} path -- a single UPDATE cannot skip the intermediate value (see migration 0040's header comment). */
export async function actualizarEstadoReceta(tx: Prisma.TransactionClient, tenantId: string, id: string, estado: EstadoReceta): Promise<void> {
  await tx.receta.update({ where: { id, tenantId }, data: { estado } });
}

// ============================================================================
// 11.1/11.2: entrega row.
// ============================================================================

export interface NuevaEntregaInput {
  tenantId: string;
  recetaId: string;
  modalidad: ModalidadEntrega;
  entregadaPorId: string;
}

/** INSERTs the entrega row -- must run BEFORE the receta's own estado UPDATE (migration 0040's INV-ENT-002 checks for this row's existence when estado becomes ENTREGADA). */
export async function insertEntrega(tx: Prisma.TransactionClient, input: NuevaEntregaInput): Promise<{ id: string }> {
  return tx.entrega.create({
    data: { tenantId: input.tenantId, recetaId: input.recetaId, modalidad: input.modalidad, entregadaPorId: input.entregadaPorId },
    select: { id: true },
  });
}

export interface EntregaRow {
  id: string;
  modalidad: ModalidadEntrega;
  entregadaEn: Date;
  firmaRecibida: boolean;
  firmaRecibidaEn: Date | null;
}

/**
 * `recetaId` is `@unique` (single-field, not a `(tenantId, recetaId)`
 * compound in the Prisma model -- see `prisma/schema.prisma`'s `Entrega`),
 * so this is a plain `findUnique` on it. Still tenant-safe: RLS
 * (`fsj.entrega`'s `tenant_isolation` policy, `fsj.setup_tenant_table`)
 * hides any row outside the transaction's `app.tenant_id`, and the
 * `tenantId` in the result is compared defensively below anyway.
 */
export async function getEntregaPorReceta(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<EntregaRow | null> {
  const row = await tx.entrega.findUnique({
    where: { recetaId },
    select: { id: true, tenantId: true, modalidad: true, entregadaEn: true, firmaRecibida: true, firmaRecibidaEn: true },
  });
  if (!row || row.tenantId !== tenantId) return null;
  return { id: row.id, modalidad: row.modalidad, entregadaEn: row.entregadaEn, firmaRecibida: row.firmaRecibida, firmaRecibidaEn: row.firmaRecibidaEn };
}

/**
 * 11.2 "Confirmar firma recibida" -- user decision 1: ONE atomic write,
 * entrega FIRST (so migration 0040's INV-ENT-002 sees firma_recibida=true
 * when the receta UPDATE right after it targets ENTREGADA), then the
 * receta's estado.
 */
export async function confirmarFirmaYEntregar(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: { recetaId: string; entregaId: string },
): Promise<void> {
  await tx.entrega.update({
    where: { id: input.entregaId, tenantId },
    data: { firmaRecibida: true, firmaRecibidaEn: new Date() },
  });

  await tx.receta.update({ where: { id: input.recetaId, tenantId }, data: { estado: "ENTREGADA" } });
}

// ============================================================================
// 11.1/11.2: /entregas listado (LISTA_PARA_RETIRAR/PREPARADA listas para
// entregar, ENVIADA_PEND_FIRMA esperando firma).
// ============================================================================

export interface EntregaPendienteItem {
  id: string;
  numeroInterno: string;
  pacienteNombre: string;
  pacienteApellido: string;
  medicoNombre: string;
  medicoApellido: string;
  estado: EstadoReceta;
  fechaIngreso: Date;
}

export interface ListEntregasPendientesFilter {
  tenantId: string;
  search?: string;
  page: number;
  pageSize: number;
}

const ESTADOS_LISTADO_ENTREGAS: EstadoReceta[] = ["PREPARADA", "LISTA_PARA_RETIRAR", "ENVIADA_PEND_FIRMA"];

export async function listEntregasPendientes(tx: Prisma.TransactionClient, filter: ListEntregasPendientesFilter): Promise<{ items: EntregaPendienteItem[]; total: number }> {
  const where: Prisma.RecetaWhereInput = {
    tenantId: filter.tenantId,
    estado: { in: ESTADOS_LISTADO_ENTREGAS },
    ...(filter.search && filter.search.trim().length > 0
      ? {
          paciente: {
            OR: [
              { nombre: { contains: filter.search.trim(), mode: "insensitive" as const } },
              { apellido: { contains: filter.search.trim(), mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };
  const skip = (filter.page - 1) * filter.pageSize;

  const total = await tx.receta.count({ where });
  const rows = await tx.receta.findMany({
    where,
    orderBy: [{ fechaIngreso: "asc" }],
    skip,
    take: filter.pageSize,
    select: {
      id: true,
      numeroInterno: true,
      estado: true,
      fechaIngreso: true,
      paciente: { select: { nombre: true, apellido: true } },
      medico: { select: { nombre: true, apellido: true } },
    },
  });

  return {
    items: rows.map((r) => ({
      id: r.id,
      numeroInterno: r.numeroInterno.toString(),
      pacienteNombre: r.paciente.nombre,
      pacienteApellido: r.paciente.apellido,
      medicoNombre: r.medico.nombre,
      medicoApellido: r.medico.apellido,
      estado: r.estado,
      fechaIngreso: r.fechaIngreso,
    })),
    total,
  };
}
