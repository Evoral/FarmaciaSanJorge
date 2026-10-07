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
import { Prisma } from "@/generated/prisma/client";
import type { EstadoPreparacion, EstadoReceta, TipoMovimientoContralor } from "@/generated/prisma/enums";
import { jornadaDe, rangoDeJornadas } from "@/shared/time/jornada";
import { ordenarComponentes } from "@/modules/elaboracion/domain/orden-componentes";
import type { ModoExpresion } from "@/modules/recetas/domain/receta";
import type { DatosEtiqueta } from "../domain/etiqueta";
import { parseMesesVencimientoPreparado } from "../domain/vencimiento";

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
  version: number;
  itemRecetaId: string;
  recetaId: string;
  recetaNumeroInterno: string;
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
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('ficha_tecnica:' || ${tenantId} || ':' || ${fichaTecnicaId}, 0))`;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.ficha_tecnica WHERE id = ${fichaTecnicaId}::uuid AND tenant_id = ${tenantId}::uuid
  `;
  return rows.length === 1;
}

export async function getFichaParaIniciar(tx: Prisma.TransactionClient, tenantId: string, fichaTecnicaId: string): Promise<FichaParaIniciar | null> {
  const ficha = await tx.fichaTecnica.findUnique({
    where: { id: fichaTecnicaId, tenantId },
    select: { id: true, version: true, itemRecetaId: true, itemReceta: { select: { recetaId: true, receta: { select: { estado: true, numeroInterno: true } } } } },
  });
  if (!ficha) return null;
  return {
    id: ficha.id,
    version: ficha.version,
    itemRecetaId: ficha.itemRecetaId,
    recetaId: ficha.itemReceta.recetaId,
    recetaNumeroInterno: ficha.itemReceta.receta.numeroInterno.toString(),
    recetaEstado: ficha.itemReceta.receta.estado,
  };
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
  proveedorNombre: string;
  cantidadDisponible: string;
  fechaVencimiento: string | null; // YYYY-MM-DD; null = does not expire (0064)
  fechaApertura: string | null; // ISO instant
  /** Migration 0058: declared purity (percent), `null` = 100%. */
  potenciaDeclarada: string | null;
}

