/**
 * Prisma-backed access to `fsj.receta` / `fsj.item_receta` /
 * `fsj.componente_item_receta` for M09 (FASE 6 points 6.1/6.3/6.5).
 * Every function runs inside an ALREADY OPEN tenant transaction. The DB
 * remains authoritative for the state machine (INV-R08), INV-R01/V1
 * (deferred constraint triggers), V2 (partial unique index), V6/V7/V8/V9
 * (CHECKs) and, since migration
 * 0030, INV-R11 (item/componente DELETE only while editable) -- everything
 * here that duplicates a check exists purely to produce a clear Spanish
 * message before the DB rejects it.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EstadoReceta, FormaFarmaceutica, ModoExpresion, OrigenReceta } from "../domain/receta";
import type { FiltroPagoReceta } from "../domain/pago";
import { ordenarComponentes } from "@/modules/elaboracion/domain/orden-componentes";
import { rangoDeJornadas } from "@/shared/time/jornada";
import { drogaCoincideSql, sinonimoCoincidenteSql } from "@/shared/db/busqueda-droga";

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

export interface DrogasDeReceta {
  /** Every id that is EITHER missing (wrong tenant/never existed) OR given de baja -- used to produce one clear message instead of a raw FK violation. */
  invalidas: string[];
  /** The vigente ids whose clase is DROGA (migration 0063): a componente of one of them is a principio activo (`es_principio_activo`, set by the server, never by the user). */
  principiosActivos: ReadonlySet<string>;
  /** Names of the vigente drogas whose clase is MATERIAL (capsules, containers): never prescribed, so a receta may not reference them. */
  materiales: string[];
}

/** ONE read of the drogas a receta's componentes (and import aliases) reference: which are invalid, which are materiales, and which are principios activos. */
export async function clasificarDrogasDeReceta(tx: Prisma.TransactionClient, tenantId: string, drogaIds: string[]): Promise<DrogasDeReceta> {
  if (drogaIds.length === 0) return { invalidas: [], principiosActivos: new Set(), materiales: [] };
  const unicos = Array.from(new Set(drogaIds));
  const vigentes = await tx.droga.findMany({
    where: { tenantId, id: { in: unicos }, fechaBaja: null },
    select: { id: true, nombre: true, clase: true },
  });
  const vigentesSet = new Set(vigentes.map((d) => d.id));
  return {
    invalidas: unicos.filter((id) => !vigentesSet.has(id)),
    principiosActivos: new Set(vigentes.filter((d) => d.clase === "DROGA").map((d) => d.id)),
    materiales: vigentes.filter((d) => d.clase === "MATERIAL").map((d) => d.nombre),
  };
}

/** Every id in `unidadIds` that does not exist in the GLOBAL unidad_medida catalog, or is given de baja. */
export async function unidadesInvalidas(tx: Prisma.TransactionClient, unidadIds: string[]): Promise<string[]> {
  if (unidadIds.length === 0) return [];
  const unicos = Array.from(new Set(unidadIds));
  const vigentes = await tx.unidadMedida.findMany({ where: { id: { in: unicos }, fechaBaja: null }, select: { id: true } });
  const vigentesSet = new Set(vigentes.map((u) => u.id));
  return unicos.filter((id) => !vigentesSet.has(id));
}

/** Names for the audit trail's readable item summary (recetas/domain#resumirItemsReceta): droga id -> nombre, unidad id -> símbolo. Includes drogas/unidades given de baja (history must still resolve). */
export async function getNombresParaResumen(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaIds: string[],
  unidadIds: string[],
): Promise<{ drogas: Map<string, string>; unidades: Map<string, string> }> {
  const drogas = drogaIds.length === 0 ? [] : await tx.droga.findMany({ where: { tenantId, id: { in: [...new Set(drogaIds)] } }, select: { id: true, nombre: true } });
  const unidades = unidadIds.length === 0 ? [] : await tx.unidadMedida.findMany({ where: { id: { in: [...new Set(unidadIds)] } }, select: { id: true, simbolo: true } });
  return { drogas: new Map(drogas.map((d) => [d.id, d.nombre])), unidades: new Map(unidades.map((u) => [u.id, u.simbolo])) };
}

// ============================================================================
// Droga / unidad pickers (6.1 -- "declared under recetas.crear so
// ATENCION_PUBLICO can use it", must exclude drogas given de baja). Own
// copies, NOT modules/drogas's (gated on drogas.editar, which ATP lacks).
// ============================================================================

