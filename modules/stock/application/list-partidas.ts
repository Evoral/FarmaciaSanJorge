/**
 * `listPartidas` (`/partidas`, docs/specs/historial-partidas.md).
 * Read-only, `stock.ver`. Every partida of the tenant across all drogas
 * (insumos included), agotadas included by default -- it is a history.
 * Filters (droga, proveedor, lote, fecha de ingreso range, solo con saldo,
 * solo vencidas) combine with AND; newest ingreso first. Plus the jornada and
 * the alert window, so each partida shows its expiry estado on its
 * vencimiento VIGENTE (same as `listPartidasDroga`).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { esFechaIso } from "../domain/ajustes-listado";
import { getDiasAlertaVencimiento, jornadaActualTenant, listPartidasHistorial } from "../infrastructure/partida-repository";
import type { ListPartidasHistorialResult } from "../infrastructure/partida-repository";

const fechaIso = z.string().refine(esFechaIso, { message: "Ingresá una fecha válida." });

const listPartidasInput = z
  .object({
    drogaId: uuid.optional(),
    proveedorId: uuid.optional(),
    lote: z.string().trim().max(100).optional(),
    desde: fechaIso.optional(),
    hasta: fechaIso.optional(),
    soloConSaldo: z.boolean().optional(),
    soloVencidas: z.boolean().optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
  })
  .refine((input) => !input.desde || !input.hasta || input.desde <= input.hasta, {
    message: "La fecha \"Desde\" no puede ser posterior a la fecha \"Hasta\".",
    path: ["desde"],
  });

export type ListPartidasInput = z.input<typeof listPartidasInput>;

export interface ListPartidasResultado extends ListPartidasHistorialResult {
  /** YYYY-MM-DD. */
  jornadaActual: string;
  diasAlertaVencimiento: number;
}

export const listPartidasQuery = defineQuery({
  name: "stock.partidas.historial",
  permiso: "stock.ver",
  input: listPartidasInput,
  handler: async ({ tx, session, input }): Promise<ListPartidasResultado> => {
    const result = await listPartidasHistorial(tx, {
      tenantId: session.tenantId,
      drogaId: input.drogaId,
      proveedorId: input.proveedorId,
      lote: input.lote || undefined,
      desde: input.desde,
      hasta: input.hasta,
      soloConSaldo: input.soloConSaldo,
      soloVencidas: input.soloVencidas,
      page: input.page,
      pageSize: input.pageSize,
    });
    return {
      ...result,
      jornadaActual: await jornadaActualTenant(tx, session.tenantId),
      diasAlertaVencimiento: await getDiasAlertaVencimiento(tx, session.tenantId),
    };
  },
});

export async function listPartidas(input: ListPartidasInput): Promise<ListPartidasResultado> {
  return listPartidasQuery.execute(input);
}
