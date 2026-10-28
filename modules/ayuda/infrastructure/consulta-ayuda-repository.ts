/**
 * Prisma-backed access to `fsj.consulta_ayuda` (migration 0109).
 *
 * Tenant-scoped: every function runs inside an ALREADY OPEN tenant transaction
 * (`tx`, handed in by `shared/usecase.ts`), so RLS already restricts every
 * statement to the session's tenant; `tenantId` is still passed on writes
 * and used as defense-in-depth on updates.
 *
 * CA13 / CA14:
 * - Insert on each chat turn (or failure).
 * - Column-level update on `util` for the user's own row.
 * - No read, list, or delete functions exist (owner reviews via SQL).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { ResultadoConsulta } from "../domain/consulta-ayuda";

export type DatosInsertarConsultaAyuda = {
  readonly tenantId: string;
  readonly usuarioId: string;
  readonly conversacionId: string;
  readonly pregunta: string;
  readonly respuesta: string | null;
  readonly entradaId: string | null;
  readonly resultado: ResultadoConsulta;
};

export async function insertarConsultaAyuda(
  tx: Prisma.TransactionClient,
  datos: DatosInsertarConsultaAyuda
): Promise<{ id: string }> {
  return tx.consultaAyuda.create({
    data: {
      tenantId: datos.tenantId,
      usuarioId: datos.usuarioId,
      conversacionId: datos.conversacionId,
      pregunta: datos.pregunta,
      respuesta: datos.respuesta,
      entradaId: datos.entradaId,
      resultado: datos.resultado,
    },
    select: {
      id: true,
    },
  });
}

export type ParametrosCalificarConsultaAyuda = {
  readonly id: string;
  readonly usuarioId: string;
  readonly util: boolean;
  readonly tenantId: string;
};

export async function calificarConsultaAyuda(
  tx: Prisma.TransactionClient,
  { id, usuarioId, util, tenantId }: ParametrosCalificarConsultaAyuda
): Promise<boolean> {
  const { count } = await tx.consultaAyuda.updateMany({
    where: {
      id,
      usuarioId,
      tenantId,
    },
    data: {
      util,
    },
  });
  return count === 1;
}