/** Every partida of `drogaId` with balance, ordered by id (S11 determinism) -- `proponerReparto` (reparto.ts) does the vencida/FEFO filtering, this just loads candidates. */
export async function listPartidasElegiblesDroga(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<PartidaElegible[]> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      lote: string;
      proveedor_nombre: string;
      cantidad_disponible: string;
      fecha_vencimiento: string | null;
      fecha_apertura: string | null;
      potencia_declarada: string | null;
    }[]
  >`
    SELECT p.id, p.lote, pr.razon_social AS proveedor_nombre, p.cantidad_disponible::text, p.fecha_vencimiento::text, p.fecha_apertura::text,
      p.potencia_declarada::text
    FROM fsj.partida p
    JOIN fsj.proveedor pr ON pr.tenant_id = p.tenant_id AND pr.id = p.proveedor_id
    WHERE p.tenant_id = ${tenantId}::uuid AND p.droga_id = ${drogaId}::uuid AND p.cantidad_disponible > 0
    ORDER BY p.id ASC
  `;
  return rows.map((r) => ({
    id: r.id,
    lote: r.lote,
    proveedorNombre: r.proveedor_nombre,
    cantidadDisponible: r.cantidad_disponible,
    fechaVencimiento: r.fecha_vencimiento,
    fechaApertura: r.fecha_apertura,
    potenciaDeclarada: r.potencia_declarada,
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
  fechaVencimiento: string | null; // YYYY-MM-DD; null = does not expire (0064)
  fechaApertura: string | null;
  /** Migration 0058: declared purity (percent), `null` = 100%. */
  potenciaDeclarada: string | null;
}

/** Fresh read AFTER `lockPartidasParaConfirmacion` -- M3 discipline (never decide from a pre-lock snapshot). */
export async function getPartidasFrescas(tx: Prisma.TransactionClient, tenantId: string, partidaIds: readonly string[]): Promise<PartidaFresca[]> {
  if (partidaIds.length === 0) return [];
  const rows = await tx.$queryRaw<
    {
      id: string;
      droga_id: string;
      lote: string;
      cantidad_disponible: string;
      fecha_vencimiento: string | null;
      fecha_apertura: string | null;
      potencia_declarada: string | null;
    }[]
  >`
    SELECT id, droga_id, lote, cantidad_disponible::text, fecha_vencimiento::text, fecha_apertura::text, potencia_declarada::text
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
    potenciaDeclarada: r.potencia_declarada,
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
  /** Migration 0058: purity snapshot (percent) used for this consumption; `null` for manual-enrase lines (no correction). */
  potenciaAplicada: string | null;
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
      potenciaAplicada: input.potenciaAplicada,
    },
    select: { id: true },
  });
}

/** `clase` (migration 0063): non-DROGA lines are left out of the libro recetario -- see confirmar-preparacion.ts. */
export async function getDrogaTipoControl(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
): Promise<{ tipoControl: string; clase: string; nombre: string; unidadBaseId: string } | null> {
  const droga = await tx.droga.findUnique({ where: { id: drogaId, tenantId }, select: { tipoControl: true, clase: true, nombre: true, unidadBaseId: true } });
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

/**
 * `fechaVencimiento` (`YYYY-MM-DD`) is the snapshot of the preparado's expiry
 * (migration 0068): it is written in the SAME UPDATE that confirms, the only
 * moment the DB lets it change.
 */
export async function updatePreparacionConfirmada(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string,
  preparadaPorId: string,
  fechaVencimiento: string,
): Promise<void> {
  await tx.preparacion.update({
    where: { id, tenantId },
    data: {
      estado: "CONFIRMADA",
      confirmadaEn: new Date(),
      preparadaPorId,
      fechaVencimiento: new Date(`${fechaVencimiento}T00:00:00.000Z`), // @db.Date columns are written as UTC midnight.
    },
  });
}

/**
 * `meses_vencimiento_preparado` `parametro` row (DP-28 "Vencimiento"), with
 * the defensive fallback to the default (3) when the tenant has no usable row
 * -- same discipline as `modules/stock/infrastructure/partida-repository.ts#getDiasAlertaVencimiento`.
 * Reads `fsj.parametro` directly because modules cannot reach into another
 * module's infrastructure layer (`modules/parametros`).
 */
export async function getMesesVencimientoPreparado(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  const row = await tx.parametro.findUnique({
    where: { tenantId_clave: { tenantId, clave: "meses_vencimiento_preparado" } },
    select: { valor: true },
  });
  return parseMesesVencimientoPreparado(row?.valor);
}

// ============================================================================
// 8.5: etiqueta
// ============================================================================

/** Everything the etiqueta shows (domain/etiqueta.ts's `DatosEtiqueta`), plus the fields the audit and the libro snapshot use. */
export interface PreparacionParaEtiqueta extends DatosEtiqueta {
  id: string;
  confirmadaEn: Date;
  preparadaPorNombre: string;
  preparadaPorApellido: string;
  itemDescripcion: string | null;
  /** Snapshot texts (INV-L05) from the preparación's own SISTEMA asiento_recetario. */
  pacienteTexto: string;
  medicoTexto: string;
  formulaTexto: string;
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
      fechaVencimiento: true,
      preparadaPor: { select: { nombre: true, apellido: true } },
      fichaTecnica: {
        select: {
          itemReceta: {
            select: {
              descripcion: true,
              formaFarmaceutica: true,
              cantidadUnidades: true,
              componentes: {
                select: {
                  cantidad: true,
                  modoExpresion: true,
                  esPrincipioActivo: true,
                  droga: { select: { nombre: true } },
                  unidadMedida: { select: { simbolo: true } },
                },
              },
              receta: {
                select: {
                  numeroInterno: true,
                  medico: { select: { nombre: true, apellido: true, matricula: true, matriculaJurisdiccion: true } },
                },
              },
            },
          },
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
    select: { razonSocial: true, nombreFantasia: true, matriculaFarmacia: true, domicilio: true, zonaHoraria: true },
  });
  const directorTecnico = await getDtVigenteEnJornada(tx, tenantId, jornadaDe(prep.confirmadaEn, tenant.zonaHoraria));

  const item = prep.fichaTecnica.itemReceta;
  const medico = item.receta.medico;
  return {
    id: prep.id,
    confirmadaEn: prep.confirmadaEn,
    preparadaPorNombre: prep.preparadaPor.nombre,
    preparadaPorApellido: prep.preparadaPor.apellido,
    itemDescripcion: item.descripcion,
    formaFarmaceutica: item.formaFarmaceutica,
    cantidadUnidades: item.cantidadUnidades,
    componentes: item.componentes.map((c) => ({
      drogaNombre: c.droga.nombre,
      cantidad: c.cantidad === null ? null : c.cantidad.toString(),
      unidadSimbolo: c.unidadMedida.simbolo,
      modoExpresion: c.modoExpresion,
      esPrincipioActivo: c.esPrincipioActivo,
    })),
    recetaNumeroInterno: item.receta.numeroInterno.toString(),
    medicoNombre: medico.nombre,
    medicoApellido: medico.apellido,
    medicoMatricula: medico.matricula,
    medicoJurisdiccion: medico.matriculaJurisdiccion,
    directorTecnico,
    pacienteTexto: asiento.pacienteTexto,
    medicoTexto: asiento.medicoTexto,
    formulaTexto: asiento.formulaTexto,
    asientoNumeroCorrelativo: asiento.numeroCorrelativo.toString(),
    tenantRazonSocial: tenant.razonSocial,
    tenantNombreFantasia: tenant.nombreFantasia,
    tenantMatriculaFarmacia: tenant.matriculaFarmacia,
    tenantDomicilio: tenant.domicilio,
    fechaVencimiento: prep.fechaVencimiento ? prep.fechaVencimiento.toISOString().slice(0, 10) : null, // @db.Date comes back as UTC midnight.
  };
}

/**
 * The director técnico vigente on `jornada` (`YYYY-MM-DD`): the TITULAR,
 * else a SUPLENTE. Same WHERE as modules/directores-tecnicos'
 * `dtVigenteHoy`, but for a given date -- read here, against the shared
 * `tx`, because modules only reach their own infrastructure/ (the libro
 * and stock co-firma repositories do the same).
 */
export async function getDtVigenteEnJornada(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jornada: string,
): Promise<{ nombre: string; apellido: string; matricula: string } | null> {
  const fecha = new Date(`${jornada}T00:00:00.000Z`); // @db.Date columns compare as UTC midnight.
  const rows = await tx.designacionDirectorTecnico.findMany({
    where: { tenantId, vigenteDesde: { lte: fecha }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: fecha } }] },
    orderBy: [{ vigenteDesde: "desc" }],
    select: { caracter: true, matricula: true, usuario: { select: { nombre: true, apellido: true } } },
  });
  const dt = rows.find((r) => r.caracter === "TITULAR") ?? rows[0];
  return dt ? { nombre: dt.usuario.nombre, apellido: dt.usuario.apellido, matricula: dt.matricula } : null;
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
  recetaId: string;
  recetaNumeroInterno: string;
  pacienteNombre: string;
  pacienteApellido: string;
  /** `null` when no etiqueta was generated yet (domain/listado.ts's `estadoEtiqueta`). */
  etiqueta: { impresa: boolean } | null;
}

export interface ListPreparacionesFilter {
  tenantId: string;
  estado?: EstadoPreparacion;
  /** Nº interno de la receta (digits). */
  numeroInterno?: string;
  /** `YYYY-MM-DD` on `iniciada_en`, as the tenant's calendar day. */
  desde?: string;
  hasta?: string;
  /** Only CONFIRMADA ones whose etiqueta is missing or never printed. */
  sinEtiquetaImpresa?: boolean;
  page: number;
  pageSize: number;
}

