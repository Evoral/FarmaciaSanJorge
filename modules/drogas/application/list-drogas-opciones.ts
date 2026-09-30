/**
 * `listDrogasOpciones` -- every vigente droga (id + nombre + unidad base id
 * and tipo_magnitud) for a `<select>`
 * picker, e.g. `/stock/ingresar`. A picker must offer the WHOLE vigente
 * catalog, so it can't reuse the paginated `listDrogas` (its `pageSize` is
 * capped at 100, and silently truncating the options would hide drogas);
 * it also skips `listDrogas`' per-droga stock join, which a picker never
 * shows. Unbounded on purpose: a pharmacy's droga catalog is low hundreds
 * of rows at most (same scale assumption as droga-repository.ts#listDrogas).
 * Same `drogas.editar` read permiso as `list-drogas.ts` /
 * `list-unidades-vigentes.ts` (plan §7 has no `drogas.ver`).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listDrogasOpciones as listDrogasOpcionesRepo } from "../infrastructure/droga-repository";
import type { DrogaOpcion } from "../infrastructure/droga-repository";

export type { DrogaOpcion };

export const listDrogasOpcionesQuery = defineQuery({
  name: "drogas.opciones",
  permiso: "drogas.editar",
  input: z.object({}),
  handler: async ({ tx, session }) => listDrogasOpcionesRepo(tx, session.tenantId),
});

export async function listDrogasOpciones(): Promise<DrogaOpcion[]> {
  return listDrogasOpcionesQuery.execute({});
}
