/**
 * Whether the tenant's contralor digital is activo, for the droga form: with
 * it, a controlled droga's alta (or an edit that makes it controlled) asks for
 * the saldo de apertura of the manual libro (openspec/specs/existencia-inicial/spec.md
 * R12). One query per form, each with that form's permiso.
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

/** The alta's twin of `contralorActivoParaDroga`: a role may hold `drogas.crear` without `drogas.editar`. */
export const contralorActivoParaAltaDrogaQuery = defineQuery({
  name: "drogas.contralor-activo.alta",
  permiso: "drogas.crear",
  input: z.object({}),
  handler: async ({ tx, session }) => contralorActivoEnTx(tx, session.tenantId),
});

export async function contralorActivoParaAltaDroga(): Promise<boolean> {
  return contralorActivoParaAltaDrogaQuery.execute({});
}