export type FiltroComunPreparaciones = Pick<ListPreparacionesFilter, "tenantId" | "numeroInterno" | "desde" | "hasta">;

async function zonaHorariaTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { zonaHoraria: true } });
  return tenant.zonaHoraria;
}

/** The filters every tab shares (número, fechas) -- `zonaHoraria` turns the calendar days into instants. */
function whereComun(filter: FiltroComunPreparaciones, zonaHoraria: string): Prisma.PreparacionWhereInput {
  const where: Prisma.PreparacionWhereInput = { tenantId: filter.tenantId };
  if (filter.numeroInterno) {
    where.fichaTecnica = { itemReceta: { receta: { numeroInterno: BigInt(filter.numeroInterno) } } };
  }
  if (filter.desde || filter.hasta) {
    const { desde, hastaExclusivo } = rangoDeJornadas(filter.desde, filter.hasta, zonaHoraria);
    where.iniciadaEn = { ...(desde ? { gte: desde } : {}), ...(hastaExclusivo ? { lt: hastaExclusivo } : {}) };
  }
  return where;
}

const SIN_ETIQUETA_IMPRESA: Prisma.PreparacionWhereInput = { OR: [{ etiqueta: { is: null } }, { etiqueta: { is: { impresa: false } } }] };

function wherePestana(comun: Prisma.PreparacionWhereInput, estado: EstadoPreparacion, sinEtiquetaImpresa: boolean): Prisma.PreparacionWhereInput {
  return estado === "CONFIRMADA" && sinEtiquetaImpresa ? { AND: [comun, { estado }, SIN_ETIQUETA_IMPRESA] } : { AND: [comun, { estado }] };
}

export async function listPreparaciones(
  tx: Prisma.TransactionClient,
  filter: ListPreparacionesFilter,
): Promise<{ items: PreparacionListItem[]; total: number; zonaHoraria: string }> {
  const zonaHoraria = await zonaHorariaTenant(tx, filter.tenantId);
  const comun = whereComun(filter, zonaHoraria);
  const where = filter.estado ? wherePestana(comun, filter.estado, filter.sinEtiquetaImpresa ?? false) : comun;
  const skip = (filter.page - 1) * filter.pageSize;

  const total = await tx.preparacion.count({ where });
  const rows = await tx.preparacion.findMany({
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
      // Etiqueta state in the SAME query (relationJoins): no N+1.
      etiqueta: { select: { impresa: true } },
      fichaTecnica: {
        select: {
          itemReceta: {
            select: {
              descripcion: true,
              formaFarmaceutica: true,
              receta: { select: { id: true, numeroInterno: true, paciente: { select: { nombre: true, apellido: true } } } },
            },
          },
        },
      },
    },
  });

  return {
    total,
    zonaHoraria,
    items: rows.map((r) => ({
      id: r.id,
      estado: r.estado,
      fichaTecnicaId: r.fichaTecnicaId,
      iniciadaEn: r.iniciadaEn,
      confirmadaEn: r.confirmadaEn,
      itemDescripcion: r.fichaTecnica.itemReceta.descripcion,
      formaFarmaceutica: r.fichaTecnica.itemReceta.formaFarmaceutica,
      recetaId: r.fichaTecnica.itemReceta.receta.id,
      recetaNumeroInterno: r.fichaTecnica.itemReceta.receta.numeroInterno.toString(),
      pacienteNombre: r.fichaTecnica.itemReceta.receta.paciente.nombre,
      pacienteApellido: r.fichaTecnica.itemReceta.receta.paciente.apellido,
      etiqueta: r.etiqueta ? { impresa: r.etiqueta.impresa } : null,
    })),
  };
}

// ============================================================================
// Pendientes: recetas waiting for the lab to take them (one row per receta)
// ============================================================================

/**
 * The SQL condition "this ítem still needs a preparación": none of its
 * fichas (any version) has a preparación INICIADA or CONFIRMADA -- a
 * DESCARTADA one puts it back in the queue; an ítem whose asiento was later
 * dejado "sin efecto" keeps its CONFIRMADA preparación, so it is done.
 * (`preparacion.item_receta_id` is trigger-copied from the ficha, so it
 * covers every version.) `ir` must be the `fsj.item_receta` row's alias.
 */
const ITEM_SIN_PREPARACION_ACTIVA = Prisma.sql`
  NOT EXISTS (
    SELECT 1
    FROM fsj.preparacion p
    WHERE p.tenant_id = ir.tenant_id AND p.item_receta_id = ir.id AND p.estado IN ('INICIADA', 'CONFIRMADA')
  )
`;

export interface RecetaPendienteFila {
  recetaId: string;
  recetaNumeroInterno: string;
  recetaFechaIngreso: Date;
  pacienteNombre: string;
  pacienteApellido: string;
}

export interface ListRecetasPendientesFilter {
  tenantId: string;
  /** Nº interno de la receta (digits). */
  numeroInterno?: string;
  /** `YYYY-MM-DD` on the receta's `fecha_ingreso`, as the tenant's calendar day (inclusive). */
  desde?: string;
  hasta?: string;
  page: number;
  pageSize: number;
}

/** One row of `listRecetasPendientesSql`: every page column is NULL on the single row of an empty page. */
export interface ListRecetasPendientesRow {
  total: number;
  zona_horaria: string;
  receta_id: string | null;
  receta_numero_interno: string | null;
  receta_fecha_ingreso: Date | null;
  paciente_nombre: string | null;
  paciente_apellido: string | null;
}

/**
 * The /preparaciones "Pendientes" tab: recetas PENDIENTE_PREPARACION or
 * EN_PREPARACION that nobody took (`tomada_por_id IS NULL`, migration 0057)
 * and that still have at least one ítem needing a preparación
 * (`ITEM_SIN_PREPARACION_ACTIVA`). A receta without a ficha técnica is
 * listed too (the toma workspace lets the lab generate it).
 *
 * Oldest first, so none is skipped: `fecha_ingreso`, then receta Nº.
 *
 * Built separately (like stock's `listAjustesSql`) so
 * tests/db/preparaciones-pendientes.test.ts runs this EXACT statement on its
 * raw `pg` connection. A page past the end still reports the real total.
 */
