/**
 * `listPartidas` (`/partidas`, openspec/specs/historial-partidas/spec.md).
 * Read-only, `stock.ver`. Every partida of the tenant across all drogas
 * (insumos included), agotadas included by default -- it is a history.
 * Filters (droga, proveedor, lote, fecha de ingreso range, solo con saldo,
 * solo vencidas) combine with AND; newest ingreso first. Plus the jornada and
 * the alert window, so each partida shows its expiry estado on its
 * vencimiento VIGENTE (same as `listPartidasDroga`).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { fechaIso, uuid } from "@/shared/validation";
import { getDiasAlertaVencimiento, getStockDeDroga, jornadaActualTenant, listPartidasHistorial } from "../infrastructure/partida-repository";
import type { ListPartidasHistorialResult, StockDeDroga } from "../infrastructure/partida-repository";
import { tiposElaboracionDePartidas } from "../infrastructure/elaboracion-lote-repository";
import type { TipoElaboracion } from "@/generated/prisma/enums";

const listPartidasInput = z
  .object({
    drogaId: uuid.optional(),
    proveedorId: uuid.optional(),
    lote: z.string().trim().max(100).optional(),
    desde: fechaIso.optional(),
    hasta: fechaIso.optional(),
    soloConSaldo: z.boolean().optional(),
    soloVencidas: z.boolean().optional(),
    soloElaboradas: z.boolean().optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
  })
  .refine((input) => !input.desde || !input.hasta || input.desde <= input.hasta, {
    message: "La fecha \"Desde\" no puede ser posterior a la fecha \"Hasta\".",
    path: ["desde"],
  });

export type ListPartidasInput = z.input<typeof listPartidasInput>;

export interface ListPartidasResultado extends ListPartidasHistorialResult {
  /** partidaId -> DILUCION / FORMULA, for the page's elaborated lots (migration 0111). */
  tiposElaboracion: Record<string, TipoElaboracion>;
  /** YYYY-MM-DD. */
  jornadaActual: string;
  diasAlertaVencimiento: number;
  /** Filtered by one droga: its exact stock (físico and activo), unrounded; `null` otherwise. */
  stockDroga: StockDeDroga | null;
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
      soloElaboradas: input.soloElaboradas,
      page: input.page,
      pageSize: input.pageSize,
    });
    return {
      ...result,
      tiposElaboracion: Object.fromEntries(await tiposElaboracionDePartidas(tx, session.tenantId, result.items.map((p) => p.id))),
      jornadaActual: await jornadaActualTenant(tx, session.tenantId),
      diasAlertaVencimiento: await getDiasAlertaVencimiento(tx, session.tenantId),
      stockDroga: input.drogaId ? await getStockDeDroga(tx, session.tenantId, input.drogaId) : null,
    };
  },
});

export async function listPartidas(input: ListPartidasInput): Promise<ListPartidasResultado> {
  return listPartidasQuery.execute(input);
}
