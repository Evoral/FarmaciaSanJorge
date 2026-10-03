/**
 * `listDrogasContralor` -- the drogas that appear in the contralor libros, for the `/libro/contralor` droga
 * autocomplete. Read-only, same `libro.ver` permiso as `listContralor`.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listDrogasContralor as listDrogasContralorRepo } from "../infrastructure/contralor-repository";
import type { DrogaContralorOpcion } from "../infrastructure/contralor-repository";

export type { DrogaContralorOpcion };

const LIMITE = 10;

const listDrogasContralorInput = z.object({
  search: z.string().trim().max(100).optional(),
});

export const listDrogasContralorQuery = defineQuery({
  name: "libro.contralor.drogas",
  permiso: "libro.ver",
  input: listDrogasContralorInput,
  handler: async ({ tx, session, input }): Promise<DrogaContralorOpcion[]> =>
    listDrogasContralorRepo(tx, session.tenantId, { search: input.search || undefined, limite: LIMITE }),
});

export async function listDrogasContralor(input: z.input<typeof listDrogasContralorInput>): Promise<DrogaContralorOpcion[]> {
  return listDrogasContralorQuery.execute(input);
}
