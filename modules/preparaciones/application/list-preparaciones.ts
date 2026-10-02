/**
 * `listPreparaciones` (M11): the /preparaciones Confirmadas and Descartadas
 * tabs, one per estado (modules/preparaciones/domain/listado.ts; the En
 * curso tab lists taken recetas instead -- list-recetas-en-curso.ts, and
 * INICIADA preparaciones are reached from there). FAR/DT: reuses
 * `preparaciones.iniciar` (plan §7 has no dedicated read permiso for this
 * module -- both roles that may act on a preparación are exactly the roles
 * that hold `preparaciones.iniciar`; inventing a new `preparaciones.ver`
 * permiso code would need a migration inserting into `fsj.permiso`'s seed).
 *
 * Filters are applied in the query (server-side): receta number, start
 * date range (the tenant's calendar days), and -- Confirmadas only --
 * "sin etiqueta impresa". The page of rows carries each one's etiqueta
 * state from the same query.
 * No paciente filter (DP-24: no personal data in URLs).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listPreparaciones as listPreparacionesRepo } from "../infrastructure/preparacion-repository";
import type { PreparacionListItem } from "../infrastructure/preparacion-repository";

export type { PreparacionListItem };

const ESTADOS = ["CONFIRMADA", "DESCARTADA"] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Debe ser una fecha en formato AAAA-MM-DD.");

const listPreparacionesInput = z.object({
  estado: z.enum(ESTADOS).optional(),
  numeroInterno: z.string().trim().regex(/^\d{1,18}$/, "Debe ser un número de receta.").optional(),
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  sinEtiquetaImpresa: z.boolean().default(false),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

export type ListPreparacionesInput = z.input<typeof listPreparacionesInput>;

export interface ListPreparacionesOutput {
  items: PreparacionListItem[];
  total: number;
  page: number;
  pageSize: number;
  /** For "Iniciada"/"Confirmada" (timestamps) as the farmacia's local time. */
  zonaHoraria: string;
}

export const listPreparacionesQuery = defineQuery({
  name: "preparaciones.listar",
  permiso: "preparaciones.iniciar",
  input: listPreparacionesInput,
  handler: async ({ tx, session, input }): Promise<ListPreparacionesOutput> => {
    const filtro = {
      tenantId: session.tenantId,
      numeroInterno: input.numeroInterno,
      desde: input.desde,
      hasta: input.hasta,
      sinEtiquetaImpresa: input.sinEtiquetaImpresa,
    };
    const { items, total, zonaHoraria } = await listPreparacionesRepo(tx, { ...filtro, estado: input.estado, page: input.page, pageSize: input.pageSize });
    return { items, total, page: input.page, pageSize: input.pageSize, zonaHoraria };
  },
});

export async function listPreparaciones(input: ListPreparacionesInput = {}): Promise<ListPreparacionesOutput> {
  return listPreparacionesQuery.execute(input);
}
