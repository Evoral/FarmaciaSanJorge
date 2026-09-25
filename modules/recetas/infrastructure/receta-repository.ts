/**
 * Prisma-backed access to `fsj.receta` / `fsj.item_receta` /
 * `fsj.componente_item_receta` for M09 (FASE 6 points 6.1/6.3/6.4/6.5/6.6).
 * Every function runs inside an ALREADY OPEN tenant transaction. The DB
 * remains authoritative for the state machine (INV-R08), INV-R01/V1/V2/V3
 * (deferred constraint triggers), V6/V7/V8/V9 (CHECKs) and, since migration
 * 0030, INV-R11 (item/componente DELETE only while editable) -- everything
 * here that duplicates a check exists purely to produce a clear Spanish
 * message before the DB rejects it.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EstadoReceta, FormaFarmaceutica, ModoExpresion, OrigenReceta } from "../domain/receta";

// ============================================================================
// Tenant jornada (fecha_prescripcion <= hoy check) -- own copy per module,
// same convention as modules/stock/infrastructure/partida-repository.ts's
// `jornadaActualTenant`.
// ============================================================================

export async function jornadaActualTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ jornada: string }[]>`
    SELECT fsj.jornada_actual(${tenantId}::uuid)::text AS jornada
  `;
  if (!rows[0]) throw new Error(`jornadaActualTenant: no row for tenant ${tenantId}`);
  return rows[0].jornada;
}

// ============================================================================
// Cross-module reference reads (paciente/médico/droga) -- own minimal copies
// per module, same convention as every other module's repository (e.g.
// modules/stock/infrastructure/partida-repository.ts's getDrogaParaIngreso/
// getProveedorParaIngreso).
// ============================================================================

export interface PacienteRef {
  id: string;
  nombre: string;
  apellido: string;
  fechaBaja: Date | null;
}

export async function getPacienteRefParaReceta(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PacienteRef | null> {
  return tx.paciente.findUnique({ where: { id, tenantId }, select: { id: true, nombre: true, apellido: true, fechaBaja: true } });
}

export interface MedicoRef {
  id: string;
  nombre: string;
  apellido: string;
  matricula: string;
  fechaBaja: Date | null;
}

export async function getMedicoRefParaReceta(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<MedicoRef | null> {
  return tx.medico.findUnique({
    where: { id, tenantId },
    select: { id: true, nombre: true, apellido: true, matricula: true, fechaBaja: true },
  });
}

/** Every id in `drogaIds` that is EITHER missing (wrong tenant/never existed) OR given de baja -- used to produce one clear message instead of a raw FK violation. */
export async function drogasInvalidas(tx: Prisma.TransactionClient, tenantId: string, drogaIds: string[]): Promise<string[]> {
  if (drogaIds.length === 0) return [];
  const unicos = Array.from(new Set(drogaIds));
  const vigentes = await tx.droga.findMany({
    where: { tenantId, id: { in: unicos }, fechaBaja: null },
    select: { id: true },
  });
  const vigentesSet = new Set(vigentes.map((d) => d.id));
  return unicos.filter((id) => !vigentesSet.has(id));
}

/** Every id in `unidadIds` that does not exist in the GLOBAL unidad_medida catalog, or is given de baja. */
export async function unidadesInvalidas(tx: Prisma.TransactionClient, unidadIds: string[]): Promise<string[]> {
  if (unidadIds.length === 0) return [];
  const unicos = Array.from(new Set(unidadIds));
  const vigentes = await tx.unidadMedida.findMany({ where: { id: { in: unicos }, fechaBaja: null }, select: { id: true } });
  const vigentesSet = new Set(vigentes.map((u) => u.id));
  return unicos.filter((id) => !vigentesSet.has(id));
}

// ============================================================================
// Droga / unidad pickers (6.1 -- "declared under recetas.crear so
// ATENCION_PUBLICO can use it", must exclude drogas given de baja). Own
// copies, NOT modules/drogas's (gated on drogas.editar, which ATP lacks).
// ============================================================================

export interface DrogaOpcion {
  id: string;
  nombre: string;
  unidadBaseId: string;
  unidadBaseSimbolo: string;
}

