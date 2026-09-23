/**
 * Prisma-backed access to `fsj.asiento_recetario` / `fsj.detalle_asiento` /
 * `fsj.anulacion_asiento` / `fsj.libro_rubricado` for FASE 9 (M12 points
 * 9.1/9.2/9.3). Every function runs inside an ALREADY OPEN tenant
 * transaction (`tx`), same convention as every other module's repository.
 *
 * NEVER resolves paciente/médico/fórmula by FK -- every read below returns
 * the frozen `*_texto` snapshot columns (INV-L05), exactly as the plan's
 * M12 "NO HACER" list requires.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EstadoAsiento, OrigenAsiento } from "@/generated/prisma/enums";
import type { ListAsientosRecetarioFiltro, ExportarLibroFiltro } from "../domain/filtros";

/** Trigger-assigned columns (libroId/fechaAsiento/numeroCorrelativo/hash*) -- overwritten by fsj.asiento_recetario_preparar before the row is ever visible. Same convention as modules/preparaciones/infrastructure/preparacion-repository.ts. */
const PLACEHOLDER_UUID = "00000000-0000-0000-0000-000000000000";
const PLACEHOLDER_DATE = new Date(0);

export interface AnulacionResumen {
  motivo: string;
  anuladoPorNombre: string;
  autorizadoPorNombre: string;
  anuladoEn: Date;
}

export interface AsientoListItem {
  id: string;
  numeroCorrelativo: string;
  fechaAsiento: string; // YYYY-MM-DD
  origen: OrigenAsiento;
  estado: EstadoAsiento;
  pacienteTexto: string;
  medicoTexto: string;
  formulaTexto: string;
  cierreFirmado: boolean;
  anulacion: AnulacionResumen | null;
  rectificativoNumeroCorrelativo: string | null;
  asientoOriginalNumeroCorrelativo: string | null;
}

export interface AsientoListResult {
  items: AsientoListItem[];
  total: number;
  page: number;
  pageSize: number;
}

function nombreCompleto(u: { nombre: string; apellido: string }): string {
  return `${u.apellido}, ${u.nombre}`;
}

function whereDeFiltro(tenantId: string, filtro: Pick<ListAsientosRecetarioFiltro, "fechaDesde" | "fechaHasta" | "numeroDesde" | "numeroHasta" | "estado" | "texto">): Prisma.AsientoRecetarioWhereInput {
  return {
    tenantId,
    fechaAsiento: filtro.fechaDesde || filtro.fechaHasta ? { gte: filtro.fechaDesde ? new Date(filtro.fechaDesde) : undefined, lte: filtro.fechaHasta ? new Date(filtro.fechaHasta) : undefined } : undefined,
    numeroCorrelativo: filtro.numeroDesde !== undefined || filtro.numeroHasta !== undefined ? { gte: filtro.numeroDesde, lte: filtro.numeroHasta } : undefined,
    estado: filtro.estado,
    OR: filtro.texto
      ? [
          { pacienteTexto: { contains: filtro.texto, mode: "insensitive" } },
          { medicoTexto: { contains: filtro.texto, mode: "insensitive" } },
        ]
      : undefined,
  };
}

const LIST_SELECT = {
  id: true,
  numeroCorrelativo: true,
  fechaAsiento: true,
  origen: true,
  estado: true,
  pacienteTexto: true,
  medicoTexto: true,
  formulaTexto: true,
  cierreDiarioId: true,
  anulacion: { select: { motivo: true, anuladoEn: true, anuladoPor: { select: { nombre: true, apellido: true } }, autorizadoPor: { select: { nombre: true, apellido: true } } } },
  rectificativos: { select: { numeroCorrelativo: true }, take: 1 },
  asientoOriginal: { select: { numeroCorrelativo: true } },
} satisfies Prisma.AsientoRecetarioSelect;

type AsientoRow = Prisma.AsientoRecetarioGetPayload<{ select: typeof LIST_SELECT }>;

function toListItem(row: AsientoRow): AsientoListItem {
  return {
    id: row.id,
    numeroCorrelativo: row.numeroCorrelativo.toString(),
    fechaAsiento: row.fechaAsiento.toISOString().slice(0, 10),
    origen: row.origen,
    estado: row.estado,
    pacienteTexto: row.pacienteTexto,
    medicoTexto: row.medicoTexto,
    formulaTexto: row.formulaTexto,
    cierreFirmado: row.cierreDiarioId !== null,
    anulacion: row.anulacion
      ? {
          motivo: row.anulacion.motivo,
          anuladoEn: row.anulacion.anuladoEn,
          anuladoPorNombre: nombreCompleto(row.anulacion.anuladoPor),
          autorizadoPorNombre: nombreCompleto(row.anulacion.autorizadoPor),
        }
      : null,
    rectificativoNumeroCorrelativo: row.rectificativos[0] ? row.rectificativos[0].numeroCorrelativo.toString() : null,
    asientoOriginalNumeroCorrelativo: row.asientoOriginal ? row.asientoOriginal.numeroCorrelativo.toString() : null,
  };
}

