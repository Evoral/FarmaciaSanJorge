/**
 * `imprimirCierrePdf` -- FASE 10, M13a point 10.2 (PDF del comprobante).
 * `app/api/cierres/[id]/pdf/route.ts` is the ONLY entry point (eslint's
 * `appBoundaryPatterns` forbids `app/**` from importing this module's
 * `infrastructure/` layer directly, same discipline as
 * `modules/libro/application/exportar-libro.ts#exportarLibroPdf`).
 *
 * User decision 5 (2026-09-24): the FIRST print sets
 * `fecha_impresion`/`impreso_por_id` (column-grant UPDATE, only while still
 * NULL -- the DB's own C04 trigger freezes it once set regardless); EVERY
 * print (first or a reprint) is audited via `TipoAccion.IMPRIMIR_CIERRE`
 * (already seeded in the enum, migration 0015-era schema).
 */
import { z } from "zod";
import { defineQuery, defineCommand, TipoAccion } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { getCierreDetalle as getCierreDetalleDb, getTenantDatosComprobante, marcarCierreImpreso } from "../infrastructure/cierre-repository";
import type { CierreDetalle, TenantDatosComprobante } from "../infrastructure/cierre-repository";
import { buildCierrePdf } from "../infrastructure/cierre-pdf";

const getCierreParaImprimirInput = z.object({ id: uuid });

interface CierreParaImprimir {
  cierre: CierreDetalle;
  tenant: TenantDatosComprobante;
}

/** Own `defineQuery` (permiso `cierres.imprimir`, not `cierres.ver`) -- gates the PDF path on the SPECIFIC permiso the task assigns to printing, same "own copy per read path" discipline as `modules/libro/application/exportar-libro.ts#exportarLibroQuery` vs its list query. */
const getCierreParaImprimirQuery = defineQuery({
  name: "cierres.imprimir.detalle",
  permiso: "cierres.imprimir",
  input: getCierreParaImprimirInput,
  handler: async ({ tx, session, input }): Promise<CierreParaImprimir> => {
    const [cierre, tenant] = await Promise.all([getCierreDetalleDb(tx, session.tenantId, input.id), getTenantDatosComprobante(tx, session.tenantId)]);
    if (!cierre) throw new NotFoundError("El cierre no fue encontrado.");
    return { cierre, tenant };
  },
});

const marcarImpresionInput = z.object({ id: uuid });

const marcarImpresionCommand = defineCommand({
  name: "cierres.imprimir.marcar",
  permiso: "cierres.imprimir",
  input: marcarImpresionInput,
  audit: { entidad: "cierre_diario", accion: TipoAccion.IMPRIMIR_CIERRE },
  handler: async ({ tx, session, input }) => {
    const primeraImpresion = await marcarCierreImpreso(tx, session.tenantId, input.id, session.usuario.id);
    return {
      output: { primeraImpresion },
      audit: {
        entidadId: input.id,
        motivo: primeraImpresion ? "Primera impresión del comprobante de cierre." : "Reimpresión del comprobante de cierre.",
        valorNuevo: { primeraImpresion },
      },
    };
  },
});

export async function imprimirCierrePdf(id: string): Promise<Buffer> {
  const { cierre, tenant } = await getCierreParaImprimirQuery.execute({ id });
  await marcarImpresionCommand.execute({ id });
  return buildCierrePdf(cierre, tenant);
}