export function listRecetasPendientesSql(filter: ListRecetasPendientesFilter): Prisma.Sql {
  const numero = filter.numeroInterno?.replace(/\D/g, "") || null;
  const desde = filter.desde ?? null;
  const hasta = filter.hasta ?? null;
  const skip = (filter.page - 1) * filter.pageSize;

  return Prisma.sql`
    WITH filtradas AS (
      SELECT
        r.id AS receta_id,
        r.numero_interno,
        r.fecha_ingreso,
        pa.nombre AS paciente_nombre,
        pa.apellido AS paciente_apellido
      FROM fsj.receta r
      JOIN fsj.tenant tn ON tn.id = r.tenant_id
      JOIN fsj.paciente pa ON pa.tenant_id = r.tenant_id AND pa.id = r.paciente_id
      WHERE r.tenant_id = ${filter.tenantId}::uuid
        AND r.estado IN ('PENDIENTE_PREPARACION', 'EN_PREPARACION')
        AND r.tomada_por_id IS NULL
        AND (${numero}::bigint IS NULL OR r.numero_interno = ${numero}::bigint)
        AND (${desde}::date IS NULL OR fsj.jornada_de(r.fecha_ingreso, tn.zona_horaria) >= ${desde}::date)
        AND (${hasta}::date IS NULL OR fsj.jornada_de(r.fecha_ingreso, tn.zona_horaria) <= ${hasta}::date)
        AND EXISTS (
          SELECT 1
          FROM fsj.item_receta ir
          WHERE ir.tenant_id = r.tenant_id AND ir.receta_id = r.id AND ${ITEM_SIN_PREPARACION_ACTIVA}
        )
    )
    SELECT
      t.total,
      t.zona_horaria,
      f.receta_id,
      f.numero_interno::text AS receta_numero_interno,
      f.fecha_ingreso AS receta_fecha_ingreso,
      f.paciente_nombre,
      f.paciente_apellido
    FROM (
      SELECT
        (SELECT count(*)::int FROM filtradas) AS total,
        (SELECT zona_horaria FROM fsj.tenant WHERE id = ${filter.tenantId}::uuid) AS zona_horaria
    ) t
    LEFT JOIN LATERAL (
      SELECT *
      FROM filtradas
      ORDER BY fecha_ingreso ASC, numero_interno ASC
      LIMIT ${filter.pageSize}::int OFFSET ${skip}::int
    ) f ON true
  `;
}

export async function listRecetasPendientes(
  tx: Prisma.TransactionClient,
  filter: ListRecetasPendientesFilter,
): Promise<{ items: RecetaPendienteFila[]; total: number; zonaHoraria: string }> {
  const rows = await tx.$queryRaw<ListRecetasPendientesRow[]>(listRecetasPendientesSql(filter));
  if (!rows[0]) throw new Error(`listRecetasPendientes: no row for tenant ${filter.tenantId}`);

  return {
    total: rows[0].total,
    zonaHoraria: rows[0].zona_horaria,
    items: rows
      .filter((row) => row.receta_id !== null)
      .map((row) => ({
        recetaId: row.receta_id!,
        recetaNumeroInterno: row.receta_numero_interno!,
        recetaFechaIngreso: row.receta_fecha_ingreso!,
        pacienteNombre: row.paciente_nombre!,
        pacienteApellido: row.paciente_apellido!,
      })),
  };
}

/** A pending ítem of a listed receta: what the "Ver" preview shows (as on the receta detail page); `cantidadTotal` is the Decimal as text. */
export interface ItemPendienteFila {
  recetaId: string;
  itemRecetaId: string;
  itemDescripcion: string | null;
  formaFarmaceutica: string;
  cantidadUnidades: number;
  cantidadTotal: string | null;
  unidadTotalSimbolo: string | null;
  posologia: string | null;
  duracionTratamientoDias: number | null;
  /** 1-based position of the ítem in its receta (detail-page order) and the receta's ítem count, for "(ítem N de M)". */
  posicion: number;
  totalItems: number;
}

/** One row of `listItemsPendientesDeRecetasSql`. */
export interface ListItemsPendientesRow {
  receta_id: string;
  item_receta_id: string;
  item_descripcion: string | null;
  forma_farmaceutica: string;
  cantidad_unidades: number;
  cantidad_total: string | null;
  unidad_total_simbolo: string | null;
  posologia: string | null;
  duracion_tratamiento_dias: number | null;
  posicion: number;
  total_items: number;
}

/**
 * The pending ítems of a page of recetas, in ONE statement (no N+1),
 * ordered by receta then position. `item_receta` has no order column: the
 * receta detail page reads a receta's ítems without ORDER BY, which
 * Postgres returns in physical (ctid) order for a scan of one receta's rows
 * (seq scan, or the (tenant_id, receta_id) index, whose duplicates are kept
 * in heap-TID order) -- ordering by ctid reproduces that deterministically.
 * The position is computed over ALL the receta's ítems, before dropping the
 * ones already taken care of. Built separately for tests/db.
 */
export function listItemsPendientesDeRecetasSql(tenantId: string, recetaIds: string[]): Prisma.Sql {
  return Prisma.sql`
    WITH items AS (
      SELECT
        ir.id,
        ir.tenant_id,
        ir.receta_id,
        ir.descripcion,
        ir.forma_farmaceutica,
        ir.cantidad_unidades,
        ir.cantidad_total,
        ir.unidad_total_id,
        ir.posologia,
        ir.duracion_tratamiento_dias,
        row_number() OVER (PARTITION BY ir.receta_id ORDER BY ir.ctid)::int AS posicion,
        count(*) OVER (PARTITION BY ir.receta_id)::int AS total_items
      FROM fsj.item_receta ir
      WHERE ir.tenant_id = ${tenantId}::uuid AND ir.receta_id = ANY(${recetaIds}::uuid[])
    )
    SELECT
      ir.receta_id,
      ir.id AS item_receta_id,
      ir.descripcion AS item_descripcion,
      ir.forma_farmaceutica::text AS forma_farmaceutica,
      ir.cantidad_unidades,
      ir.cantidad_total::text AS cantidad_total,
      ut.simbolo AS unidad_total_simbolo,
      ir.posologia,
      ir.duracion_tratamiento_dias,
      ir.posicion,
      ir.total_items
    FROM items ir
    LEFT JOIN fsj.unidad_medida ut ON ut.id = ir.unidad_total_id
    WHERE ${ITEM_SIN_PREPARACION_ACTIVA}
    ORDER BY ir.receta_id, ir.posicion ASC
  `;
}

