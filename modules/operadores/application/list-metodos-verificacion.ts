/**
 * `listMetodosVerificacion` (openspec/specs/cuentas-de-sector/spec.md): the optional verification methods and whether
 * this farmacia has each one on, for `/admin/configuracion/pin`. `config.ver`, like `listAccionesConPin`. Empty while no
 * optional method exists, which is what hides the section.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { describirMetodosConfigurables, type MetodoConfigurable } from "../domain/metodos-verificacion";
import { getMetodosHabilitados } from "../infrastructure/operadores-repository";

export const listMetodosVerificacionQuery = defineQuery({
  name: "operadores.metodosVerificacion.listar",
  permiso: "config.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<MetodoConfigurable[]> => describirMetodosConfigurables(await getMetodosHabilitados(tx, session.tenantId)),
});

export async function listMetodosVerificacion(): Promise<MetodoConfigurable[]> {
  return listMetodosVerificacionQuery.execute({});
}
