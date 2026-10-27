/**
 * `listOperadores` (openspec/specs/cuentas-de-sector/spec.md): the empleados a cuenta
 * de sector offers when an acción asks "¿quién sos?" -- name only, never
 * anything about the PIN beyond the fact that one is configured.
 *
 * `permiso: "auth.login"` is the same deliberate reuse as `reautenticar` /
 * `pinDisponible` (modules/auth): it is part of proving who you are, and
 * every role holds it. An individual session gets an empty list: it never
 * shows the selector, and who has a PIN is nobody else's business.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listOperadores as listOperadoresRepo, type OperadorOpcion } from "../infrastructure/operadores-repository";

export type { OperadorOpcion };

export const listOperadoresQuery = defineQuery({
  name: "operadores.listar",
  permiso: "auth.login",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<OperadorOpcion[]> => (session.sector ? listOperadoresRepo(tx, session.tenantId) : []),
});

export async function listOperadores(): Promise<OperadorOpcion[]> {
  return listOperadoresQuery.execute({});
}