export interface DrogaOpcion {
  id: string;
  /** Always the canonical name: it is what the receta stores and prints. */
  nombre: string;
  unidadBaseId: string;
  unidadBaseSimbolo: string;
  /** The synonym the search matched through, when the name itself did not match -- a display hint only. */
  sinonimo: string | null;
  /** That synonym's id: picking the option stores it on the componente (migration 0069, the name the user chose). */
  sinonimoId: string | null;
}

/**
 * Vigente drogas whose name or vigente synonym contains `search` (accent-insensitive, shared/db/busqueda-droga.ts); name matches first.
 * MATERIAL rows (capsules, containers -- migration 0063) are never prescribed, so they are left out; DROGA and EXCIPIENTE are.
 */
export async function listDrogasParaReceta(
  tx: Prisma.TransactionClient,
  tenantId: string,
  search?: string,
  limit = 20,
): Promise<DrogaOpcion[]> {
  const rows = await tx.$queryRaw<{ id: string; nombre: string; unidad_base_id: string; simbolo: string; sinonimo: string | null; sinonimo_id: string | null }[]>`
    SELECT * FROM (
      SELECT d.id, d.nombre::text AS nombre, d.unidad_base_id, u.simbolo,
        ${sinonimoCoincidenteSql("d", search)} AS sinonimo, ${sinonimoCoincidenteSql("d", search, "id")} AS sinonimo_id
      FROM fsj.droga d
      JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
      WHERE d.tenant_id = ${tenantId}::uuid
        AND d.fecha_baja IS NULL
        AND d.clase <> 'MATERIAL'
        AND ${drogaCoincideSql("d", search)}
    ) t
    ORDER BY (t.sinonimo IS NOT NULL), t.nombre, t.id
    LIMIT ${limit}::int
  `;
  return rows.map((r) => ({ id: r.id, nombre: r.nombre, unidadBaseId: r.unidad_base_id, unidadBaseSimbolo: r.simbolo, sinonimo: r.sinonimo, sinonimoId: r.sinonimo_id }));
}

/** A synonym a componente references (migration 0069), as the use cases validate it. Includes removed ones (`vigente: false`). */
export interface SinonimoDeComponente {
  id: string;
  drogaId: string;
  texto: string;
  /** The synonym and its droga are both vigente. */
  vigente: boolean;
}

/** The synonyms among `ids` (tenant-scoped; unknown ids are absent from the map). */
export async function getSinonimosParaComponentes(tx: Prisma.TransactionClient, tenantId: string, ids: string[]): Promise<Map<string, SinonimoDeComponente>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.drogaAlias.findMany({
    where: { tenantId, id: { in: [...new Set(ids)] } },
    select: { id: true, drogaId: true, texto: true, fechaBaja: true, droga: { select: { fechaBaja: true } } },
  });
  return new Map(rows.map((r) => [r.id, { id: r.id, drogaId: r.drogaId, texto: r.texto, vigente: r.fechaBaja === null && r.droga.fechaBaja === null }]));
}

