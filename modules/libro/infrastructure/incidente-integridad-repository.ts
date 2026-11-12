/**
 * Integrity incidents of the libros (`fsj.libro_incidente_integridad`, migration 0129, openspec/specs/libro-recetario-y-contralor/spec.md
 * "Incidente de integridad"). Raw SQL: the whole state machine lives in `fsj.libro_incidente_registrar`
 * (SECURITY INVOKER, so RLS and the grants of the app role stay in force).
 */
import type { Prisma } from "@/generated/prisma/client";

export type TransicionIncidente = "ABIERTO" | "REPETIDO" | "CERRADO" | "SIN_CAMBIO";

export interface ResultadoRegistroIncidente {
  transicion: TransicionIncidente;
  /** The incident touched (null only for SIN_CAMBIO). */
  incidenteId: string | null;
}

/** Applies one libro verification result: `quiebre` is the first broken asiento number, or null when the chain is intact. */
export async function registrarVerificacionLibro(tx: Prisma.TransactionClient, libroId: string, quiebre: string | null): Promise<ResultadoRegistroIncidente> {
  const rows = await tx.$queryRaw<{ transicion: TransicionIncidente; incidenteId: string | null }[]>`
    SELECT transicion, incidente_id::text AS "incidenteId"
    FROM fsj.libro_incidente_registrar(${libroId}::uuid, ${quiebre}::bigint)
  `;
  const fila = rows[0];
  if (!fila) throw new Error("registrarVerificacionLibro: no row returned");
  return fila;
}
