/**
 * Prisma-backed access to `fsj.preparacion` / `fsj.etiqueta` /
 * `fsj.movimiento_stock` / `fsj.asiento_recetario` / `fsj.detalle_asiento` /
 * `fsj.asiento_contralor` for M11 (FASE 8). Every function runs inside an
 * ALREADY OPEN tenant transaction (`tx`), same convention as every other
 * module's repository (e.g. modules/stock/infrastructure/partida-repository.ts,
 * modules/recetas/infrastructure/receta-repository.ts).
 *
 * Trigger-assigned columns (migrations 0013/0014): `preparacion.item_receta_id`,
 * `asiento_recetario.{libro_id,numero_correlativo,fecha_asiento,hash_integridad,
 * hash_anterior,estado,cierre_diario_id}`, `asiento_contralor.{libro_id,
 * numero_correlativo,fecha_asiento,saldo_anterior,saldo_posterior,
 * hash_integridad,hash_anterior,estado,cierre_diario_id}` are ALL overwritten
 * by a `BEFORE INSERT` trigger regardless of what this file sends -- the
 * placeholder values below (`PLACEHOLDER_UUID`, `0n`, `""`) are never
 * persisted, exactly like `modules/recetas/infrastructure/receta-repository.ts`'s
 * `numeroInterno: 0` placeholder for `receta` (same doc comment there
 * explains why: Postgres validates NOT NULL/CHECK constraints against the
 * FINAL row, after BEFORE ROW triggers run, not against the values the
 * INSERT statement supplied).
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { EstadoPreparacion, EstadoReceta, TipoMovimientoContralor } from "@/generated/prisma/enums";

const PLACEHOLDER_UUID = "00000000-0000-0000-0000-000000000000";
const PLACEHOLDER_DATE = new Date(0);

// ============================================================================
// jornada helper -- own copy per module (see partida-repository.ts's twin).
// ============================================================================

export async function jornadaActualTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ jornada: string }[]>`
    SELECT fsj.jornada_actual(${tenantId}::uuid)::text AS jornada
  `;
  if (!rows[0]) throw new Error(`jornadaActualTenant: no row for tenant ${tenantId}`);
  return rows[0].jornada;
}

// ============================================================================
// 8.1: iniciar / descartar
// ============================================================================

export interface FichaParaIniciar {
  id: string;
  itemRecetaId: string;
  recetaId: string;
  recetaEstado: EstadoReceta;
}

/**
 * Serializes two concurrent "iniciar" attempts on the SAME ficha (M3
 * discipline) via a transaction-scoped advisory lock -- NOT `SELECT ...
 * FOR UPDATE`. `fsj_app` has UPDATE, DELETE, TRUNCATE REVOKEd on
 * `fsj.ficha_tecnica` (migration 0012), and Postgres requires the UPDATE
 * privilege to take `FOR UPDATE` on a row even when the lock itself never
 * writes -- a `FOR UPDATE` SELECT here fails at runtime with `42501
 * permission denied` (same bug class as `modules/libro/infrastructure/asiento-repository.ts#lockAsientoParaAnular`,
 * found and fixed in the same pass). `pg_advisory_xact_lock` needs no
 * table privilege and is released automatically at COMMIT/ROLLBACK.
 * Returns `false` when no row matches (existence checked via a plain
 * `SELECT`, which only needs the SELECT privilege `fsj_app` already has).
 */
export async function lockFichaTecnicaParaIniciar(tx: Prisma.TransactionClient, tenantId: string, fichaTecnicaId: string): Promise<boolean> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('ficha_tecnica:' || ${tenantId} || ':' || ${fichaTecnicaId}, 0))`;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.ficha_tecnica WHERE id = ${fichaTecnicaId}::uuid AND tenant_id = ${tenantId}::uuid
  `;
  return rows.length === 1;
}