export async function listAsientosRecetario(tx: Prisma.TransactionClient, tenantId: string, filtro: ListAsientosRecetarioFiltro): Promise<AsientoListResult> {
  const where = whereDeFiltro(tenantId, filtro);
  const [rows, total] = await Promise.all([
    tx.asientoRecetario.findMany({
      where,
      select: LIST_SELECT,
      orderBy: { numeroCorrelativo: "asc" },
      skip: (filtro.page - 1) * filtro.pageSize,
      take: filtro.pageSize,
    }),
    tx.asientoRecetario.count({ where }),
  ]);
  return { items: rows.map(toListItem), total, page: filtro.page, pageSize: filtro.pageSize };
}

/** Walks EVERY page matching `filtro` (no pagination), in ascending correlativo order -- used by CSV/PDF export. Caller enforces the row cap. */
export async function* iterarAsientosParaExportar(tx: Prisma.TransactionClient, tenantId: string, filtro: ExportarLibroFiltro, pageSize: number): AsyncGenerator<AsientoListItem[]> {
  const where = whereDeFiltro(tenantId, filtro);
  let skip = 0;
  for (;;) {
    const rows = await tx.asientoRecetario.findMany({ where, select: LIST_SELECT, orderBy: { numeroCorrelativo: "asc" }, skip, take: pageSize });
    if (rows.length === 0) return;
    yield rows.map(toListItem);
    if (rows.length < pageSize) return;
    skip += pageSize;
  }
}

export interface DetalleAsientoItem {
  descripcion: string;
  cantidad: string;
  unidadTexto: string;
  orden: number;
}

/** D1 (2026-09-23): present only when `origen === "RECTIFICATIVO"` -- the authorization `fsj.rectificacion_asiento` recorded for THIS asiento (not the original's own anulación/rectificativo summary, which `AsientoListItem` already carries). */
export interface RectificacionResumen {
  motivo: string;
  autorizadoPorNombre: string;
}

export interface AsientoDetalle extends AsientoListItem {
  detalles: DetalleAsientoItem[];
  rectificacion: RectificacionResumen | null;
  /** D2 REVISED (per-item rule, 2026-09-23): which item_receta this asiento belongs to (SISTEMA: its own preparacion; RECTIFICATIVO: the ORIGINAL's preparacion, since a rectificativo has no preparacionId of its own). `descripcion`/`formaFarmaceutica` are plain business fields already shown on the receta detail page -- NOT the frozen legal `*_texto` snapshots (INV-L05 only governs those). `null` when the chain cannot be resolved (should not happen for a well-formed SISTEMA/RECTIFICATIVO asiento). */
  itemLabel: string | null;
}

const DETAIL_SELECT = {
  ...LIST_SELECT,
  preparacion: { select: { itemRecetaId: true } },
  asientoOriginal: { select: { numeroCorrelativo: true, preparacion: { select: { itemRecetaId: true } } } },
  detalles: { select: { descripcion: true, cantidad: true, unidadTexto: true, orden: true }, orderBy: { orden: "asc" } },
  rectificacion: { select: { motivo: true, autorizadoPor: { select: { nombre: true, apellido: true } } } },
} satisfies Prisma.AsientoRecetarioSelect;