/** Pending ítems by receta id, each receta's in position order; no query for an empty page. */
export async function listItemsPendientesDeRecetas(
  tx: Prisma.TransactionClient,
  tenantId: string,
  recetaIds: string[],
): Promise<Map<string, ItemPendienteFila[]>> {
  const porReceta = new Map<string, ItemPendienteFila[]>();
  if (recetaIds.length === 0) return porReceta;
  const rows = await tx.$queryRaw<ListItemsPendientesRow[]>(listItemsPendientesDeRecetasSql(tenantId, recetaIds));
  for (const row of rows) {
    const items = porReceta.get(row.receta_id) ?? [];
    items.push({
      recetaId: row.receta_id,
      itemRecetaId: row.item_receta_id,
      itemDescripcion: row.item_descripcion,
      formaFarmaceutica: row.forma_farmaceutica,
      cantidadUnidades: row.cantidad_unidades,
      cantidadTotal: row.cantidad_total,
      unidadTotalSimbolo: row.unidad_total_simbolo,
      posologia: row.posologia,
      duracionTratamientoDias: row.duracion_tratamiento_dias,
      posicion: row.posicion,
      totalItems: row.total_items,
    });
    porReceta.set(row.receta_id, items);
  }
  return porReceta;
}

/** One componente of an ítem (the "Ver" preview's and the workspace's table), as on the receta detail page; `cantidad` is the Decimal as text. */
export interface ComponenteDePendiente {
  id: string;
  /** Canonical name. */
  drogaNombre: string;
  /** The synonym the componente was loaded with (migration 0069), shown with the canonical name as a hint. */
  sinonimo: string | null;
  cantidad: string | null;
  unidadMedidaSimbolo: string;
  modoExpresion: ModoExpresion;
  esPrincipioActivo: boolean;
}

/** One row of `listComponentesDePendientesSql`. */
export interface ListComponentesDePendientesRow {
  item_receta_id: string;
  id: string;
  droga_nombre: string;
  sinonimo: string | null;
  cantidad: string | null;
  unidad_medida_simbolo: string;
  modo_expresion: ModoExpresion;
  es_principio_activo: boolean;
}

/**
 * The componentes of a page of pending ítems, in ONE statement (no N+1):
 * tenant-scoped, unordered (`listComponentesDePendientes` sorts each
 * ítem's with `ordenarComponentes`). Built separately so
 * tests/db/preparaciones-pendientes.test.ts runs this EXACT statement on its
 * raw `pg` connection. `unidad_medida` is global (no tenant_id).
 */