export async function listDrogasParaReceta(
  tx: Prisma.TransactionClient,
  tenantId: string,
  search?: string,
  limit = 20,
): Promise<DrogaOpcion[]> {
  const rows = await tx.droga.findMany({
    where: {
      tenantId,
      fechaBaja: null,
      ...(search && search.trim().length > 0 ? { nombre: { contains: search.trim(), mode: "insensitive" as const } } : {}),
    },
    orderBy: { nombre: "asc" },
    take: limit,
    select: { id: true, nombre: true, unidadBaseId: true, unidadBase: { select: { simbolo: true } } },
  });
  return rows.map((r) => ({ id: r.id, nombre: r.nombre, unidadBaseId: r.unidadBaseId, unidadBaseSimbolo: r.unidadBase.simbolo }));
}

export interface UnidadOpcion {
  id: string;
  nombre: string;
  simbolo: string;
  tipoMagnitud: string;
}

export async function listUnidadesParaReceta(tx: Prisma.TransactionClient): Promise<UnidadOpcion[]> {
  const rows = await tx.unidadMedida.findMany({
    where: { fechaBaja: null },
    orderBy: [{ tipoMagnitud: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true, simbolo: true, tipoMagnitud: true },
  });
  return rows;
}

// ============================================================================
// 6.1: alta -- receta + items + componentes, ONE transaction.
// ============================================================================

export interface NuevoComponenteInput {
  drogaId: string;
  cantidad: string | null;
  unidadMedidaId: string;
  modoExpresion: ModoExpresion;
  esPrincipioActivo: boolean;
}

export interface NuevoItemInput {
  descripcion: string | null;
  formaFarmaceutica: FormaFarmaceutica;
  cantidadUnidades: number;
  fraccionDosisPorUnidad: string;
  cantidadTotal: string | null;
  unidadTotalId: string | null;
  observaciones: string | null;
  componentes: NuevoComponenteInput[];
}

export interface NuevaRecetaInput {
  tenantId: string;
  pacienteId: string;
  medicoId: string;
  fechaPrescripcion: string; // YYYY-MM-DD
  origen: OrigenReceta;
  recetaFisicaRecibida: boolean;
  registradaPorId: string;
  items: NuevoItemInput[];
}

async function insertComponentes(
  tx: Prisma.TransactionClient,
  tenantId: string,
  itemRecetaId: string,
  componentes: NuevoComponenteInput[],
): Promise<void> {
  for (const [idx, c] of componentes.entries()) {
    await tx.componenteItemReceta.create({
      data: {
        tenantId,
        itemRecetaId,
        drogaId: c.drogaId,
        cantidad: c.cantidad,
        unidadMedidaId: c.unidadMedidaId,
        modoExpresion: c.modoExpresion,
        esPrincipioActivo: c.esPrincipioActivo,
        orden: idx,
      },
    });
  }
}

export async function insertRecetaConItems(tx: Prisma.TransactionClient, input: NuevaRecetaInput): Promise<{ id: string; numeroInterno: string }> {
  const receta = await tx.receta.create({
    data: {
      tenantId: input.tenantId,
      // numero_interno is overwritten by fsj.receta_asignar_numero_interno() regardless -- any value here is a placeholder.
      numeroInterno: 0,
      pacienteId: input.pacienteId,
      medicoId: input.medicoId,
      fechaPrescripcion: new Date(`${input.fechaPrescripcion}T00:00:00Z`),
      origen: input.origen,
      recetaFisicaRecibida: input.recetaFisicaRecibida,
      recetaFisicaRecibidaEn: input.recetaFisicaRecibida ? new Date() : null,
      recetaFisicaRecibidaPorId: input.recetaFisicaRecibida ? input.registradaPorId : null,
      registradaPorId: input.registradaPorId,
    },
    select: { id: true, numeroInterno: true },
  });

  for (const item of input.items) {
    const createdItem = await tx.itemReceta.create({
      data: {
        tenantId: input.tenantId,
        recetaId: receta.id,
        descripcion: item.descripcion,
        formaFarmaceutica: item.formaFarmaceutica,
        cantidadUnidades: item.cantidadUnidades,
        fraccionDosisPorUnidad: item.fraccionDosisPorUnidad,
        cantidadTotal: item.cantidadTotal,
        unidadTotalId: item.unidadTotalId,
        observaciones: item.observaciones,
      },
      select: { id: true },
    });
    await insertComponentes(tx, input.tenantId, createdItem.id, item.componentes);
  }

  return { id: receta.id, numeroInterno: receta.numeroInterno.toString() };
}

// ============================================================================
// Read for action handlers / detail page
// ============================================================================

export interface RecetaParaAccion {
  id: string;
  pacienteId: string;
  medicoId: string;
  fechaPrescripcion: Date;
  origen: OrigenReceta;
  estado: EstadoReceta;
  recetaFisicaRecibida: boolean;
  motivoAnulacion: string | null;
}

const SELECT_PARA_ACCION = {
  id: true,
  pacienteId: true,
  medicoId: true,
  fechaPrescripcion: true,
  origen: true,
  estado: true,
  recetaFisicaRecibida: true,
  motivoAnulacion: true,
} as const;

export async function getRecetaParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<RecetaParaAccion | null> {
  return tx.receta.findUnique({ where: { id, tenantId }, select: SELECT_PARA_ACCION }) as Promise<RecetaParaAccion | null>;
}

/**
 * Locks the target receta row (`SELECT ... FOR UPDATE`) BEFORE any caller
 * reads its current state -- same M3 discipline as every other module's
 * `lockXParaAccion` (e.g. modules/pacientes/infrastructure/paciente-repository.ts).
 * Every editar/anular/registrar-recepcion-fisica command in this module
 * calls this FIRST, then re-reads via a FRESH statement. Returns `false`
 * when no row matches.
 */
export async function lockRecetaParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.receta WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

/** 6.3 edit-lock (second half, needs a DB read -- see domain/receta.ts's `esEstadoEditable` for the pure half). Mirrors migration 0030's `fsj.receta_assert_editable`. */
export async function existeFichaConPreparacionParaReceta(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM fsj.ficha_tecnica ft
      JOIN fsj.item_receta ir ON ir.tenant_id = ft.tenant_id AND ir.id = ft.item_receta_id
      JOIN fsj.preparacion p ON p.tenant_id = ft.tenant_id AND p.ficha_tecnica_id = ft.id
      WHERE ft.tenant_id = ${tenantId}::uuid AND ir.receta_id = ${recetaId}::uuid
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

export interface ComponenteDetalle {
  id: string;
  drogaId: string;
  drogaNombre: string;
  cantidad: string | null;
  unidadMedidaId: string;
  unidadMedidaSimbolo: string;
  modoExpresion: ModoExpresion;
  esPrincipioActivo: boolean;
  orden: number;
}

export interface ItemDetalle {
  id: string;
  descripcion: string | null;
  formaFarmaceutica: FormaFarmaceutica;
  cantidadUnidades: number;
  fraccionDosisPorUnidad: string;
  cantidadTotal: string | null;
  unidadTotalId: string | null;
  unidadTotalSimbolo: string | null;
  observaciones: string | null;
  componentes: ComponenteDetalle[];
  /**
   * D2 REVISED (FASE 9, per-item rule, 2026-09-23): "PENDIENTE" (no
   * preparación CONFIRMADA yet), "VIGENTE" (confirmed, its SISTEMA asiento
   * is still VIGENTE and has no rectificativo) or "SIN_EFECTO" (its asiento
   * is ANULADO or already has a rectificativo). Read-only display hint --
   * NOT a stored column (`item_receta` has none, see
   * `modules/libro/infrastructure/receta-coupling-repository.ts`'s doc
   * comment). Cross-module read of `fsj.preparacion`/`fsj.asiento_recetario`,
   * same convention as this file's `jornadaActualTenant`.
   */
  estadoAsiento: "PENDIENTE" | "VIGENTE" | "SIN_EFECTO";
}

/**
 * One batched query (not N+1) resolving every item's `estadoAsiento` for a
 * single receta -- see `ItemDetalle.estadoAsiento`'s doc comment.
 */
async function getEstadoAsientoPorItem(
  tx: Prisma.TransactionClient,
  tenantId: string,
  recetaId: string,
): Promise<Map<string, "PENDIENTE" | "VIGENTE" | "SIN_EFECTO">> {
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
  return new Map(rows.map((r) => [r.item_id, r.estado]));
}

export interface RecetaDetalle {
  id: string;
  numeroInterno: string;
  pacienteId: string;
  pacienteNombre: string;
  pacienteApellido: string;
  medicoId: string;
  medicoNombre: string;
  medicoApellido: string;
  medicoMatricula: string;
  fechaCreada: Date;
  fechaPrescripcion: Date;
  fechaIngreso: Date;
  origen: OrigenReceta;
  estado: EstadoReceta;
  recetaFisicaRecibida: boolean;
  recetaFisicaRecibidaEn: Date | null;
  recetaFisicaRecibidaPorNombre: string | null;
  motivoAnulacion: string | null;
  registradaPorNombre: string;
  items: ItemDetalle[];
}

export async function getRecetaConItems(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<RecetaDetalle | null> {
  const receta = await tx.receta.findUnique({
    where: { id, tenantId },
    include: {
      paciente: { select: { nombre: true, apellido: true } },
      medico: { select: { nombre: true, apellido: true, matricula: true } },
      registradaPor: { select: { nombre: true, apellido: true } },
      recetaFisicaRecibidaPor: { select: { nombre: true, apellido: true } },
      items: {
        include: {
          unidadTotal: { select: { simbolo: true } },
          componentes: {
            orderBy: { orden: "asc" },
            include: { droga: { select: { nombre: true } }, unidadMedida: { select: { simbolo: true } } },
          },
        },
      },
    },
  });
  if (!receta) return null;

  const estadoAsientoPorItem = await getEstadoAsientoPorItem(tx, tenantId, receta.id);

  return {
    id: receta.id,
    numeroInterno: receta.numeroInterno.toString(),
    pacienteId: receta.pacienteId,
    pacienteNombre: receta.paciente.nombre,
    pacienteApellido: receta.paciente.apellido,
    medicoId: receta.medicoId,
    medicoNombre: receta.medico.nombre,
    medicoApellido: receta.medico.apellido,
    medicoMatricula: receta.medico.matricula,
    fechaCreada: receta.fechaCreada,
    fechaPrescripcion: receta.fechaPrescripcion,
    fechaIngreso: receta.fechaIngreso,
    origen: receta.origen,
    estado: receta.estado,
    recetaFisicaRecibida: receta.recetaFisicaRecibida,
    recetaFisicaRecibidaEn: receta.recetaFisicaRecibidaEn,
    recetaFisicaRecibidaPorNombre: receta.recetaFisicaRecibidaPor
      ? `${receta.recetaFisicaRecibidaPor.apellido}, ${receta.recetaFisicaRecibidaPor.nombre}`
      : null,
    motivoAnulacion: receta.motivoAnulacion,
    registradaPorNombre: `${receta.registradaPor.apellido}, ${receta.registradaPor.nombre}`,
    items: receta.items.map((item) => ({
      id: item.id,
      descripcion: item.descripcion,
      formaFarmaceutica: item.formaFarmaceutica,
      cantidadUnidades: item.cantidadUnidades,
      fraccionDosisPorUnidad: item.fraccionDosisPorUnidad.toString(),
      cantidadTotal: item.cantidadTotal ? item.cantidadTotal.toString() : null,
      unidadTotalId: item.unidadTotalId,
      unidadTotalSimbolo: item.unidadTotal?.simbolo ?? null,
      observaciones: item.observaciones,
      estadoAsiento: estadoAsientoPorItem.get(item.id) ?? "PENDIENTE",
      componentes: item.componentes.map((c) => ({
        id: c.id,
        drogaId: c.drogaId,
        drogaNombre: c.droga.nombre,
        cantidad: c.cantidad ? c.cantidad.toString() : null,
        unidadMedidaId: c.unidadMedidaId,
        unidadMedidaSimbolo: c.unidadMedida.simbolo,
        modoExpresion: c.modoExpresion,
        esPrincipioActivo: c.esPrincipioActivo,
        orden: c.orden,
      })),
    })),
  };
}

// ============================================================================
// 6.3: edición -- header fields (optimistic concurrency) + items/componentes
// (replace-with-diff, backed by migration 0030's DELETE grant).
// ============================================================================

export interface EditarRecetaHeaderInput {
  id: string;
  pacienteId: string;
  medicoId: string;
  fechaPrescripcion: string;
  origen: OrigenReceta;
}

export interface EditarRecetaHeaderVersion {
  pacienteId: string;
  medicoId: string;
  fechaPrescripcion: string; // YYYY-MM-DD, compared as a date slice
  origen: OrigenReceta;
}

export async function updateRecetaHeader(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: EditarRecetaHeaderInput,
  version: EditarRecetaHeaderVersion,
): Promise<boolean> {
  const result = await tx.receta.updateMany({
    where: {
      id: input.id,
      tenantId,
      pacienteId: version.pacienteId,
      medicoId: version.medicoId,
      fechaPrescripcion: new Date(`${version.fechaPrescripcion}T00:00:00Z`),
      origen: version.origen,
    },
    data: {
      pacienteId: input.pacienteId,
      medicoId: input.medicoId,
      fechaPrescripcion: new Date(`${input.fechaPrescripcion}T00:00:00Z`),
      origen: input.origen,
    },
  });
  return result.count === 1;
}

/** The current item ids of a receta (used to detect a concurrent add/remove race -- see modules/recetas/application/editar-receta.ts). */
export async function listItemIds(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<string[]> {
  const rows = await tx.itemReceta.findMany({ where: { tenantId, recetaId }, select: { id: true } });
  return rows.map((r) => r.id);
}

export interface ItemDeseado {
  id?: string;
  descripcion: string | null;
  formaFarmaceutica: FormaFarmaceutica;
  cantidadUnidades: number;
  fraccionDosisPorUnidad: string;
  cantidadTotal: string | null;
  unidadTotalId: string | null;
  observaciones: string | null;
  componentes: NuevoComponenteInput[];
}

/**
 * Replaces a receta's items/componentes with the DESIRED final list, diffed
 * against what's currently in the DB:
 *  - items present in the DB but absent from `items` (by id) are deleted
 *    (their componentes first, then the item itself -- FK order);
 *  - items with an `id` are updated in place;
 *  - items without an `id` are inserted;
 *  - EVERY item's componentes are replaced wholesale (delete-all,
 *    re-insert with `orden` = array index) rather than diffed individually
 *    -- componente_item_receta's `orden` has a NON-deferred UNIQUE
 *    constraint (tenant_id, item_receta_id, orden), so an in-place
 *    reorder (e.g. swapping two rows) can collide mid-transaction; a full
 *    replace per item sidesteps that entirely and is simple to reason
 *    about. This does mean a componente's row id is not stable across an
 *    edit that touches its item -- acceptable since nothing else
 *    references componente_item_receta.id (no FK, no ficha yet at
 *    PENDIENTE_PREPARACION).
 * Deletions rely on migration 0030's GRANT DELETE + INV-R11 trigger, which
 * is a backstop on top of the caller's own editability check
 * (modules/recetas/application/editar-receta.ts checks estado + ficha
 * BEFORE calling this).
 */
export async function reemplazarItemsReceta(tx: Prisma.TransactionClient, tenantId: string, recetaId: string, items: ItemDeseado[]): Promise<void> {
  const actuales = await tx.itemReceta.findMany({ where: { tenantId, recetaId }, select: { id: true } });
  const actualesIds = new Set(actuales.map((i) => i.id));
  const enviadosIds = new Set(items.filter((i) => i.id).map((i) => i.id!));

  const aBorrar = [...actualesIds].filter((id) => !enviadosIds.has(id));
  for (const itemId of aBorrar) {
    await tx.componenteItemReceta.deleteMany({ where: { tenantId, itemRecetaId: itemId } });
    await tx.itemReceta.delete({ where: { id: itemId } });
  }

  for (const item of items) {
    let itemId: string;
    if (item.id) {
      await tx.itemReceta.update({
        where: { id: item.id },
        data: {
          descripcion: item.descripcion,
          formaFarmaceutica: item.formaFarmaceutica,
          cantidadUnidades: item.cantidadUnidades,
          fraccionDosisPorUnidad: item.fraccionDosisPorUnidad,
          cantidadTotal: item.cantidadTotal,
          unidadTotalId: item.unidadTotalId,
          observaciones: item.observaciones,
        },
      });
      itemId = item.id;
      await tx.componenteItemReceta.deleteMany({ where: { tenantId, itemRecetaId: itemId } });
    } else {
      const created = await tx.itemReceta.create({
        data: {
          tenantId,
          recetaId,
          descripcion: item.descripcion,
          formaFarmaceutica: item.formaFarmaceutica,
          cantidadUnidades: item.cantidadUnidades,
          fraccionDosisPorUnidad: item.fraccionDosisPorUnidad,
          cantidadTotal: item.cantidadTotal,
          unidadTotalId: item.unidadTotalId,
          observaciones: item.observaciones,
        },
        select: { id: true },
      });
      itemId = created.id;
    }
    await insertComponentes(tx, tenantId, itemId, item.componentes);
  }
}

// ============================================================================
// 6.4: recepción física
// ============================================================================

export async function registrarRecepcionFisica(tx: Prisma.TransactionClient, tenantId: string, id: string, usuarioId: string): Promise<void> {
  await tx.receta.update({
    where: { id, tenantId },
    data: { recetaFisicaRecibida: true, recetaFisicaRecibidaEn: new Date(), recetaFisicaRecibidaPorId: usuarioId },
  });
}

// ============================================================================
// 6.5: anulación
// ============================================================================

export async function anularReceta(tx: Prisma.TransactionClient, tenantId: string, id: string, motivo: string): Promise<void> {
  await tx.receta.update({ where: { id, tenantId }, data: { estado: "ANULADA", motivoAnulacion: motivo } });
}

// ============================================================================
// 6.6: listados
// ============================================================================

export interface ListRecetasFilter {
  tenantId: string;
  estado?: EstadoReceta;
  pacienteId?: string;
  medicoId?: string;
  numeroInterno?: string;
  desde?: string; // fecha_prescripcion >=
  hasta?: string; // fecha_prescripcion <=
  page: number;
  pageSize: number;
}

export interface RecetaListItem {
  id: string;
  numeroInterno: string;
  pacienteNombre: string;
  pacienteApellido: string;
  medicoNombre: string;
  medicoApellido: string;
  fechaPrescripcion: Date;
  origen: OrigenReceta;
  estado: EstadoReceta;
  recetaFisicaRecibida: boolean;
}

export interface ListRecetasResult {
  items: RecetaListItem[];
  total: number;
  page: number;
  pageSize: number;
}

function buildWhere(filter: ListRecetasFilter): Prisma.RecetaWhereInput {
  const where: Prisma.RecetaWhereInput = { tenantId: filter.tenantId };
  if (filter.estado) where.estado = filter.estado;
  if (filter.pacienteId) where.pacienteId = filter.pacienteId;
  if (filter.medicoId) where.medicoId = filter.medicoId;
  if (filter.numeroInterno && filter.numeroInterno.trim().length > 0) {
    const parsed = BigInt(filter.numeroInterno.trim().replace(/[^0-9]/g, "") || "-1");
    where.numeroInterno = parsed >= BigInt(0) ? parsed : BigInt(-1);
  }
  if (filter.desde || filter.hasta) {
    where.fechaPrescripcion = {
      ...(filter.desde ? { gte: new Date(`${filter.desde}T00:00:00Z`) } : {}),
      ...(filter.hasta ? { lte: new Date(`${filter.hasta}T00:00:00Z`) } : {}),
    };
  }
  return where;
}

export async function listRecetas(tx: Prisma.TransactionClient, filter: ListRecetasFilter): Promise<ListRecetasResult> {
  const where = buildWhere(filter);
  const skip = (filter.page - 1) * filter.pageSize;

  const [total, rows] = await Promise.all([
    tx.receta.count({ where }),
    tx.receta.findMany({
      where,
      orderBy: [{ fechaIngreso: "desc" }],
      skip,
      take: filter.pageSize,
      select: {
        id: true,
        numeroInterno: true,
        fechaPrescripcion: true,
        origen: true,
        estado: true,
        recetaFisicaRecibida: true,
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
      fechaPrescripcion: r.fechaPrescripcion,
      origen: r.origen,
      estado: r.estado,
      recetaFisicaRecibida: r.recetaFisicaRecibida,
    })),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

// ============================================================================
// FASE 13 point 13.4: recetas-por-estado report (`reportes.ver`). Filters by
// `fecha_ingreso` (the receta's system-entry timestamp) -- deliberately
// DIFFERENT from `listRecetas`'s `desde`/`hasta` (which filter
// `fecha_prescripcion`, the doctor's date on the paper) -- the task asks
// for "fecha ingreso range" specifically for this report.
// ============================================================================

export interface CountRecetasPorEstadoItem {
  estado: EstadoReceta;
  cantidad: number;
}

/** One row per `EstadoReceta` value that has at least one receta -- states with zero recetas are simply absent (the caller fills them in as 0). */
export async function countRecetasPorEstado(tx: Prisma.TransactionClient, tenantId: string): Promise<CountRecetasPorEstadoItem[]> {
  const rows = await tx.receta.groupBy({ by: ["estado"], where: { tenantId }, _count: { _all: true } });
  return rows.map((row) => ({ estado: row.estado, cantidad: row._count._all }));
}

export interface ListRecetasPorEstadoFilter {
  tenantId: string;
  estado?: EstadoReceta;
  ingresoDesde?: string; // fecha_ingreso >=
  ingresoHasta?: string; // fecha_ingreso <=
  page: number;
  pageSize: number;
}

function buildWherePorEstado(filter: Pick<ListRecetasPorEstadoFilter, "tenantId" | "estado" | "ingresoDesde" | "ingresoHasta">): Prisma.RecetaWhereInput {
  const where: Prisma.RecetaWhereInput = { tenantId: filter.tenantId };
  if (filter.estado) where.estado = filter.estado;
  if (filter.ingresoDesde || filter.ingresoHasta) {
    where.fechaIngreso = {
      ...(filter.ingresoDesde ? { gte: new Date(`${filter.ingresoDesde}T00:00:00Z`) } : {}),
      ...(filter.ingresoHasta ? { lte: new Date(`${filter.ingresoHasta}T23:59:59.999Z`) } : {}),
    };
  }
  return where;
}

/** Filtered receta list for the report (estado + fecha_ingreso range), same row shape as `listRecetas` (`RecetaListItem`) plus `fechaIngreso` -- reuses the SAME data exposure as `/recetas` (paciente/médico names), per the task's explicit "follow its data exposure" instruction. */
export async function listRecetasPorEstado(
  tx: Prisma.TransactionClient,
  filter: ListRecetasPorEstadoFilter,
): Promise<{ items: (RecetaListItem & { fechaIngreso: Date })[]; total: number; page: number; pageSize: number }> {
  const where = buildWherePorEstado(filter);
  const skip = (filter.page - 1) * filter.pageSize;

  const [total, rows] = await Promise.all([
    tx.receta.count({ where }),
    tx.receta.findMany({
      where,
      orderBy: [{ fechaIngreso: "desc" }],
      skip,
      take: filter.pageSize,
      select: {
        id: true,
        numeroInterno: true,
        fechaPrescripcion: true,
        fechaIngreso: true,
        origen: true,
        estado: true,
        recetaFisicaRecibida: true,
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
      fechaPrescripcion: r.fechaPrescripcion,
      fechaIngreso: r.fechaIngreso,
      origen: r.origen,
      estado: r.estado,
      recetaFisicaRecibida: r.recetaFisicaRecibida,
    })),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

/** 6.6 "pending physical prescription" (INV-R10): recetas not yet ANULADA with receta_fisica_recibida = false, oldest first (biggest "antigüedad" = most urgent to chase). ENTREGADA is excluded implicitly -- INV-R07 makes ENTREGADA + recetaFisicaRecibida=false impossible. */
export interface RecetaPendienteFisica {
  id: string;
  numeroInterno: string;
  pacienteNombre: string;
  pacienteApellido: string;
  medicoNombre: string;
  medicoApellido: string;
  estado: EstadoReceta;
  fechaIngreso: Date;
  antiguedadDias: number;
}

export async function listRecetasPendientesFisica(
  tx: Prisma.TransactionClient,
  tenantId: string,
  page: number,
  pageSize: number,
): Promise<{ items: RecetaPendienteFisica[]; total: number; page: number; pageSize: number }> {
  const where: Prisma.RecetaWhereInput = { tenantId, recetaFisicaRecibida: false, estado: { not: "ANULADA" } };
  const skip = (page - 1) * pageSize;

  const [total, rows] = await Promise.all([
    tx.receta.count({ where }),
    tx.receta.findMany({
      where,
      orderBy: [{ fechaIngreso: "asc" }],
      skip,
      take: pageSize,
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

  const ahora = Date.now();
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
      antiguedadDias: Math.max(0, Math.floor((ahora - r.fechaIngreso.getTime()) / (24 * 60 * 60 * 1000))),
    })),
    total,
    page,
    pageSize,
  };
}
