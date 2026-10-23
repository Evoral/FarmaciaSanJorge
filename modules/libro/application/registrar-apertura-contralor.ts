/**
 * APERTURA of a controlled droga given alta (or turned controlled) with the
 * contralor digital activo (docs/specs/existencia-inicial.md R12, INV-L15).
 * In-transaction helpers for the drogas use cases: they run inside the
 * caller's `defineCommand` transaction, so the droga and its APERTURA commit
 * together. The saldo is the manual libro's (0 if the pharmacy never had the
 * droga); `fsj.asiento_contralor_preparar` numbers it in the libro of the
 * droga's `tipo_control`.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { record as auditRecord } from "@/shared/audit";
import { TipoAccion } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { TIPO_LIBRO_LABELS } from "@/shared/labels/enum-labels";
import { getFechaActivacionContralor, getLibroContralorId, insertAperturaContralor, tieneAperturaContralor } from "../infrastructure/contralor-repository";

export async function contralorActivoEnTx(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
  return (await getFechaActivacionContralor(tx, tenantId)) !== null;
}

/**
 * The droga needs an APERTURA before its first movement: the contralor is activo and the open libro of
 * `tipoControl` has none for it yet (a droga turned controlled, back and forth, may already have one).
 */
export async function requiereAperturaContralorEnTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string | null,
  tipoControl: "NINGUNO" | "PSICOTROPICO" | "ESTUPEFACIENTE",
): Promise<boolean> {
  if (tipoControl === "NINGUNO" || !(await contralorActivoEnTx(tx, tenantId))) return false;
  return drogaId === null || !(await tieneAperturaContralor(tx, tenantId, drogaId, tipoControl));
}

export async function registrarAperturaContralorEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  input: { drogaId: string; drogaNombre: string; tipoControl: "PSICOTROPICO" | "ESTUPEFACIENTE"; saldo: string; unidadMedidaId: string },
): Promise<void> {
  if (!(await getLibroContralorId(tx, session.tenantId, input.tipoControl))) {
    throw new DomainError(`No hay un libro de ${TIPO_LIBRO_LABELS[input.tipoControl].toLowerCase()} abierto donde registrar la apertura de ${input.drogaNombre}.`);
  }
  const asiento = await insertAperturaContralor(tx, {
    tenantId: session.tenantId,
    drogaId: input.drogaId,
    drogaDescripcion: input.drogaNombre,
    saldo: input.saldo,
    unidadMedidaId: input.unidadMedidaId,
    registradoPorId: session.usuario.id,
  });
  await auditRecord(tx, {
    tenantId: session.tenantId,
    usuarioId: session.usuario.id,
    entidad: "asiento_contralor",
    entidadId: asiento.id,
    accion: TipoAccion.CREAR,
    valorNuevo: {
      tipoMovimiento: "APERTURA",
      numeroCorrelativo: asiento.numeroCorrelativo.toString(),
      drogaId: input.drogaId,
      droga: input.drogaNombre,
      saldo: input.saldo,
    },
  });
}
