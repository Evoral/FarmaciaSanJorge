/** `listNumeracionLibros` -- first number and fixed/changeable state of each open libro, for `/libro/numeracion` (migration 0097). */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listNumeracionLibros as listNumeracionLibrosRepo, type NumeracionLibroRow } from "../infrastructure/numeracion-repository";

export type NumeracionLibroItem = NumeracionLibroRow;

export const listNumeracionLibrosQuery = defineQuery({
  name: "libro.numeracion.listar",
  permiso: "libro.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<NumeracionLibroItem[]> => listNumeracionLibrosRepo(tx, session.tenantId),
});

export async function listNumeracionLibros(): Promise<NumeracionLibroItem[]> {
  return listNumeracionLibrosQuery.execute({});
}