export async function getFichaParaIniciar(tx: Prisma.TransactionClient, tenantId: string, fichaTecnicaId: string): Promise<FichaParaIniciar | null> {
  const ficha = await tx.fichaTecnica.findUnique({
    where: { id: fichaTecnicaId, tenantId },
    select: { id: true, itemRecetaId: true, itemReceta: { select: { recetaId: true, receta: { select: { estado: true } } } } },
  });
  if (!ficha) return null;
  return { id: ficha.id, itemRecetaId: ficha.itemRecetaId, recetaId: ficha.itemReceta.recetaId, recetaEstado: ficha.itemReceta.receta.estado };
}

/** INV-P02's app-level pre-check (the partial unique index is the real backstop) -- any preparación for this ficha that is NOT DESCARTADA. */
export async function getPreparacionActivaDeFicha(
  tx: Prisma.TransactionClient,
  tenantId: string,
  fichaTecnicaId: string,
): Promise<{ id: string; estado: EstadoPreparacion } | null> {
  return tx.preparacion.findFirst({
    where: { tenantId, fichaTecnicaId, estado: { not: "DESCARTADA" } },
    select: { id: true, estado: true },
  });
}

export async function insertPreparacion(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; fichaTecnicaId: string; iniciadaPorId: string },
): Promise<{ id: string }> {
  return tx.preparacion.create({
    data: {
      tenantId: input.tenantId,
      fichaTecnicaId: input.fichaTecnicaId,
      // item_receta_id is trigger-set from ficha_tecnica_id -- see module doc comment.
      itemRecetaId: PLACEHOLDER_UUID,
      iniciadaPorId: input.iniciadaPorId,
    },
    select: { id: true },
  });
}

export interface PreparacionParaAccion {
  id: string;
  fichaTecnicaId: string;
  itemRecetaId: string;
  estado: EstadoPreparacion;
}

/** Locks the target `preparacion` row `FOR UPDATE` -- M3 discipline, every write below calls this FIRST then re-reads. Returns `false` when no row matches. */
export async function lockPreparacionParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.preparacion WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

export async function getPreparacionParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PreparacionParaAccion | null> {
  return tx.preparacion.findUnique({
    where: { id, tenantId },
    select: { id: true, fichaTecnicaId: true, itemRecetaId: true, estado: true },
  });
}

export async function updatePreparacionDescartada(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string,
  input: { motivoDescarte: string; descartadaPorId: string },
): Promise<void> {
  await tx.preparacion.update({
    where: { id, tenantId },
    data: { estado: "DESCARTADA", motivoDescarte: input.motivoDescarte, descartadaPorId: input.descartadaPorId, descartadaEn: new Date() },
  });
}

// ============================================================================
// Receta state transitions driven by preparación (INV-P03.4, own small copy
// -- modules cannot reach into another module's infrastructure layer, see
// modules/usuarios/infrastructure/admin-guard.ts's header comment for the
// same "own copy per module" discipline).
// ============================================================================

