/**
 * `getCierreDetalle` -- FASE 10, M13a point 10.1 (detail page `/cierres/[id]`
 * -- comprobante data + print button). Gated on `cierres.ver`.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { getCierreDetalle as getCierreDetalleDb } from "../infrastructure/cierre-repository";
import type { CierreDetalle } from "../infrastructure/cierre-repository";

const getCierreDetalleInput = z.object({ id: uuid });

export const getCierreDetalleQuery = defineQuery({
  name: "cierres.detalle",
  permiso: "cierres.ver",
  input: getCierreDetalleInput,
  handler: async ({ tx, session, input }): Promise<CierreDetalle> => {
    const cierre = await getCierreDetalleDb(tx, session.tenantId, input.id);
    if (!cierre) throw new NotFoundError("El cierre no fue encontrado.");
    return cierre;
  },
});

export async function getCierreDetalle(id: string): Promise<CierreDetalle> {
  return getCierreDetalleQuery.execute({ id });
}
