/**
 * Prisma-backed access to `fsj.asiento_historico` for FASE 9 (M12 point
 * 9.5, DP-17). Outside the correlativo/hash chain/cierres -- no
 * `numero_correlativo`, no `hash_integridad`, no stock effects (migration
 * 0014's header). Immutable once created (no UPDATE/DELETE grant).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { TipoLibro } from "@/generated/prisma/enums";
import type { ListHistoricoFiltro } from "../domain/filtros";

export interface InsertHistoricoInput {
  tenantId: string;
  tipoLibro: TipoLibro;
  numeroAsientoFisico: string;
  fechaAsiento: string; // YYYY-MM-DD
  pacienteTexto?: string;
  medicoTexto?: string;
  formulaTexto: string;
  observaciones?: string;
  digitalizadoPorId: string;
}

export async function insertAsientoHistorico(tx: Prisma.TransactionClient, input: InsertHistoricoInput): Promise<{ id: string }> {
  return tx.asientoHistorico.create({
    data: {
      tenantId: input.tenantId,
      tipoLibro: input.tipoLibro,
      numeroAsientoFisico: input.numeroAsientoFisico,
      fechaAsiento: new Date(input.fechaAsiento),
      pacienteTexto: input.pacienteTexto,
      medicoTexto: input.medicoTexto,
      formulaTexto: input.formulaTexto,
      observaciones: input.observaciones,
      digitalizadoPorId: input.digitalizadoPorId,
    },
    select: { id: true },
  });
}

export interface HistoricoListItem {
  id: string;
  tipoLibro: TipoLibro;
  numeroAsientoFisico: string;
  fechaAsiento: string;
  pacienteTexto: string | null;
  medicoTexto: string | null;
  formulaTexto: string;
  observaciones: string | null;
  digitalizadoPorNombre: string;
  digitalizadoEn: Date;
}

export interface HistoricoListResult {
  items: HistoricoListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listAsientosHistoricos(tx: Prisma.TransactionClient, tenantId: string, filtro: ListHistoricoFiltro): Promise<HistoricoListResult> {
  const where: Prisma.AsientoHistoricoWhereInput = { tenantId, tipoLibro: filtro.tipoLibro };
  const select = {
    id: true,
    tipoLibro: true,
    numeroAsientoFisico: true,
    fechaAsiento: true,
    pacienteTexto: true,
    medicoTexto: true,
    formulaTexto: true,
    observaciones: true,
    digitalizadoEn: true,
    digitalizadoPor: { select: { nombre: true, apellido: true } },
  } satisfies Prisma.AsientoHistoricoSelect;

  const [rows, total] = await Promise.all([
    tx.asientoHistorico.findMany({ where, select, orderBy: { fechaAsiento: "desc" }, skip: (filtro.page - 1) * filtro.pageSize, take: filtro.pageSize }),
    tx.asientoHistorico.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      tipoLibro: r.tipoLibro,
      numeroAsientoFisico: r.numeroAsientoFisico,
      fechaAsiento: r.fechaAsiento.toISOString().slice(0, 10),
      pacienteTexto: r.pacienteTexto,
      medicoTexto: r.medicoTexto,
      formulaTexto: r.formulaTexto,
      observaciones: r.observaciones,
      digitalizadoPorNombre: `${r.digitalizadoPor.apellido}, ${r.digitalizadoPor.nombre}`,
      digitalizadoEn: r.digitalizadoEn,
    })),
    total,
    page: filtro.page,
    pageSize: filtro.pageSize,
  };
}