/** "droga id|synonym id" of every componente of the receta stored with a synonym -- what an edit may keep even if that synonym was removed since. */
export async function listSinonimosGuardadosDeReceta(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<Set<string>> {
  const rows = await tx.componenteItemReceta.findMany({
    where: { tenantId, itemReceta: { recetaId }, drogaAliasId: { not: null } },
    select: { drogaId: true, drogaAliasId: true },
  });
  return new Set(rows.map((r) => `${r.drogaId}|${r.drogaAliasId}`));
}

export interface UnidadOpcion {
  id: string;
  nombre: string;
  simbolo: string;
  tipoMagnitud: string;
}

/** Catalog units never prescribed in a receta; hidden from the picker only (still valid elsewhere, e.g. the cost comparator). */
const UNIDADES_OCULTAS_EN_RECETA = ["MICROLITRO"];

export async function listUnidadesParaReceta(tx: Prisma.TransactionClient): Promise<UnidadOpcion[]> {
  const rows = await tx.unidadMedida.findMany({
    where: { fechaBaja: null, codigo: { notIn: UNIDADES_OCULTAS_EN_RECETA } },
    // Grouped by magnitud (enum order: MASA, VOLUMEN, UNIDADES), smallest unit first.
    orderBy: [{ tipoMagnitud: "asc" }, { factorABase: "asc" }, { nombre: "asc" }],
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
  /** Snapshot of the droga's clase = DROGA, resolved by the use case (`clasificarDrogasDeReceta`). */
  esPrincipioActivo: boolean;
  /** The synonym of `drogaId` the componente was picked by (migration 0069), validated by the use case; omitted/null = canonical name. */
  drogaAliasId?: string | null;
}

export interface NuevoItemInput {
  descripcion: string | null;
  formaFarmaceutica: FormaFarmaceutica;
  cantidadUnidades: number;
  fraccionDosisPorUnidad: string;
  cantidadTotal: string | null;
  unidadTotalId: string | null;
  observaciones: string | null;
  posologia: string | null;
  duracionTratamientoDias: number | null;
  componentes: NuevoComponenteInput[];
}

export interface NuevaRecetaInput {
  tenantId: string;
  pacienteId: string;
  medicoId: string;
  fechaPrescripcion: string; // YYYY-MM-DD
  origen: OrigenReceta;
  registradaPorId: string;
  diagnosticoCodigo: string | null;
  diagnosticoDescripcion: string | null;
  /** Migration 0070 -- the patient's home address as written on this receta. */
  domicilioPaciente: string | null;
  /** Migration 0071 -- the receta is created already paid (`registradaPorId` is who marked it, now). Default unpaid. */
  pagada?: boolean;
  /** PDF import only (migration 0049): the emisor's provenance and the "Válida desde" date. */
  emisor?: string | null;
  nroRecetaEmisor?: string | null;
  urlVerificacion?: string | null;
  fechaValidaDesde?: string | null; // YYYY-MM-DD
  items: NuevoItemInput[];
}

async function insertComponentes(
  tx: Prisma.TransactionClient,
  tenantId: string,
  itemRecetaId: string,
  componentes: NuevoComponenteInput[],
): Promise<void> {
  for (const c of componentes) {
    await tx.componenteItemReceta.create({
      data: {
        tenantId,
        itemRecetaId,
        drogaId: c.drogaId,
        cantidad: c.cantidad,
        unidadMedidaId: c.unidadMedidaId,
        modoExpresion: c.modoExpresion,
        esPrincipioActivo: c.esPrincipioActivo,
        drogaAliasId: c.drogaAliasId ?? null,
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
      registradaPorId: input.registradaPorId,
      diagnosticoCodigo: input.diagnosticoCodigo,
      diagnosticoDescripcion: input.diagnosticoDescripcion,
      domicilioPaciente: input.domicilioPaciente,
      ...(input.pagada ? { pagada: true, pagadaEn: new Date(), pagadaPorId: input.registradaPorId } : {}),
      emisor: input.emisor ?? null,
      nroRecetaEmisor: input.nroRecetaEmisor ?? null,
      urlVerificacion: input.urlVerificacion ?? null,
      fechaValidaDesde: input.fechaValidaDesde ? new Date(`${input.fechaValidaDesde}T00:00:00Z`) : null,
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
        posologia: item.posologia,
        duracionTratamientoDias: item.duracionTratamientoDias,
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
  motivoAnulacion: string | null;
  diagnosticoCodigo: string | null;
  diagnosticoDescripcion: string | null;
  domicilioPaciente: string | null;
}

const SELECT_PARA_ACCION = {
  id: true,
  pacienteId: true,
  medicoId: true,
  fechaPrescripcion: true,
  origen: true,
  estado: true,
  motivoAnulacion: true,
  diagnosticoCodigo: true,
  diagnosticoDescripcion: true,
  domicilioPaciente: true,
} as const;

export async function getRecetaParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<RecetaParaAccion | null> {
  return tx.receta.findUnique({ where: { id, tenantId }, select: SELECT_PARA_ACCION }) as Promise<RecetaParaAccion | null>;
}

/**
 * Locks the target receta row (`SELECT ... FOR UPDATE`) BEFORE any caller
 * reads its current state -- same M3 discipline as every other module's
 * `lockXParaAccion` (e.g. modules/pacientes/infrastructure/paciente-repository.ts).
 * Every editar/anular command in this module
 * calls this FIRST, then re-reads via a FRESH statement. Returns `false`
 * when no row matches.
 */
export async function lockRecetaParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.receta WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

/**
 * 6.3 edit-lock (second half, needs a DB read -- see domain/receta.ts's `esEstadoEditable` for the pure half): a ficha
 * técnica of the receta has a LIVE (INICIADA/CONFIRMADA) preparación. A DESCARTADA one -- e.g. a released reserva de
 * stock -- does not block editing. Mirrors `fsj.receta_assert_editable` (migration 0030, revised by 0072).
 */
export async function existeFichaConPreparacionParaReceta(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM fsj.ficha_tecnica ft
      JOIN fsj.item_receta ir ON ir.tenant_id = ft.tenant_id AND ir.id = ft.item_receta_id
      JOIN fsj.preparacion p ON p.tenant_id = ft.tenant_id AND p.ficha_tecnica_id = ft.id
      WHERE ft.tenant_id = ${tenantId}::uuid AND ir.receta_id = ${recetaId}::uuid AND p.estado <> 'DESCARTADA'
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

export interface ComponenteDetalle {
  id: string;
  drogaId: string;
  /** Always the canonical name (ordering, ficha, libro). */
  drogaNombre: string;
  /** The synonym the componente was loaded with (migration 0069) -- shown instead of the name, with the name as a hint. */
  drogaAliasId: string | null;
  sinonimo: string | null;
  cantidad: string | null;
  unidadMedidaId: string;
  unidadMedidaSimbolo: string;
  modoExpresion: ModoExpresion;
  esPrincipioActivo: boolean;
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
  posologia: string | null;
  duracionTratamientoDias: number | null;
  /** In `ordenarComponentes` order (componentes have no stored order). */
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
  motivoAnulacion: string | null;
  registradaPorNombre: string;
  diagnosticoCodigo: string | null;
  diagnosticoDescripcion: string | null;
  /** Migration 0070 -- the patient's home address as written on this receta. */
  domicilioPaciente: string | null;
  /** Migration 0071 -- payment flag; `pagadaEn` / `pagadaPorNombre` ("Apellido, Nombre") are null while unpaid. */
  pagada: boolean;
  pagadaEn: Date | null;
  pagadaPorNombre: string | null;
  /** The tenant's zona horaria, to show `pagadaEn` (a timestamptz) as the farmacia's local time. */
  zonaHoraria: string;
  /** Digital provenance (migration 0049) -- all three `null` for a receta loaded by hand. */
  emisor: string | null;
  nroRecetaEmisor: string | null;
  urlVerificacion: string | null;
  items: ItemDetalle[];
}

export async function getRecetaConItems(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<RecetaDetalle | null> {
  const receta = await tx.receta.findUnique({
    where: { id, tenantId },
    include: {
      paciente: { select: { nombre: true, apellido: true } },
      medico: { select: { nombre: true, apellido: true, matricula: true } },
      registradaPor: { select: { nombre: true, apellido: true } },
      pagadaPor: { select: { nombre: true, apellido: true } },
      items: {
        include: {
          unidadTotal: { select: { simbolo: true } },
          componentes: {
            include: { droga: { select: { nombre: true } }, drogaAlias: { select: { texto: true } }, unidadMedida: { select: { simbolo: true } } },
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
    motivoAnulacion: receta.motivoAnulacion,
    registradaPorNombre: `${receta.registradaPor.apellido}, ${receta.registradaPor.nombre}`,
    diagnosticoCodigo: receta.diagnosticoCodigo,
    diagnosticoDescripcion: receta.diagnosticoDescripcion,
    domicilioPaciente: receta.domicilioPaciente,
    pagada: receta.pagada,
    pagadaEn: receta.pagadaEn,
    pagadaPorNombre: receta.pagadaPor ? `${receta.pagadaPor.apellido}, ${receta.pagadaPor.nombre}` : null,
    zonaHoraria: await zonaHorariaTenant(tx, tenantId),
    emisor: receta.emisor,
    nroRecetaEmisor: receta.nroRecetaEmisor,
    urlVerificacion: receta.urlVerificacion,
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
      posologia: item.posologia,
      duracionTratamientoDias: item.duracionTratamientoDias,
      estadoAsiento: estadoAsientoPorItem.get(item.id) ?? "PENDIENTE",
      componentes: ordenarComponentes(
        item.componentes.map((c) => ({
          id: c.id,
          drogaId: c.drogaId,
          drogaNombre: c.droga.nombre,
          drogaAliasId: c.drogaAliasId,
          sinonimo: c.drogaAlias?.texto ?? null,
          cantidad: c.cantidad ? c.cantidad.toString() : null,
          unidadMedidaId: c.unidadMedidaId,
          unidadMedidaSimbolo: c.unidadMedida.simbolo,
          modoExpresion: c.modoExpresion,
          esPrincipioActivo: c.esPrincipioActivo,
        })),
      ),
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
  diagnosticoCodigo: string | null;
  diagnosticoDescripcion: string | null;
  domicilioPaciente: string | null;
}

export interface EditarRecetaHeaderVersion {
  pacienteId: string;
  medicoId: string;
  fechaPrescripcion: string; // YYYY-MM-DD, compared as a date slice
  origen: OrigenReceta;
  diagnosticoCodigo: string | null;
  diagnosticoDescripcion: string | null;
  domicilioPaciente: string | null;
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
      diagnosticoCodigo: version.diagnosticoCodigo,
      diagnosticoDescripcion: version.diagnosticoDescripcion,
      domicilioPaciente: version.domicilioPaciente,
    },
    data: {
      pacienteId: input.pacienteId,
      medicoId: input.medicoId,
      fechaPrescripcion: new Date(`${input.fechaPrescripcion}T00:00:00Z`),
      origen: input.origen,
      diagnosticoCodigo: input.diagnosticoCodigo,
      diagnosticoDescripcion: input.diagnosticoDescripcion,
      domicilioPaciente: input.domicilioPaciente,
    },
  });
  return result.count === 1;
}

/**
 * Which of `itemIds` already have a ficha_tecnica or a cotización. Such an
 * item can no longer be removed: both tables reference item_receta with no
 * ON DELETE and are insert-only (migrations 0012/0031) -- see
 * modules/recetas/application/editar-receta.ts.
 */
export async function itemsConFichaOCotizacion(tx: Prisma.TransactionClient, tenantId: string, itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const fichas = await tx.fichaTecnica.findMany({ where: { tenantId, itemRecetaId: { in: itemIds } }, select: { itemRecetaId: true }, distinct: ["itemRecetaId"] });
  const cotizaciones = await tx.cotizacion.findMany({ where: { tenantId, itemRecetaId: { in: itemIds } }, select: { itemRecetaId: true }, distinct: ["itemRecetaId"] });
  return new Set([...fichas, ...cotizaciones].map((r) => r.itemRecetaId));
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
  posologia: string | null;
  duracionTratamientoDias: number | null;
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
 *    re-insert) rather than diffed individually -- simple to reason about,
 *    and every componente gets its `es_principio_activo` snapshot
 *    refreshed from the droga's current clase. This does mean a
 *    componente's row id is not stable across an
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
          posologia: item.posologia,
          duracionTratamientoDias: item.duracionTratamientoDias,
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
          posologia: item.posologia,
          duracionTratamientoDias: item.duracionTratamientoDias,
        },
        select: { id: true },
      });
      itemId = created.id;
    }
    await insertComponentes(tx, tenantId, itemId, item.componentes);
  }
}

// ============================================================================
// 6.5: anulación
// ============================================================================

/** Items of the receta with a preparación still INICIADA (own read of fsj.preparacion, same convention as `getEstadoAsientoPorItem`) -- see domain/anulacion.ts. */
export async function itemsConPreparacionIniciada(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ item_receta_id: string }[]>`
    SELECT DISTINCT p.item_receta_id
    FROM fsj.preparacion p
    JOIN fsj.item_receta ir ON ir.tenant_id = p.tenant_id AND ir.id = p.item_receta_id
    WHERE p.tenant_id = ${tenantId}::uuid AND ir.receta_id = ${recetaId}::uuid AND p.estado = 'INICIADA'
  `;
  return rows.map((r) => r.item_receta_id);
}

export async function anularReceta(tx: Prisma.TransactionClient, tenantId: string, id: string, motivo: string): Promise<void> {
  await tx.receta.update({ where: { id, tenantId }, data: { estado: "ANULADA", motivoAnulacion: motivo } });
}

// ============================================================================
// Pago (migration 0071, docs/specs/pago-receta.md).
// ============================================================================

export interface PagoDeReceta {
  id: string;
  estado: EstadoReceta;
  pagada: boolean;
  pagadaEn: Date | null;
  pagadaPorId: string | null;
}

/** Fresh read of the receta's payment -- call AFTER `lockRecetaParaAccion` (M3). */
export async function getPagoDeReceta(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PagoDeReceta | null> {
  return tx.receta.findUnique({ where: { id, tenantId }, select: { id: true, estado: true, pagada: true, pagadaEn: true, pagadaPorId: true } });
}

/**
 * Raises the flag (`pagada_en` = now, `pagada_por_id` = the acting usuario) or lowers it (all three cleared) -- always
 * the three columns together (receta_pagada_check). The caller has already checked the estado and that this is a change.
 */
export async function setPagoDeReceta(tx: Prisma.TransactionClient, tenantId: string, id: string, pagada: boolean, usuarioId: string): Promise<void> {
  await tx.receta.update({
    where: { id, tenantId },
    data: pagada ? { pagada: true, pagadaEn: new Date(), pagadaPorId: usuarioId } : { pagada: false, pagadaEn: null, pagadaPorId: null },
  });
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
  ingresoDesde?: string; // YYYY-MM-DD, jornada in the tenant's time zone (inclusive)
  ingresoHasta?: string; // YYYY-MM-DD, jornada in the tenant's time zone (inclusive)
  /** Migration 0071: only paid (`pagadas`) or unpaid (`impagas`) recetas; omitted = all. */
  pago?: FiltroPagoReceta;
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
}

export interface RecetaListadoItem extends RecetaListItem {
  fechaIngreso: Date;
  /** Migration 0071. */
  pagada: boolean;
  /**
   * Same rule as /recetas/[id]/editar and `editarReceta` (minus the
   * permiso, which the page adds): PENDIENTE_PREPARACION and no ficha
   * técnica with a preparación.
   */
  editable: boolean;
}

export interface ListRecetasResult {
  items: RecetaListadoItem[];
  total: number;
  page: number;
  pageSize: number;
  /** The tenant's zona horaria, to show `fechaIngreso` (a timestamptz) as the farmacia's calendar day. */
  zonaHoraria: string;
}

/** Which of `recetaIds` have a ficha técnica with a LIVE preparación -- ONE query for a whole page of the list (no N+1). Same rule as `existeFichaConPreparacionParaReceta`. */
async function recetasConFichaConPreparacion(tx: Prisma.TransactionClient, tenantId: string, recetaIds: string[]): Promise<Set<string>> {
  if (recetaIds.length === 0) return new Set();
  const rows = await tx.$queryRaw<{ receta_id: string }[]>`
    SELECT DISTINCT ir.receta_id
    FROM fsj.ficha_tecnica ft
    JOIN fsj.item_receta ir ON ir.tenant_id = ft.tenant_id AND ir.id = ft.item_receta_id
    JOIN fsj.preparacion p ON p.tenant_id = ft.tenant_id AND p.ficha_tecnica_id = ft.id
    WHERE ft.tenant_id = ${tenantId}::uuid AND ir.receta_id = ANY(${recetaIds}::uuid[]) AND p.estado <> 'DESCARTADA'
  `;
  return new Set(rows.map((r) => r.receta_id));
}

function buildWhere(filter: ListRecetasFilter, zonaHoraria: string): Prisma.RecetaWhereInput {
  const where: Prisma.RecetaWhereInput = { tenantId: filter.tenantId };
  if (filter.estado) where.estado = filter.estado;
  if (filter.pacienteId) where.pacienteId = filter.pacienteId;
  if (filter.medicoId) where.medicoId = filter.medicoId;
  if (filter.pago) where.pagada = filter.pago === "pagadas";
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
  if (filter.ingresoDesde || filter.ingresoHasta) {
    // Calendar days in the pharmacy's time zone, not UTC (fecha_ingreso is a timestamptz).
    const { desde, hastaExclusivo } = rangoDeJornadas(filter.ingresoDesde, filter.ingresoHasta, zonaHoraria);
    where.fechaIngreso = {
      ...(desde ? { gte: desde } : {}),
      ...(hastaExclusivo ? { lt: hastaExclusivo } : {}),
    };
  }
  return where;
}

export async function listRecetas(tx: Prisma.TransactionClient, filter: ListRecetasFilter): Promise<ListRecetasResult> {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: filter.tenantId }, select: { zonaHoraria: true } });
  const where = buildWhere(filter, tenant.zonaHoraria);
  const skip = (filter.page - 1) * filter.pageSize;

  const total = await tx.receta.count({ where });
  const rows = await tx.receta.findMany({
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
      pagada: true,
      paciente: { select: { nombre: true, apellido: true } },
      medico: { select: { nombre: true, apellido: true } },
    },
  });

  const pendientes = rows.filter((r) => r.estado === "PENDIENTE_PREPARACION").map((r) => r.id);
  const conPreparacion = await recetasConFichaConPreparacion(tx, filter.tenantId, pendientes);

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
      pagada: r.pagada,
      editable: r.estado === "PENDIENTE_PREPARACION" && !conPreparacion.has(r.id),
    })),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
    zonaHoraria: tenant.zonaHoraria,
  };
}

