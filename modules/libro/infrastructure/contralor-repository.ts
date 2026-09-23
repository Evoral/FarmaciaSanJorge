/**
 * Prisma-backed access to `fsj.asiento_contralor` for FASE 9 (M12 point
 * 9.4, DP-33). Consulta-only -- there is no anulación/rectificativo path
 * for contralor rows (INV-L20), so this file only ever reads.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { TipoMovimientoContralor } from "@/generated/prisma/enums";
import type { ListContralorFiltro } from "../domain/filtros";

export interface ContralorListItem {
  id: string;
  numeroCorrelativo: string;
  fechaAsiento: string; // YYYY-MM-DD
  tipoMovimiento: TipoMovimientoContralor;
  drogaDescripcion: string;
  cantidad: string;
  unidadSimbolo: string;
  saldoAnterior: string;
  saldoPosterior: string;
  numeroValeAdquisicion: string | null;
  asientoRecetarioId: string | null;
  asientoRecetarioNumero: string | null;
}

export interface ContralorListResult {
  items: ContralorListItem[];
  total: number;
  page: number;
  pageSize: number;
}

function whereDeFiltro(tenantId: string, libroId: string | undefined, filtro: Pick<ListContralorFiltro, "drogaId" | "fechaDesde" | "fechaHasta">): Prisma.AsientoContralorWhereInput {
  return {
    tenantId,
    libroId,
    drogaId: filtro.drogaId,
    fechaAsiento: filtro.fechaDesde || filtro.fechaHasta ? { gte: filtro.fechaDesde ? new Date(filtro.fechaDesde) : undefined, lte: filtro.fechaHasta ? new Date(filtro.fechaHasta) : undefined } : undefined,
  };
}

const SELECT = {
  id: true,
  numeroCorrelativo: true,
  fechaAsiento: true,
  tipoMovimiento: true,
  drogaDescripcion: true,
  cantidad: true,
  saldoAnterior: true,
  saldoPosterior: true,
  numeroValeAdquisicion: true,
  unidadMedida: { select: { simbolo: true } },
  asientoRecetario: { select: { id: true, numeroCorrelativo: true } },
} satisfies Prisma.AsientoContralorSelect;

type Row = Prisma.AsientoContralorGetPayload<{ select: typeof SELECT }>;

function toItem(row: Row): ContralorListItem {
  return {
    id: row.id,
    numeroCorrelativo: row.numeroCorrelativo.toString(),
    fechaAsiento: row.fechaAsiento.toISOString().slice(0, 10),
    tipoMovimiento: row.tipoMovimiento,
    drogaDescripcion: row.drogaDescripcion,
    cantidad: row.cantidad.toString(),
    unidadSimbolo: row.unidadMedida.simbolo,
    saldoAnterior: row.saldoAnterior.toString(),
    saldoPosterior: row.saldoPosterior.toString(),
    numeroValeAdquisicion: row.numeroValeAdquisicion,
    asientoRecetarioId: row.asientoRecetario?.id ?? null,
    asientoRecetarioNumero: row.asientoRecetario?.numeroCorrelativo.toString() ?? null,
  };
}

/** Resolves the OPEN libro_rubricado id for `tipoLibro` (PSICOTROPICO/ESTUPEFACIENTE), or `null` if none is open (should not happen -- migration 0014 creates all three at tenant creation). */
export async function getLibroContralorId(tx: Prisma.TransactionClient, tenantId: string, tipoLibro: "PSICOTROPICO" | "ESTUPEFACIENTE"): Promise<string | null> {
  const row = await tx.libroRubricado.findFirst({ where: { tenantId, tipo: tipoLibro, fechaCierre: null }, select: { id: true } });
  return row?.id ?? null;
}

export async function listAsientosContralor(tx: Prisma.TransactionClient, tenantId: string, filtro: ListContralorFiltro): Promise<ContralorListResult> {
  const libroId = filtro.tipoLibro ? (await getLibroContralorId(tx, tenantId, filtro.tipoLibro)) ?? undefined : undefined;
  // A tipoLibro filter with no open libro (should not happen) must return
  // zero rows, never "no filter" -- an impossible libroId does that.
  const where = whereDeFiltro(tenantId, filtro.tipoLibro ? libroId ?? "00000000-0000-0000-0000-000000000000" : undefined, filtro);
  const [rows, total] = await Promise.all([
    tx.asientoContralor.findMany({ where, select: SELECT, orderBy: { numeroCorrelativo: "asc" }, skip: (filtro.page - 1) * filtro.pageSize, take: filtro.pageSize }),
    tx.asientoContralor.count({ where }),
  ]);
  return { items: rows.map(toItem), total, page: filtro.page, pageSize: filtro.pageSize };
}

/** `tenant.fecha_activacion_contralor` -- `null` means both contralor libros are kept by hand (spec §4). Own small copy per module (module boundary: cannot import modules/preparaciones/infrastructure). */
export async function getFechaActivacionContralor(tx: Prisma.TransactionClient, tenantId: string): Promise<Date | null> {
  const row = await tx.tenant.findUnique({ where: { id: tenantId }, select: { fechaActivacionContralor: true } });
  return row?.fechaActivacionContralor ?? null;
}
