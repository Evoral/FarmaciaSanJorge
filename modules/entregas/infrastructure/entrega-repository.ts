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
 * here (INV-R08, INV-R07, INV-ENT-001/002/003, migrations 0011/0016/0040).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EstadoReceta } from "@/modules/recetas/domain/receta";
import type { ModalidadEntrega, ItemParaEntrega } from "../domain/entrega";

// ============================================================================
// jornada / parametro helpers -- own copies (see module doc comment).
// ============================================================================

export async function jornadaActualTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ jornada: string }[]>`
    SELECT fsj.jornada_actual(${tenantId}::uuid)::text AS jornada
  `;
  if (!rows[0]) throw new Error(`jornadaActualTenant: no row for tenant ${tenantId}`);
  return rows[0].jornada;
}

/** `plazo_regularizacion_dias` (DP-15 RESUELTA, migration 0040) -- defaults to 7 when the tenant somehow lacks the row. */
export async function getPlazoRegularizacionDias(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  const row = await tx.parametro.findUnique({
    where: { tenantId_clave: { tenantId, clave: "plazo_regularizacion_dias" } },
    select: { valor: true },
  });
  if (!row) return 7;
  const parsed = Number.parseInt(row.valor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 7;
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
  recetaFisicaRecibida: boolean;
}

export async function getRecetaParaEntrega(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<RecetaParaEntrega | null> {
  return tx.receta.findUnique({ where: { id, tenantId }, select: { id: true, estado: true, recetaFisicaRecibida: true } }) as Promise<RecetaParaEntrega | null>;
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

/** Own copy of modules/recetas/infrastructure/receta-repository.ts's `registrarRecepcionFisica` -- used ONLY for the "checkbox" path inside `entregas.registrar` (RETIRO_PRESENCIAL, receta física not yet recibida). */
export async function marcarRecepcionFisica(tx: Prisma.TransactionClient, tenantId: string, id: string, usuarioId: string): Promise<void> {
  await tx.receta.update({
    where: { id, tenantId },
    data: { recetaFisicaRecibida: true, recetaFisicaRecibidaEn: new Date(), recetaFisicaRecibidaPorId: usuarioId },
  });
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

/** INSERTs the entrega row -- must run BEFORE the receta's own estado UPDATE (migration 0040's INV-ENT-002 checks for this row's existence when estado becomes ENTREGADA; migration 0016's INV-R07 checks receta_fisica_recibida for RETIRO_PRESENCIAL at INSERT time). */
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
 * when the receta UPDATE right after it targets ENTREGADA), then receta
 * (receta_fisica_recibida + estado in the SAME statement, so migration
 * 0040's INV-ENT-003 sees estado changing and does not treat this as a
 * standalone 6.4).
 */
export async function confirmarFirmaYEntregar(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: { recetaId: string; entregaId: string; usuarioId: string; recetaFisicaYaRecibida: boolean },
): Promise<void> {
  await tx.entrega.update({
    where: { id: input.entregaId, tenantId },
    data: { firmaRecibida: true, firmaRecibidaEn: new Date() },
  });

  await tx.receta.update({
    where: { id: input.recetaId, tenantId },
    data: {
      estado: "ENTREGADA",
      ...(input.recetaFisicaYaRecibida
        ? {}
        : { recetaFisicaRecibida: true, recetaFisicaRecibidaEn: new Date(), recetaFisicaRecibidaPorId: input.usuarioId }),
    },
  });
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

  const [total, rows] = await Promise.all([
    tx.receta.count({ where }),
    tx.receta.findMany({
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
    }),
  ]);

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

// ============================================================================
// 11.3: /regularizacion listado + resumen (DP-15, INV-R10). Extends the same
// idea 6.6's `listRecetasPendientesFisica` uses (receta_fisica_recibida =
// false, not ANULADA), narrowed to recetas that ALREADY have at least one
// SISTEMA asiento (asentada) -- i.e. actually dispensed, not merely pending
// preparación -- and computes antigüedad in SQL from the EARLIEST such
// asiento's fecha_asiento using the tenant's jornada (never JS Date math --
// see this migration/module's gotcha notes).
// ============================================================================

export interface RegularizacionItem {
  id: string;
  numeroInterno: string;
  pacienteNombre: string;
  pacienteApellido: string;
  estado: EstadoReceta;
  fechaAsientoMasAntiguo: string;
  antiguedadDias: number;
}

export interface ListRegularizacionFilter {
  tenantId: string;
  soloVencidas?: boolean;
  plazoRegularizacionDias: number;
  search?: string;
  page: number;
  pageSize: number;
}

/** Shared WHERE fragment (SQL, raw -- Prisma has no relation from receta to "its earliest SISTEMA asiento", same reasoning as receta-coupling-repository.ts's own raw queries). */
function condicionesBase(tenantId: string, search: string | undefined) {
  return { tenantId, search: search && search.trim().length > 0 ? `%${search.trim()}%` : null };
}

export async function listRegularizacion(tx: Prisma.TransactionClient, filter: ListRegularizacionFilter): Promise<{ items: RegularizacionItem[]; total: number }> {
  const { tenantId, search } = condicionesBase(filter.tenantId, filter.search);
  const skip = (filter.page - 1) * filter.pageSize;

  const rows = await tx.$queryRaw<
    { id: string; numero_interno: string; paciente_nombre: string; paciente_apellido: string; estado: EstadoReceta; fecha_asiento: string; antiguedad_dias: number }[]
  >`
    SELECT
      r.id,
      r.numero_interno::text AS numero_interno,
      p.nombre AS paciente_nombre,
      p.apellido AS paciente_apellido,
      r.estado,
      x.fecha_asiento_mas_antiguo::text AS fecha_asiento,
      (fsj.jornada_actual(r.tenant_id) - x.fecha_asiento_mas_antiguo)::int AS antiguedad_dias
    FROM fsj.receta r
    JOIN fsj.paciente p ON p.tenant_id = r.tenant_id AND p.id = r.paciente_id
    JOIN LATERAL (
      SELECT min(a.fecha_asiento) AS fecha_asiento_mas_antiguo
      FROM fsj.item_receta ir
      JOIN fsj.preparacion prep ON prep.tenant_id = ir.tenant_id AND prep.item_receta_id = ir.id AND prep.estado = 'CONFIRMADA'
      JOIN fsj.asiento_recetario a ON a.tenant_id = prep.tenant_id AND a.preparacion_id = prep.id AND a.origen = 'SISTEMA'
      WHERE ir.tenant_id = r.tenant_id AND ir.receta_id = r.id
    ) x ON x.fecha_asiento_mas_antiguo IS NOT NULL
    WHERE r.tenant_id = ${tenantId}::uuid
      AND r.receta_fisica_recibida = false
      AND r.estado <> 'ANULADA'
      AND (${search}::text IS NULL OR p.nombre ILIKE ${search} OR p.apellido ILIKE ${search})
      AND (
        ${filter.soloVencidas ?? false} = false
        OR (fsj.jornada_actual(r.tenant_id) - x.fecha_asiento_mas_antiguo)::int > ${filter.plazoRegularizacionDias}
      )
    ORDER BY x.fecha_asiento_mas_antiguo ASC
    LIMIT ${filter.pageSize} OFFSET ${skip}
  `;

  const totalRows = await tx.$queryRaw<{ total: bigint }[]>`
    SELECT count(*)::bigint AS total
    FROM fsj.receta r
    JOIN fsj.paciente p ON p.tenant_id = r.tenant_id AND p.id = r.paciente_id
    JOIN LATERAL (
      SELECT min(a.fecha_asiento) AS fecha_asiento_mas_antiguo
      FROM fsj.item_receta ir
      JOIN fsj.preparacion prep ON prep.tenant_id = ir.tenant_id AND prep.item_receta_id = ir.id AND prep.estado = 'CONFIRMADA'
      JOIN fsj.asiento_recetario a ON a.tenant_id = prep.tenant_id AND a.preparacion_id = prep.id AND a.origen = 'SISTEMA'
      WHERE ir.tenant_id = r.tenant_id AND ir.receta_id = r.id
    ) x ON x.fecha_asiento_mas_antiguo IS NOT NULL
    WHERE r.tenant_id = ${tenantId}::uuid
      AND r.receta_fisica_recibida = false
      AND r.estado <> 'ANULADA'
      AND (${search}::text IS NULL OR p.nombre ILIKE ${search} OR p.apellido ILIKE ${search})
      AND (
        ${filter.soloVencidas ?? false} = false
        OR (fsj.jornada_actual(r.tenant_id) - x.fecha_asiento_mas_antiguo)::int > ${filter.plazoRegularizacionDias}
      )
  `;

  return {
    items: rows.map((r) => ({
      id: r.id,
      numeroInterno: r.numero_interno,
      pacienteNombre: r.paciente_nombre,
      pacienteApellido: r.paciente_apellido,
      estado: r.estado,
      fechaAsientoMasAntiguo: r.fecha_asiento,
      antiguedadDias: r.antiguedad_dias,
    })),
    total: Number(totalRows[0]?.total ?? 0),
  };
}

/** Cheap aggregate for the layout banner (same "count + oldest, no full list" discipline as `modules/cierres/infrastructure/cierre-repository.ts#getResumenPendientes`). */
export async function getResumenRegularizacion(tx: Prisma.TransactionClient, tenantId: string, plazoRegularizacionDias: number): Promise<{ cantidad: number; vencidas: number }> {
  const rows = await tx.$queryRaw<{ cantidad: bigint; vencidas: bigint }[]>`
    SELECT
      count(*)::bigint AS cantidad,
      count(*) FILTER (WHERE (fsj.jornada_actual(r.tenant_id) - x.fecha_asiento_mas_antiguo)::int > ${plazoRegularizacionDias})::bigint AS vencidas
    FROM fsj.receta r
    JOIN LATERAL (
      SELECT min(a.fecha_asiento) AS fecha_asiento_mas_antiguo
      FROM fsj.item_receta ir
      JOIN fsj.preparacion prep ON prep.tenant_id = ir.tenant_id AND prep.item_receta_id = ir.id AND prep.estado = 'CONFIRMADA'
      JOIN fsj.asiento_recetario a ON a.tenant_id = prep.tenant_id AND a.preparacion_id = prep.id AND a.origen = 'SISTEMA'
      WHERE ir.tenant_id = r.tenant_id AND ir.receta_id = r.id
    ) x ON x.fecha_asiento_mas_antiguo IS NOT NULL
    WHERE r.tenant_id = ${tenantId}::uuid
      AND r.receta_fisica_recibida = false
      AND r.estado <> 'ANULADA'
  `;
  const row = rows[0];
  return { cantidad: Number(row?.cantidad ?? 0), vencidas: Number(row?.vencidas ?? 0) };
}