export function listComponentesDePendientesSql(tenantId: string, itemIds: string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT
      c.item_receta_id,
      c.id,
      d.nombre AS droga_nombre,
      da.texto AS sinonimo,
      c.cantidad::text AS cantidad,
      um.simbolo AS unidad_medida_simbolo,
      c.modo_expresion::text AS modo_expresion,
      c.es_principio_activo
    FROM fsj.componente_item_receta c
    JOIN fsj.droga d ON d.tenant_id = c.tenant_id AND d.id = c.droga_id
    LEFT JOIN fsj.droga_alias da ON da.tenant_id = c.tenant_id AND da.id = c.droga_alias_id
    JOIN fsj.unidad_medida um ON um.id = c.unidad_medida_id
    WHERE c.tenant_id = ${tenantId}::uuid AND c.item_receta_id = ANY(${itemIds}::uuid[])
  `;
}

/** Componentes by ítem id, each ítem's in `ordenarComponentes` order; an ítem without componentes is absent from the map. No query for an empty page. */
export async function listComponentesDePendientes(
  tx: Prisma.TransactionClient,
  tenantId: string,
  itemIds: string[],
): Promise<Map<string, ComponenteDePendiente[]>> {
  const porItem = new Map<string, ComponenteDePendiente[]>();
  if (itemIds.length === 0) return porItem;
  const rows = await tx.$queryRaw<ListComponentesDePendientesRow[]>(listComponentesDePendientesSql(tenantId, itemIds));
  for (const row of rows) {
    const componentes = porItem.get(row.item_receta_id) ?? [];
    componentes.push({
      id: row.id,
      drogaNombre: row.droga_nombre,
      sinonimo: row.sinonimo,
      cantidad: row.cantidad,
      unidadMedidaSimbolo: row.unidad_medida_simbolo,
      modoExpresion: row.modo_expresion,
      esPrincipioActivo: row.es_principio_activo,
    });
    porItem.set(row.item_receta_id, componentes);
  }
  for (const [itemId, componentes] of porItem) porItem.set(itemId, ordenarComponentes(componentes));
  return porItem;
}

// ============================================================================
// En curso: recetas taken by the lab that still have ítems to confirm
// ============================================================================

export interface RecetaEnCursoFila {
  recetaId: string;
  recetaNumeroInterno: string;
  pacienteNombre: string;
  pacienteApellido: string;
  /** "Apellido, Nombre". */
  tomadaPorNombre: string;
  tomadaEn: Date;
  totalItems: number;
  itemsConfirmados: number;
}

export interface ListRecetasEnCursoFilter {
  tenantId: string;
  /** Nº interno de la receta (digits). */
  numeroInterno?: string;
  /** `YYYY-MM-DD` on `tomada_en`, as the tenant's calendar day (inclusive). */
  desde?: string;
  hasta?: string;
  page: number;
  pageSize: number;
}

/** One row of `listRecetasEnCursoSql`: every page column is NULL on the single row of an empty page. */
export interface ListRecetasEnCursoRow {
  total: number;
  zona_horaria: string;
  receta_id: string | null;
  receta_numero_interno: string | null;
  paciente_nombre: string | null;
  paciente_apellido: string | null;
  tomada_por_nombre: string | null;
  tomada_por_apellido: string | null;
  tomada_en: Date | null;
  total_items: number | null;
  items_confirmados: number | null;
}

/**
 * The /preparaciones "En curso" tab: recetas taken by the lab (migration
 * 0057) that are still PENDIENTE_PREPARACION or EN_PREPARACION and have at
 * least one ítem without a CONFIRMADA preparación (once every ítem is
 * confirmed the receta is PREPARADA anyway). The `tomada_por_id`/estado
 * predicates match the partial index idx_receta_tenant_tomada_en_curso.
 * Oldest toma first. Built separately for tests/db.
 */
export function listRecetasEnCursoSql(filter: ListRecetasEnCursoFilter): Prisma.Sql {
  const numero = filter.numeroInterno?.replace(/\D/g, "") || null;
  const desde = filter.desde ?? null;
  const hasta = filter.hasta ?? null;
  const skip = (filter.page - 1) * filter.pageSize;

  return Prisma.sql`
    WITH filtradas AS (
      SELECT
        r.id AS receta_id,
        r.numero_interno,
        r.tomada_en,
        pa.nombre AS paciente_nombre,
        pa.apellido AS paciente_apellido,
        u.nombre AS tomada_por_nombre,
        u.apellido AS tomada_por_apellido,
        avance.total_items,
        avance.items_confirmados
      FROM fsj.receta r
      JOIN fsj.tenant tn ON tn.id = r.tenant_id
      JOIN fsj.paciente pa ON pa.tenant_id = r.tenant_id AND pa.id = r.paciente_id
      JOIN fsj.usuario u ON u.tenant_id = r.tenant_id AND u.id = r.tomada_por_id
      CROSS JOIN LATERAL (
        SELECT
          count(*)::int AS total_items,
          (count(*) FILTER (
            WHERE EXISTS (
              SELECT 1 FROM fsj.preparacion p
              WHERE p.tenant_id = ir.tenant_id AND p.item_receta_id = ir.id AND p.estado = 'CONFIRMADA'
            )
          ))::int AS items_confirmados
        FROM fsj.item_receta ir
        WHERE ir.tenant_id = r.tenant_id AND ir.receta_id = r.id
      ) avance
      WHERE r.tenant_id = ${filter.tenantId}::uuid
        AND r.tomada_por_id IS NOT NULL
        AND r.estado IN ('PENDIENTE_PREPARACION', 'EN_PREPARACION')
        AND avance.items_confirmados < avance.total_items
        AND (${numero}::bigint IS NULL OR r.numero_interno = ${numero}::bigint)
        AND (${desde}::date IS NULL OR fsj.jornada_de(r.tomada_en, tn.zona_horaria) >= ${desde}::date)
        AND (${hasta}::date IS NULL OR fsj.jornada_de(r.tomada_en, tn.zona_horaria) <= ${hasta}::date)
    )
    SELECT
      t.total,
      t.zona_horaria,
      f.receta_id,
      f.numero_interno::text AS receta_numero_interno,
      f.paciente_nombre,
      f.paciente_apellido,
      f.tomada_por_nombre,
      f.tomada_por_apellido,
      f.tomada_en,
      f.total_items,
      f.items_confirmados
    FROM (
      SELECT
        (SELECT count(*)::int FROM filtradas) AS total,
        (SELECT zona_horaria FROM fsj.tenant WHERE id = ${filter.tenantId}::uuid) AS zona_horaria
    ) t
    LEFT JOIN LATERAL (
      SELECT *
      FROM filtradas
      ORDER BY tomada_en ASC, numero_interno ASC
      LIMIT ${filter.pageSize}::int OFFSET ${skip}::int
    ) f ON true
  `;
}

export async function listRecetasEnCurso(
  tx: Prisma.TransactionClient,
  filter: ListRecetasEnCursoFilter,
): Promise<{ items: RecetaEnCursoFila[]; total: number; zonaHoraria: string }> {
  const rows = await tx.$queryRaw<ListRecetasEnCursoRow[]>(listRecetasEnCursoSql(filter));
  if (!rows[0]) throw new Error(`listRecetasEnCurso: no row for tenant ${filter.tenantId}`);

  return {
    total: rows[0].total,
    zonaHoraria: rows[0].zona_horaria,
    items: rows
      .filter((row) => row.receta_id !== null)
      .map((row) => ({
        recetaId: row.receta_id!,
        recetaNumeroInterno: row.receta_numero_interno!,
        pacienteNombre: row.paciente_nombre!,
        pacienteApellido: row.paciente_apellido!,
        tomadaPorNombre: `${row.tomada_por_apellido!}, ${row.tomada_por_nombre!}`,
        tomadaEn: row.tomada_en!,
        totalItems: row.total_items!,
        itemsConfirmados: row.items_confirmados!,
      })),
  };
}

// ============================================================================
// Toma (migration 0057): who took a receta from the queue, and when
// ============================================================================

export interface TomaDeReceta {
  id: string;
  numeroInterno: string;
  estado: EstadoReceta;
  tomadaPorId: string | null;
  /** "Apellido, Nombre"; `null` when not taken. */
  tomadaPorNombre: string | null;
  tomadaEn: Date | null;
  zonaHoraria: string;
}

/** Fresh read of the receta's toma -- call AFTER `lockRecetaParaTransicion` (M3). */
export async function getTomaDeReceta(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<TomaDeReceta | null> {
  const receta = await tx.receta.findUnique({
    where: { id: recetaId, tenantId },
    select: { id: true, numeroInterno: true, estado: true, tomadaPorId: true, tomadaEn: true, tomadaPor: { select: { nombre: true, apellido: true } } },
  });
  if (!receta) return null;
  return {
    id: receta.id,
    numeroInterno: receta.numeroInterno.toString(),
    estado: receta.estado,
    tomadaPorId: receta.tomadaPorId,
    tomadaPorNombre: receta.tomadaPor ? `${receta.tomadaPor.apellido}, ${receta.tomadaPor.nombre}` : null,
    tomadaEn: receta.tomadaEn,
    zonaHoraria: await zonaHorariaTenant(tx, tenantId),
  };
}

/** Where each ítem of a receta stands, in detail-page order (ctid -- see `listItemsPendientesDeRecetasSql`). */
export interface AvanceDeItem {
  itemRecetaId: string;
  /** 1-based. */
  posicion: number;
  iniciada: boolean;
  confirmada: boolean;
}

export async function getAvanceItemsDeReceta(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<AvanceDeItem[]> {
  const rows = await tx.$queryRaw<{ item_receta_id: string; posicion: number; iniciada: boolean; confirmada: boolean }[]>`
    SELECT
      ir.id AS item_receta_id,
      row_number() OVER (ORDER BY ir.ctid)::int AS posicion,
      EXISTS (SELECT 1 FROM fsj.preparacion p WHERE p.tenant_id = ir.tenant_id AND p.item_receta_id = ir.id AND p.estado = 'INICIADA') AS iniciada,
      EXISTS (SELECT 1 FROM fsj.preparacion p WHERE p.tenant_id = ir.tenant_id AND p.item_receta_id = ir.id AND p.estado = 'CONFIRMADA') AS confirmada
    FROM fsj.item_receta ir
    WHERE ir.tenant_id = ${tenantId}::uuid AND ir.receta_id = ${recetaId}::uuid
    ORDER BY posicion
  `;
  return rows.map((r) => ({ itemRecetaId: r.item_receta_id, posicion: r.posicion, iniciada: r.iniciada, confirmada: r.confirmada }));
}

/** Records the toma: `tomada_por_id` + `tomada_en = now()` (the transaction's time). Returns the stored instant. */
export async function setTomaDeReceta(tx: Prisma.TransactionClient, tenantId: string, recetaId: string, usuarioId: string): Promise<Date> {
  const rows = await tx.$queryRaw<{ tomada_en: Date }[]>`
    UPDATE fsj.receta
    SET tomada_por_id = ${usuarioId}::uuid, tomada_en = now()
    WHERE id = ${recetaId}::uuid AND tenant_id = ${tenantId}::uuid
    RETURNING tomada_en
  `;
  if (!rows[0]) throw new Error(`setTomaDeReceta: no receta ${recetaId}`);
  return rows[0].tomada_en;
}

export async function clearTomaDeReceta(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE fsj.receta
    SET tomada_por_id = NULL, tomada_en = NULL
    WHERE id = ${recetaId}::uuid AND tenant_id = ${tenantId}::uuid
  `;
}

