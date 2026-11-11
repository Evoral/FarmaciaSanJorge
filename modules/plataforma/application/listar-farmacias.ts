/**
 * `/plataforma` list (openspec/specs/plataforma/spec.md P8): paginated, searchable, with estado, saldo and the count of
 * open integrity incidents (one lookup for the whole page, same transaction).
 */
import { z } from "zod";
import { definePlataforma } from "./define-plataforma";
import { INCIDENTES_LISTA_LIMITE, PAGINA_FARMACIAS, type FarmaciaListada } from "../domain/farmacia";
import { incidentesIntegridad, listarFarmacias as listarFarmaciasDb } from "../infrastructure/plataforma-repository";

const input = z.object({
  busqueda: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  pagina: z.number().int().min(1).default(1),
});

export const listarFarmaciasQuery = definePlataforma({
  name: "plataforma.farmacias.listar",
  input,
  handler: async ({ tx, actor, input }): Promise<{ items: FarmaciaListada[]; total: number }> => {
    const pagina = await listarFarmaciasDb(tx, actor.tokenHash, { busqueda: input.busqueda, limit: PAGINA_FARMACIAS, offset: (input.pagina - 1) * PAGINA_FARMACIAS });
    if (pagina.items.length === 0) return { total: pagina.total, items: [] };

    const abiertos = await incidentesIntegridad(tx, actor.tokenHash, pagina.items.map((f) => f.id), true, INCIDENTES_LISTA_LIMITE);
    const porFarmacia = new Map<string, number>();
    for (const incidente of abiertos) porFarmacia.set(incidente.tenantId, (porFarmacia.get(incidente.tenantId) ?? 0) + 1);
    return { total: pagina.total, items: pagina.items.map((f) => ({ ...f, incidentesAbiertos: porFarmacia.get(f.id) ?? 0 })) };
  },
});

export function listarFarmacias(raw: { busqueda?: string | null; pagina?: number }) {
  return listarFarmaciasQuery.execute(raw);
}