/** Locks the receta row `FOR UPDATE` before any state-transition decision. Returns `false` when no row matches. */
export async function lockRecetaParaTransicion(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.receta WHERE id = ${recetaId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

export async function getRecetaEstado(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<EstadoReceta | null> {
  const receta = await tx.receta.findUnique({ where: { id: recetaId, tenantId }, select: { estado: true } });
  return receta?.estado ?? null;
}

export async function updateRecetaEstado(tx: Prisma.TransactionClient, tenantId: string, recetaId: string, estado: EstadoReceta): Promise<void> {
  await tx.receta.update({ where: { id: recetaId, tenantId }, data: { estado } });
}

/**
 * `true` when EVERY item_receta of `recetaId` has a CONFIRMADA preparación
 * (INV-PRP-003: at most one per item, via `preparacion.item_receta_id`).
 * Drives INV-P03.4 (EN_PREPARACION -> PREPARADA). Raw SQL: the Prisma
 * schema does not declare a `preparaciones` back-relation on `ItemReceta`
 * (only the plain `item_receta_id` column + its DB-level FK, migration
 * 0013), so this counts through `fsj.preparacion` directly instead.
 */
export async function todosLosItemsConfirmados(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ total: number; confirmados: number }[]>`
    SELECT
      (SELECT count(*)::int FROM fsj.item_receta WHERE tenant_id = ${tenantId}::uuid AND receta_id = ${recetaId}::uuid) AS total,
      (SELECT count(DISTINCT p.item_receta_id)::int FROM fsj.preparacion p
        WHERE p.tenant_id = ${tenantId}::uuid AND p.estado = 'CONFIRMADA'
        AND p.item_receta_id IN (SELECT id FROM fsj.item_receta WHERE tenant_id = ${tenantId}::uuid AND receta_id = ${recetaId}::uuid)
      ) AS confirmados
  `;
  const row = rows[0];
  if (!row) return false;
  return row.total > 0 && row.total === row.confirmados;
}

// ============================================================================
// 8.2: pantalla de preparación -- líneas de la ficha + contexto de receta.
// ============================================================================

export interface LineaParaPantalla {
  id: string;
  drogaId: string;
  drogaNombre: string;
  cantidadAPesar: string | null; // null only for esEnraseManual lines
  unidadMedidaId: string;
  unidadSimbolo: string;
  esEnraseManual: boolean;
  orden: number;
}

export async function getLineasParaPreparacion(tx: Prisma.TransactionClient, tenantId: string, fichaTecnicaId: string): Promise<LineaParaPantalla[]> {
  const rows = await tx.lineaPesaje.findMany({
    where: { tenantId, fichaTecnicaId },
    orderBy: { orden: "asc" },
    select: {
      id: true,
      drogaId: true,
      drogaNombre: true,
      cantidadAPesar: true,
      unidadMedidaId: true,
      esEnraseManual: true,
      orden: true,
      unidadMedida: { select: { simbolo: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    drogaId: r.drogaId,
    drogaNombre: r.drogaNombre,
    cantidadAPesar: r.cantidadAPesar ? r.cantidadAPesar.toString() : null,
    unidadMedidaId: r.unidadMedidaId,
    unidadSimbolo: r.unidadMedida.simbolo,
    esEnraseManual: r.esEnraseManual,
    orden: r.orden,
  }));
}

export interface PartidaElegible {
  id: string;
  lote: string;
  cantidadDisponible: string;
  fechaVencimiento: string; // YYYY-MM-DD
  fechaApertura: string | null; // ISO instant
}

/** Every partida of `drogaId` with balance, ordered by id (S11 determinism) -- `proponerReparto` (reparto.ts) does the vencida/FEFO filtering, this just loads candidates. */
export async function listPartidasElegiblesDroga(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<PartidaElegible[]> {
  const rows = await tx.$queryRaw<
    { id: string; lote: string; cantidad_disponible: string; fecha_vencimiento: string; fecha_apertura: string | null }[]
  >`
    SELECT id, lote, cantidad_disponible::text, fecha_vencimiento::text, fecha_apertura::text
    FROM fsj.partida
    WHERE tenant_id = ${tenantId}::uuid AND droga_id = ${drogaId}::uuid AND cantidad_disponible > 0
    ORDER BY id ASC
  `;
  return rows.map((r) => ({
    id: r.id,
    lote: r.lote,
    cantidadDisponible: r.cantidad_disponible,
    fechaVencimiento: r.fecha_vencimiento,
    fechaApertura: r.fecha_apertura,
  }));
}

export interface RecetaContextoAsiento {
  recetaId: string;
  pacienteNombre: string;
  pacienteApellido: string;
  medicoNombre: string;
  medicoApellido: string;
  medicoMatricula: string;
}

export async function getRecetaContextoAsiento(tx: Prisma.TransactionClient, tenantId: string, itemRecetaId: string): Promise<RecetaContextoAsiento | null> {
  const item = await tx.itemReceta.findUnique({
    where: { id: itemRecetaId, tenantId },
    select: {
      receta: {
        select: {
          id: true,
          paciente: { select: { nombre: true, apellido: true } },
          medico: { select: { nombre: true, apellido: true, matricula: true } },
        },
      },
    },
  });
  if (!item) return null;
  return {
    recetaId: item.receta.id,
    pacienteNombre: item.receta.paciente.nombre,
    pacienteApellido: item.receta.paciente.apellido,
    medicoNombre: item.receta.medico.nombre,
    medicoApellido: item.receta.medico.apellido,
    medicoMatricula: item.receta.medico.matricula,
  };
}

/**
 * `true` when the tenant's `jornada` (YYYY-MM-DD) already has a
 * `cierre_diario` row -- own minimal copy of a `fsj.cierre_diario` read
 * (M13a belongs to a different module; see this file's header comment for
 * why every repository keeps its own small cross-module reads). Used as a
 * FRIENDLY pre-check before the confirmation writes anything -- the DB's
 * own INV-C03 trigger on `movimiento_stock`/`asiento_recetario` remains the
 * real backstop regardless (see `mensajes-invariantes.ts`'s `INV-C03` entry
 * for the message a race that slips past this pre-check still gets).
 */
export async function existeCierreParaJornada(tx: Prisma.TransactionClient, tenantId: string, jornada: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM fsj.cierre_diario WHERE tenant_id = ${tenantId}::uuid AND fecha = ${jornada}::date) AS exists
  `;
  return rows[0]?.exists ?? false;
}

// ============================================================================
// 8.3: confirmación -- lock partidas, egresos, asiento, contralor.
// ============================================================================

/** Locks EVERY partida in `partidaIds`, in id order (deterministic -- plan §9 M11 step 4 "partidas elegidas FOR UPDATE (orden por id)"), in ONE statement. Returns the LOCKED ids (a missing id is simply absent -- caller compares lengths). */
export async function lockPartidasParaConfirmacion(tx: Prisma.TransactionClient, tenantId: string, partidaIds: readonly string[]): Promise<string[]> {
  if (partidaIds.length === 0) return [];
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.partida
    WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${partidaIds as string[]}::uuid[])
    ORDER BY id ASC
    FOR UPDATE
  `;
  return rows.map((r) => r.id);
}

export interface PartidaFresca {
  id: string;
  drogaId: string;
  lote: string;
  cantidadDisponible: string;
  fechaVencimiento: string; // YYYY-MM-DD
  fechaApertura: string | null;
}

/** Fresh read AFTER `lockPartidasParaConfirmacion` -- M3 discipline (never decide from a pre-lock snapshot). */
export async function getPartidasFrescas(tx: Prisma.TransactionClient, tenantId: string, partidaIds: readonly string[]): Promise<PartidaFresca[]> {
  if (partidaIds.length === 0) return [];
  const rows = await tx.$queryRaw<
    { id: string; droga_id: string; lote: string; cantidad_disponible: string; fecha_vencimiento: string; fecha_apertura: string | null }[]
  >`
    SELECT id, droga_id, lote, cantidad_disponible::text, fecha_vencimiento::text, fecha_apertura::text
    FROM fsj.partida
    WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${partidaIds as string[]}::uuid[])
  `;
  return rows.map((r) => ({
    id: r.id,
    drogaId: r.droga_id,
    lote: r.lote,
    cantidadDisponible: r.cantidad_disponible,
    fechaVencimiento: r.fecha_vencimiento,
    fechaApertura: r.fecha_apertura,
  }));
}

export interface NuevoEgresoInput {
  tenantId: string;
  partidaId: string;
  cantidad: string;
  preparacionId: string;
  lineaPesajeId: string;
  registradoPorId: string;
  desvioPropuesta: boolean;
}

export async function insertEgresoPreparacion(tx: Prisma.TransactionClient, input: NuevoEgresoInput): Promise<{ id: string }> {
  return tx.movimientoStock.create({
    data: {
      tenantId: input.tenantId,
      partidaId: input.partidaId,
      tipo: "EGRESO_PREPARACION",
      cantidad: input.cantidad,
      preparacionId: input.preparacionId,
      lineaPesajeId: input.lineaPesajeId,
      registradoPorId: input.registradoPorId,
      desvioPropuesta: input.desvioPropuesta,
    },
    select: { id: true },
  });
}

export async function getDrogaTipoControl(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<{ tipoControl: string; nombre: string; unidadBaseId: string } | null> {
  const droga = await tx.droga.findUnique({ where: { id: drogaId, tenantId }, select: { tipoControl: true, nombre: true, unidadBaseId: true } });
  return droga;
}

export async function getFechaActivacionContralor(tx: Prisma.TransactionClient, tenantId: string): Promise<Date | null> {
  const row = await tx.tenant.findUnique({ where: { id: tenantId }, select: { fechaActivacionContralor: true } });
  return row?.fechaActivacionContralor ?? null;
}

export interface DetalleAsientoInput {
  lineaPesajeId: string;
  descripcion: string;
  cantidad: string;
  unidadTexto: string;
  orden: number;
}

export interface NuevoAsientoRecetarioInput {
  tenantId: string;
  preparacionId: string;
  pacienteTexto: string;
  medicoTexto: string;
  formulaTexto: string;
  registradoPorId: string;
  detalles: DetalleAsientoInput[];
}

/**
 * INSERT `detalle_asiento` rows THEN `asiento_recetario` (origen SISTEMA),
 * in that order -- D4 (migration 0034, hash V3): the asiento's
 * hash_integridad now covers its own detalle lines, so the DB's BEFORE
 * INSERT trigger needs them to already exist under the asiento's id when
 * the asiento row is inserted. This requires an APP-GENERATED id
 * (`randomUUID()`, not the column's `gen_random_uuid()` default) shared by
 * every detalle row and the asiento itself -- passing `id` explicitly in
 * the `create()` call below is what makes Prisma/Postgres skip the
 * default. `detalle_asiento`'s FK to `asiento_recetario` is DEFERRABLE
 * INITIALLY DEFERRED precisely so this "child rows before the parent"
 * order is legal (checked at COMMIT, not at each INSERT). Trigger-assigned
 * columns on the asiento use placeholders -- see module doc comment.
 */
export async function insertAsientoRecetario(tx: Prisma.TransactionClient, input: NuevoAsientoRecetarioInput): Promise<{ id: string; numeroCorrelativo: string }> {
  const asientoId = randomUUID();

  for (const detalle of input.detalles) {
    await tx.detalleAsiento.create({
      data: {
        tenantId: input.tenantId,
        asientoRecetarioId: asientoId,
        lineaPesajeId: detalle.lineaPesajeId,
        descripcion: detalle.descripcion,
        cantidad: detalle.cantidad,
        unidadTexto: detalle.unidadTexto,
        orden: detalle.orden,
      },
    });
  }

  const asiento = await tx.asientoRecetario.create({
    data: {
      id: asientoId,
      tenantId: input.tenantId,
      libroId: PLACEHOLDER_UUID,
      numeroCorrelativo: BigInt(0),
      fechaAsiento: PLACEHOLDER_DATE,
      origen: "SISTEMA",
      preparacionId: input.preparacionId,
      pacienteTexto: input.pacienteTexto,
      medicoTexto: input.medicoTexto,
      formulaTexto: input.formulaTexto,
      hashIntegridad: "",
      hashAnterior: "",
      registradoPorId: input.registradoPorId,
    },
    select: { id: true, numeroCorrelativo: true },
  });

  return { id: asiento.id, numeroCorrelativo: asiento.numeroCorrelativo.toString() };
}

export interface NuevoAsientoContralorInput {
  tenantId: string;
  drogaId: string;
  drogaDescripcion: string;
  cantidad: string;
  unidadMedidaId: string;
  movimientoStockId: string;
  asientoRecetarioId: string;
  registradoPorId: string;
}

/** INSERT `asiento_contralor` (tipo EGRESO, por preparación) -- INV-L08. Trigger-assigned columns use placeholders -- see module doc comment. */
export async function insertAsientoContralorEgreso(tx: Prisma.TransactionClient, input: NuevoAsientoContralorInput): Promise<{ id: string }> {
  return tx.asientoContralor.create({
    data: {
      tenantId: input.tenantId,
      libroId: PLACEHOLDER_UUID,
      numeroCorrelativo: BigInt(0),
      fechaAsiento: PLACEHOLDER_DATE,
      tipoMovimiento: "EGRESO" as TipoMovimientoContralor,
      drogaId: input.drogaId,
      drogaDescripcion: input.drogaDescripcion,
      cantidad: input.cantidad,
      unidadMedidaId: input.unidadMedidaId,
      saldoAnterior: "0",
      saldoPosterior: "0",
      movimientoStockId: input.movimientoStockId,
      asientoRecetarioId: input.asientoRecetarioId,
      hashIntegridad: "",
      hashAnterior: "",
      registradoPorId: input.registradoPorId,
    },
    select: { id: true },
  });
}

export async function updatePreparacionConfirmada(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string,
  preparadaPorId: string,
): Promise<void> {
  await tx.preparacion.update({
    where: { id, tenantId },
    data: { estado: "CONFIRMADA", confirmadaEn: new Date(), preparadaPorId },
  });
}

// ============================================================================
// 8.5: etiqueta
// ============================================================================

export interface PreparacionParaEtiqueta {
  id: string;
  confirmadaEn: Date;
  preparadaPorNombre: string;
  preparadaPorApellido: string;
  itemDescripcion: string | null;
  formaFarmaceutica: string;
  cantidadUnidades: number;
  /** Snapshot texts (INV-L05) from the preparación's own SISTEMA asiento_recetario -- the label reflects what was legally recorded, not a live re-join to paciente/médico. */
  pacienteTexto: string;
  medicoTexto: string;
  formulaTexto: string;
  asientoNumeroCorrelativo: string | null;
  tenantRazonSocial: string;
  tenantNombreFantasia: string | null;
  tenantMatriculaFarmacia: string | null;
}

export async function getPreparacionParaEtiqueta(tx: Prisma.TransactionClient, tenantId: string, preparacionId: string): Promise<PreparacionParaEtiqueta | null> {
  const prep = await tx.preparacion.findUnique({
    where: { id: preparacionId, tenantId },
    select: {
      id: true,
      estado: true,
      confirmadaEn: true,
      preparadaPor: { select: { nombre: true, apellido: true } },
      fichaTecnica: {
        select: {
          itemReceta: { select: { descripcion: true, formaFarmaceutica: true, cantidadUnidades: true } },
        },
      },
      asientosRecetario: {
        where: { origen: "SISTEMA" },
        select: { numeroCorrelativo: true, pacienteTexto: true, medicoTexto: true, formulaTexto: true },
        take: 1,
      },
    },
  });
  if (!prep || prep.estado !== "CONFIRMADA" || !prep.confirmadaEn || !prep.preparadaPor) return null;
  const asiento = prep.asientosRecetario[0];
  if (!asiento) return null; // INV-P04: a CONFIRMADA preparación always has one -- defensive.

  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { razonSocial: true, nombreFantasia: true, matriculaFarmacia: true },
  });

  const item = prep.fichaTecnica.itemReceta;
  return {
    id: prep.id,
    confirmadaEn: prep.confirmadaEn,
    preparadaPorNombre: prep.preparadaPor.nombre,
    preparadaPorApellido: prep.preparadaPor.apellido,
    itemDescripcion: item.descripcion,
    formaFarmaceutica: item.formaFarmaceutica,
    cantidadUnidades: item.cantidadUnidades,
    pacienteTexto: asiento.pacienteTexto,
    medicoTexto: asiento.medicoTexto,
    formulaTexto: asiento.formulaTexto,
    asientoNumeroCorrelativo: asiento.numeroCorrelativo.toString(),
    tenantRazonSocial: tenant.razonSocial,
    tenantNombreFantasia: tenant.nombreFantasia,
    tenantMatriculaFarmacia: tenant.matriculaFarmacia,
  };
}

export async function getEtiquetaExistente(tx: Prisma.TransactionClient, tenantId: string, preparacionId: string): Promise<{ id: string } | null> {
  return tx.etiqueta.findUnique({ where: { tenantId_preparacionId: { tenantId, preparacionId } }, select: { id: true } });
}

export async function insertEtiqueta(tx: Prisma.TransactionClient, tenantId: string, preparacionId: string, contenido: string): Promise<{ id: string }> {
  return tx.etiqueta.create({ data: { tenantId, preparacionId, contenido }, select: { id: true } });
}

export interface EtiquetaParaImprimir {
  id: string;
  preparacionId: string;
  contenido: string;
  generadaEn: Date;
  impresa: boolean;
}

export async function getEtiquetaParaImprimir(tx: Prisma.TransactionClient, tenantId: string, preparacionId: string): Promise<EtiquetaParaImprimir | null> {
  return tx.etiqueta.findUnique({
    where: { tenantId_preparacionId: { tenantId, preparacionId } },
    select: { id: true, preparacionId: true, contenido: true, generadaEn: true, impresa: true },
  });
}

export async function marcarEtiquetaImpresa(tx: Prisma.TransactionClient, tenantId: string, id: string, impresaPorId: string): Promise<void> {
  await tx.etiqueta.updateMany({ where: { id, tenantId, impresa: false }, data: { impresa: true, impresaEn: new Date(), impresaPorId } });
}

/** Combined shape for the PDF route (`etiqueta` + its already-CONFIRMADA `preparación` snapshot data). Defined here (infra), not in `application/`, so `infrastructure/etiqueta-pdf.ts` can import it without reaching into a sibling application/ file. */
export interface EtiquetaParaImprimirDatos extends PreparacionParaEtiqueta {
  etiquetaId: string;
  generadaEn: Date;
}

// ============================================================================
// Listados
// ============================================================================

export interface PreparacionListItem {
  id: string;
  estado: EstadoPreparacion;
  fichaTecnicaId: string;
  iniciadaEn: Date;
  confirmadaEn: Date | null;
  itemDescripcion: string | null;
  formaFarmaceutica: string;
  recetaNumeroInterno: string;
  pacienteNombre: string;
  pacienteApellido: string;
}

export interface ListPreparacionesFilter {
  tenantId: string;
  estado?: EstadoPreparacion;
  page: number;
  pageSize: number;
}

export async function listPreparaciones(tx: Prisma.TransactionClient, filter: ListPreparacionesFilter): Promise<{ items: PreparacionListItem[]; total: number }> {
  const where: Prisma.PreparacionWhereInput = { tenantId: filter.tenantId };
  if (filter.estado) where.estado = filter.estado;
  const skip = (filter.page - 1) * filter.pageSize;

  const [total, rows] = await Promise.all([
    tx.preparacion.count({ where }),
    tx.preparacion.findMany({
      where,
      orderBy: [{ iniciadaEn: "desc" }],
      skip,
      take: filter.pageSize,
      select: {
        id: true,
        estado: true,
        fichaTecnicaId: true,
        iniciadaEn: true,
        confirmadaEn: true,
        fichaTecnica: {
          select: {
            itemReceta: {
              select: {
                descripcion: true,
                formaFarmaceutica: true,
                receta: { select: { numeroInterno: true, paciente: { select: { nombre: true, apellido: true } } } },
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      estado: r.estado,
      fichaTecnicaId: r.fichaTecnicaId,
      iniciadaEn: r.iniciadaEn,
      confirmadaEn: r.confirmadaEn,
      itemDescripcion: r.fichaTecnica.itemReceta.descripcion,
      formaFarmaceutica: r.fichaTecnica.itemReceta.formaFarmaceutica,
      recetaNumeroInterno: r.fichaTecnica.itemReceta.receta.numeroInterno.toString(),
      pacienteNombre: r.fichaTecnica.itemReceta.receta.paciente.nombre,
      pacienteApellido: r.fichaTecnica.itemReceta.receta.paciente.apellido,
    })),
  };
}