/** What `/preparaciones/[id]`'s "Volver" needs about the preparación's receta (domain/toma.ts#hrefVolverDePreparacion). */
export interface RecetaDePreparacion {
  recetaId: string;
  estado: EstadoReceta;
  tomada: boolean;
  /** Ítems without a CONFIRMADA preparación. */
  itemsSinConfirmar: number;
}

export async function getRecetaDePreparacion(tx: Prisma.TransactionClient, tenantId: string, itemRecetaId: string): Promise<RecetaDePreparacion | null> {
  const rows = await tx.$queryRaw<{ receta_id: string; estado: EstadoReceta; tomada: boolean; items_sin_confirmar: number }[]>`
    SELECT
      r.id AS receta_id,
      r.estado::text AS estado,
      (r.tomada_por_id IS NOT NULL) AS tomada,
      (
        SELECT count(*)::int
        FROM fsj.item_receta ir
        WHERE ir.tenant_id = r.tenant_id AND ir.receta_id = r.id
          AND NOT EXISTS (
            SELECT 1 FROM fsj.preparacion p
            WHERE p.tenant_id = ir.tenant_id AND p.item_receta_id = ir.id AND p.estado = 'CONFIRMADA'
          )
      ) AS items_sin_confirmar
    FROM fsj.item_receta i
    JOIN fsj.receta r ON r.tenant_id = i.tenant_id AND r.id = i.receta_id
    WHERE i.tenant_id = ${tenantId}::uuid AND i.id = ${itemRecetaId}::uuid
  `;
  const row = rows[0];
  return row ? { recetaId: row.receta_id, estado: row.estado, tomada: row.tomada, itemsSinConfirmar: row.items_sin_confirmar } : null;
}

// ============================================================================
// Toma workspace (/preparaciones/recetas/[recetaId]): the receta, each ítem's
// latest ficha técnica and its preparación
// ============================================================================

export interface LineaDeFichaToma {
  drogaId: string;
  drogaNombre: string;
  cantidadTeorica: string | null;
  excesoAplicado: string;
  cantidadAPesar: string | null;
  unidadSimbolo: string;
  esEnraseManual: boolean;
  orden: number;
}

export interface FichaDeItemToma {
  id: string;
  version: number;
  generadaEn: Date;
  generadaPorNombre: string;
  lineas: LineaDeFichaToma[];
}

export interface ItemDeToma {
  id: string;
  descripcion: string | null;
  formaFarmaceutica: string;
  cantidadUnidades: number;
  cantidadTotal: string | null;
  unidadTotalSimbolo: string | null;
  posologia: string | null;
  duracionTratamientoDias: number | null;
  componentes: ComponenteDePendiente[];
  /** Latest version; `null` when none was generated. */
  ultimaFicha: FichaDeItemToma | null;
  /** The ítem's CONFIRMADA (first) or INICIADA preparación, on any ficha version; `null` when none (or only DESCARTADA ones). */
  preparacion: { id: string; estado: "INICIADA" | "CONFIRMADA" } | null;
}