export async function getAsientoRecetario(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<AsientoDetalle | null> {
  const row = await tx.asientoRecetario.findUnique({ where: { id, tenantId }, select: DETAIL_SELECT });
  if (!row) return null;

  // D2 REVISED: resolve the item this asiento belongs to -- own preparacion
  // (SISTEMA) or, lacking one, the ORIGINAL asiento's preparacion
  // (RECTIFICATIVO). One extra single-row lookup, cheap, and NOT a legal
  // `*_texto` FK resolution (see AsientoDetalle's doc comment).
  const itemRecetaId = row.preparacion?.itemRecetaId ?? row.asientoOriginal?.preparacion?.itemRecetaId ?? null;
  const item = itemRecetaId
    ? await tx.itemReceta.findUnique({ where: { id: itemRecetaId, tenantId }, select: { descripcion: true, formaFarmaceutica: true } })
    : null;
  const itemLabel = item ? item.descripcion ?? item.formaFarmaceutica : null;

  return {
    ...toListItem(row),
    itemLabel,
    detalles: row.detalles.map((d) => ({ descripcion: d.descripcion, cantidad: d.cantidad.toString(), unidadTexto: d.unidadTexto, orden: d.orden })),
    rectificacion: row.rectificacion ? { motivo: row.rectificacion.motivo, autorizadoPorNombre: nombreCompleto(row.rectificacion.autorizadoPor) } : null,
  };
}

/**
 * Serializes concurrent anulación/rectificación attempts on the SAME
 * asiento (M3 discipline) via a transaction-scoped advisory lock, keyed on
 * `'asiento_recetario:' || tenantId || ':' || id` -- NOT a `SELECT ...
 * FOR UPDATE` row lock. Postgres requires the UPDATE privilege (on at
 * least one column) to take `FOR UPDATE`/`FOR NO KEY UPDATE`/`FOR
 * SHARE`/`FOR KEY SHARE` on a row, even though the lock itself performs no
 * write -- and migration 0014 REVOKEs UPDATE on `fsj.asiento_recetario`
 * from `fsj_app` entirely (INV-X01), so a `FOR UPDATE` SELECT here fails at
 * runtime with `42501 permission denied` for BOTH anular and rectificar.
 * `pg_advisory_xact_lock` needs no table privilege at all (it is a
 * session-level Postgres primitive, not a row lock), and is released
 * automatically at COMMIT/ROLLBACK exactly like a row lock would be.
 *
 * This lock only serializes two concurrent app-level attempts against the
 * SAME asiento; it grants no write access and proves nothing about the
 * DB's own invariants. The real backstops against a race remain: the
 * UNIQUE constraints (`anulacion_asiento_asiento_unico`,
 * `uq_asiento_recetario_rectificativo_unico`) and the trigger re-checks
 * (`trg_anulacion_asiento_validar` / INV-L02, INV-L19) that fire
 * regardless of what this function did or didn't lock.
 *
 * Returns `false` when no row matches (existence checked via a plain
 * `SELECT`, which needs only the SELECT privilege `fsj_app` already has).
 */
export async function lockAsientoParaAnular(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('asiento_recetario:' || ${tenantId} || ':' || ${id}, 0))`;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.asiento_recetario WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
  `;
  return rows.length === 1;
}

export interface AsientoParaAnular {
  id: string;
  estado: EstadoAsiento;
  cierreDiarioId: string | null;
  numeroCorrelativo: string;
  /** D2 (2026-09-23): the receta reached from here is anulled alongside the asiento -- see receta-coupling-repository.ts. */
  preparacionId: string | null;
}

/** Fresh read AFTER `lockAsientoParaAnular` -- M3 discipline (never decide from a pre-lock snapshot). */
export async function getAsientoParaAnular(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<AsientoParaAnular | null> {
  const row = await tx.asientoRecetario.findUnique({ where: { id, tenantId }, select: { id: true, estado: true, cierreDiarioId: true, numeroCorrelativo: true, preparacionId: true } });
  if (!row) return null;
  return { id: row.id, estado: row.estado, cierreDiarioId: row.cierreDiarioId, numeroCorrelativo: row.numeroCorrelativo.toString(), preparacionId: row.preparacionId };
}

export interface InsertAnulacionInput {
  tenantId: string;
  asientoId: string;
  motivo: string;
  autorizadoPorId: string;
  anuladoPorId: string;
}

/** INSERT `anulacion_asiento` -- the AFTER INSERT trigger (migration 0014) flips the asiento to ANULADO (INV-L09); the BEFORE INSERT trigger re-validates INV-L02/INV-U05 regardless of the app's own pre-checks (defense in depth). */
export async function insertAnulacionAsiento(tx: Prisma.TransactionClient, input: InsertAnulacionInput): Promise<{ id: string }> {
  return tx.anulacionAsiento.create({
    data: {
      tenantId: input.tenantId,
      asientoId: input.asientoId,
      motivo: input.motivo,
      autorizadoPorId: input.autorizadoPorId,
      anuladoPorId: input.anuladoPorId,
    },
    select: { id: true },
  });
}

export interface LibroAbierto {
  id: string;
  tipo: "RECETARIO" | "PSICOTROPICO" | "ESTUPEFACIENTE";
}

/** The tenant's currently OPEN libro_rubricado rows (at most one per tipo -- migration 0014's partial unique index) -- feeds `verificar-cadena-libros.ts`. */
export async function listLibrosAbiertos(tx: Prisma.TransactionClient, tenantId: string): Promise<LibroAbierto[]> {
  const rows = await tx.libroRubricado.findMany({ where: { tenantId, fechaCierre: null }, select: { id: true, tipo: true }, orderBy: { tipo: "asc" } });
  return rows.map((r) => ({ id: r.id, tipo: r.tipo }));
}

/** `fsj.verificar_cadena(tenant, libro)` -- first broken `numero_correlativo`, or `null` if the chain is intact (migration 0018 B2). */
export async function verificarCadenaLibro(tx: Prisma.TransactionClient, tenantId: string, libroId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ quiebre: string | null }[]>`
    SELECT fsj.verificar_cadena(${tenantId}::uuid, ${libroId}::uuid)::text AS quiebre
  `;
  return rows[0]?.quiebre ?? null;
}