// ============================================================================
// FASE 13 point 13.4: recetas-por-estado report (`reportes.ver`). Filters by
// `fecha_ingreso` (the receta's system-entry timestamp) -- deliberately
// DIFFERENT from `listRecetas`'s `desde`/`hasta` (which filter
// `fecha_prescripcion`, the doctor's date on the paper) -- the task asks
// for "fecha ingreso range" specifically for this report.
// Also the per-estado counts of the /recetas summary (optionally limited by
// fecha_ingreso) and the home dashboard (all time).
// ============================================================================

export interface CountRecetasPorEstadoItem {
  estado: EstadoReceta;
  cantidad: number;
}

/** The tenant's zona horaria, to turn "today" and picked dates into jornadas. */
export async function zonaHorariaTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { zonaHoraria: true } });
  return tenant.zonaHoraria;
}

/**
 * One row per `EstadoReceta` value that has at least one receta -- states with zero recetas are simply absent (the caller fills them in as 0).
 * `ingresoDesde` (an instant, usually the start of a jornada) limits the count to recetas that entered from then on.
 */
export async function countRecetasPorEstado(tx: Prisma.TransactionClient, tenantId: string, ingresoDesde?: Date): Promise<CountRecetasPorEstadoItem[]> {
  const where: Prisma.RecetaWhereInput = { tenantId, ...(ingresoDesde ? { fechaIngreso: { gte: ingresoDesde } } : {}) };
  const rows = await tx.receta.groupBy({ by: ["estado"], where, _count: { _all: true } });
  return rows.map((row) => ({ estado: row.estado, cantidad: row._count._all }));
}