export interface RecetaDeToma {
  id: string;
  numeroInterno: string;
  estado: EstadoReceta;
  origen: string;
  fechaPrescripcion: Date;
  fechaIngreso: Date;
  diagnosticoCodigo: string | null;
  diagnosticoDescripcion: string | null;
  /** Migration 0070 -- the patient's home address as written on this receta. */
  domicilioPaciente: string | null;
  pacienteNombre: string;
  pacienteApellido: string;
  medicoNombre: string;
  medicoApellido: string;
  medicoMatricula: string;
  tomadaPorId: string | null;
  tomadaPorNombre: string | null;
  tomadaEn: Date | null;
  zonaHoraria: string;
  /** Same (unordered-by-column) read as the receta detail page, so "Ítem N" matches it. */
  items: ItemDeToma[];
}

export async function getRecetaDeToma(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<RecetaDeToma | null> {
  const receta = await tx.receta.findUnique({
    where: { id: recetaId, tenantId },
    select: {
      id: true,
      numeroInterno: true,
      estado: true,
      origen: true,
      fechaPrescripcion: true,
      fechaIngreso: true,
      diagnosticoCodigo: true,
      diagnosticoDescripcion: true,
      domicilioPaciente: true,
      tomadaPorId: true,
      tomadaEn: true,
      tomadaPor: { select: { nombre: true, apellido: true } },
      paciente: { select: { nombre: true, apellido: true } },
      medico: { select: { nombre: true, apellido: true, matricula: true } },
      items: {
        select: {
          id: true,
          descripcion: true,
          formaFarmaceutica: true,
          cantidadUnidades: true,
          cantidadTotal: true,
          unidadTotal: { select: { simbolo: true } },
          posologia: true,
          duracionTratamientoDias: true,
          componentes: {
            select: {
              id: true,
              cantidad: true,
              modoExpresion: true,
              esPrincipioActivo: true,
              droga: { select: { nombre: true } },
              drogaAlias: { select: { texto: true } },
              unidadMedida: { select: { simbolo: true } },
            },
          },
          fichas: {
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              version: true,
              generadaEn: true,
              generadaPor: { select: { nombre: true, apellido: true } },
              lineas: {
                orderBy: { orden: "asc" },
                select: {
                  drogaId: true,
                  drogaNombre: true,
                  cantidadTeorica: true,
                  excesoAplicado: true,
                  cantidadAPesar: true,
                  esEnraseManual: true,
                  orden: true,
                  unidadMedida: { select: { simbolo: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!receta) return null;

  const preparaciones = await tx.preparacion.findMany({
    where: { tenantId, itemRecetaId: { in: receta.items.map((i) => i.id) }, estado: { in: ["INICIADA", "CONFIRMADA"] } },
    select: { id: true, estado: true, itemRecetaId: true },
  });
  const preparacionDe = (itemId: string): ItemDeToma["preparacion"] => {
    const delItem = preparaciones.filter((p) => p.itemRecetaId === itemId);
    const elegida = delItem.find((p) => p.estado === "CONFIRMADA") ?? delItem.find((p) => p.estado === "INICIADA");
    return elegida ? { id: elegida.id, estado: elegida.estado === "CONFIRMADA" ? "CONFIRMADA" : "INICIADA" } : null;
  };

  return {
    id: receta.id,
    numeroInterno: receta.numeroInterno.toString(),
    estado: receta.estado,
    origen: receta.origen,
    fechaPrescripcion: receta.fechaPrescripcion,
    fechaIngreso: receta.fechaIngreso,
    diagnosticoCodigo: receta.diagnosticoCodigo,
    diagnosticoDescripcion: receta.diagnosticoDescripcion,
    domicilioPaciente: receta.domicilioPaciente,
    pacienteNombre: receta.paciente.nombre,
    pacienteApellido: receta.paciente.apellido,
    medicoNombre: receta.medico.nombre,
    medicoApellido: receta.medico.apellido,
    medicoMatricula: receta.medico.matricula,
    tomadaPorId: receta.tomadaPorId,
    tomadaPorNombre: receta.tomadaPor ? `${receta.tomadaPor.apellido}, ${receta.tomadaPor.nombre}` : null,
    tomadaEn: receta.tomadaEn,
    zonaHoraria: await zonaHorariaTenant(tx, tenantId),
    items: receta.items.map((item) => {
      const ficha = item.fichas[0];
      return {
        id: item.id,
        descripcion: item.descripcion,
        formaFarmaceutica: item.formaFarmaceutica,
        cantidadUnidades: item.cantidadUnidades,
        cantidadTotal: item.cantidadTotal ? item.cantidadTotal.toString() : null,
        unidadTotalSimbolo: item.unidadTotal?.simbolo ?? null,
        posologia: item.posologia,
        duracionTratamientoDias: item.duracionTratamientoDias,
        componentes: ordenarComponentes(
          item.componentes.map((c) => ({
            id: c.id,
            drogaNombre: c.droga.nombre,
            sinonimo: c.drogaAlias?.texto ?? null,
            cantidad: c.cantidad ? c.cantidad.toString() : null,
            unidadMedidaSimbolo: c.unidadMedida.simbolo,
            modoExpresion: c.modoExpresion,
            esPrincipioActivo: c.esPrincipioActivo,
          })),
        ),
        ultimaFicha: ficha
          ? {
              id: ficha.id,
              version: ficha.version,
              generadaEn: ficha.generadaEn,
              generadaPorNombre: `${ficha.generadaPor.apellido}, ${ficha.generadaPor.nombre}`,
              lineas: ficha.lineas.map((l) => ({
                drogaId: l.drogaId,
                drogaNombre: l.drogaNombre,
                cantidadTeorica: l.cantidadTeorica ? l.cantidadTeorica.toString() : null,
                excesoAplicado: l.excesoAplicado.toString(),
                cantidadAPesar: l.cantidadAPesar ? l.cantidadAPesar.toString() : null,
                unidadSimbolo: l.unidadMedida.simbolo,
                esEnraseManual: l.esEnraseManual,
                orden: l.orden,
              })),
            }
          : null,
        preparacion: preparacionDe(item.id),
      };
    }),
  };
}