// ============================================================================
// D1 (2026-09-23): rectificarAsiento -- asiento rectificativo for a SISTEMA
// asiento whose jornada is already SIGNED (INV-L18/L21).
// ============================================================================

export interface AsientoParaRectificar {
  id: string;
  origen: OrigenAsiento;
  estado: EstadoAsiento;
  cierreDiarioId: string | null;
  numeroCorrelativo: string;
  preparacionId: string | null;
  pacienteTexto: string;
  medicoTexto: string;
  formulaTexto: string;
  /** INV-L19: true when this asiento already has a rectificativo (friendly pre-check -- the DB's own partial unique index is the real backstop). */
  tieneRectificativo: boolean;
}

/** Fresh read AFTER `lockAsientoParaAnular` (the SAME lock helper is reused for rectificar -- it just takes the advisory lock, independent of which correction path the caller intends). */
export async function getAsientoParaRectificar(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<AsientoParaRectificar | null> {
  const row = await tx.asientoRecetario.findUnique({
    where: { id, tenantId },
    select: {
      id: true,
      origen: true,
      estado: true,
      cierreDiarioId: true,
      numeroCorrelativo: true,
      preparacionId: true,
      pacienteTexto: true,
      medicoTexto: true,
      formulaTexto: true,
      rectificativos: { select: { id: true }, take: 1 },
    },
  });
  if (!row) return null;
  const { rectificativos, ...rest } = row;
  return { ...rest, numeroCorrelativo: row.numeroCorrelativo.toString(), tieneRectificativo: rectificativos.length > 0 };
}

export interface InsertRectificativoInput {
  tenantId: string;
  asientoOriginalId: string;
  pacienteTexto: string;
  medicoTexto: string;
  formulaTexto: string;
  registradoPorId: string;
}

/**
 * INSERT `asiento_recetario` (origen RECTIFICATIVO) -- D3: no detalle
 * lines, only a snapshot copied from the original (see rectificar-asiento.ts).
 * libroId/fechaAsiento/numeroCorrelativo/hash* are all trigger-assigned;
 * `id` is left to the column default (unlike SISTEMA inserts, a
 * rectificativo has no detalle rows that need to reference it in advance
 * -- migration 0034 header).
 */
export async function insertAsientoRectificativo(tx: Prisma.TransactionClient, input: InsertRectificativoInput): Promise<{ id: string; numeroCorrelativo: string }> {
  const asiento = await tx.asientoRecetario.create({
    data: {
      tenantId: input.tenantId,
      libroId: PLACEHOLDER_UUID,
      numeroCorrelativo: BigInt(0),
      fechaAsiento: PLACEHOLDER_DATE,
      origen: "RECTIFICATIVO",
      asientoOriginalId: input.asientoOriginalId,
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

export interface InsertRectificacionInput {
  tenantId: string;
  asientoRectificativoId: string;
  motivo: string;
  /** The co-firma-verified DT id `verificarCoFirmaDtLibro` returned -- see rectificar-asiento.ts's doc comment, same contract as `insertAnulacionAsiento`. */
  autorizadoPorId: string;
  registradoPorId: string;
}

/** INSERT `rectificacion_asiento` (migration 0033) -- the authorization record INV-L21 requires for the RECTIFICATIVO row `insertAsientoRectificativo` just inserted, in the SAME transaction. */
export async function insertRectificacionAsiento(tx: Prisma.TransactionClient, input: InsertRectificacionInput): Promise<{ id: string }> {
  return tx.rectificacionAsiento.create({
    data: {
      tenantId: input.tenantId,
      asientoRectificativoId: input.asientoRectificativoId,
      motivo: input.motivo,
      autorizadoPorId: input.autorizadoPorId,
      registradoPorId: input.registradoPorId,
    },
    select: { id: true },
  });
}