export interface ListRecetasPorEstadoFilter {
  tenantId: string;
  estado?: EstadoReceta;
  ingresoDesde?: string; // YYYY-MM-DD, jornada in the tenant's time zone (inclusive)
  ingresoHasta?: string; // YYYY-MM-DD, jornada in the tenant's time zone (inclusive)
  page: number;
  pageSize: number;
}

async function buildWherePorEstado(
  tx: Prisma.TransactionClient,
  filter: Pick<ListRecetasPorEstadoFilter, "tenantId" | "estado" | "ingresoDesde" | "ingresoHasta">,
): Promise<Prisma.RecetaWhereInput> {
  const where: Prisma.RecetaWhereInput = { tenantId: filter.tenantId };
  if (filter.estado) where.estado = filter.estado;
  if (filter.ingresoDesde || filter.ingresoHasta) {
    // Calendar days in the pharmacy's time zone, not UTC (fecha_ingreso is a timestamptz).
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: filter.tenantId }, select: { zonaHoraria: true } });
    const { desde, hastaExclusivo } = rangoDeJornadas(filter.ingresoDesde, filter.ingresoHasta, tenant.zonaHoraria);
    where.fechaIngreso = {
      ...(desde ? { gte: desde } : {}),
      ...(hastaExclusivo ? { lt: hastaExclusivo } : {}),
    };
  }
  return where;
}

/** Filtered receta list for the report (estado + fecha_ingreso range), same row shape as `listRecetas` (`RecetaListItem`) plus `fechaIngreso` -- reuses the SAME data exposure as `/recetas` (paciente/médico names), per the task's explicit "follow its data exposure" instruction. */
export async function listRecetasPorEstado(
  tx: Prisma.TransactionClient,
  filter: ListRecetasPorEstadoFilter,
): Promise<{ items: (RecetaListItem & { fechaIngreso: Date })[]; total: number; page: number; pageSize: number }> {
  const where = await buildWherePorEstado(tx, filter);
  const skip = (filter.page - 1) * filter.pageSize;

  const total = await tx.receta.count({ where });
  const rows = await tx.receta.findMany({
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
      fechaPrescripcion: r.fechaPrescripcion,
      fechaIngreso: r.fechaIngreso,
      origen: r.origen,
      estado: r.estado,
    })),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}
