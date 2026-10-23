/**
 * Whether the tenant's contralor digital is activo, for the droga form: with
 * it, a controlled droga's alta (or an edit that makes it controlled) asks for
 * the saldo de apertura of the manual libro (docs/specs/existencia-inicial.md
 * R12). Same permiso as the unidades the form loads with it.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { contralorActivoEnTx } from "@/modules/libro/application/registrar-apertura-contralor";

export const contralorActivoParaDrogaQuery = defineQuery({
  name: "drogas.contralor-activo",
  permiso: "drogas.editar",
  input: z.object({}),
  handler: async ({ tx, session }) => contralorActivoEnTx(tx, session.tenantId),
});

export async function contralorActivoParaDroga(): Promise<boolean> {
  return contralorActivoParaDrogaQuery.execute({});
}
