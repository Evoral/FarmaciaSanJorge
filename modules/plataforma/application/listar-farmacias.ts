/** `/plataforma` list (openspec/specs/plataforma/spec.md P8): paginated, searchable, with estado and saldo. */
import { z } from "zod";
import { definePlataforma } from "./define-plataforma";
import { PAGINA_FARMACIAS } from "../domain/farmacia";
import { listarFarmacias as listarFarmaciasDb } from "../infrastructure/plataforma-repository";

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
  handler: ({ tx, actor, input }) =>
    listarFarmaciasDb(tx, actor.tokenHash, { busqueda: input.busqueda, limit: PAGINA_FARMACIAS, offset: (input.pagina - 1) * PAGINA_FARMACIAS }),
});

export function listarFarmacias(raw: { busqueda?: string | null; pagina?: number }) {
  return listarFarmaciasQuery.execute(raw);
}
