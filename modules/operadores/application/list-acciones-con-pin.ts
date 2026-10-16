/**
 * `listAccionesConPin` (docs/specs/cuentas-de-sector.md): the configurable
 * acciones and whether this farmacia asks an empleado's PIN for each, for
 * `/admin/configuracion/pin`. `config.ver`, like the rest of "Configuración".
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import type { AccionConPin } from "../domain/acciones-con-pin";
import { listAccionesConPin as listAccionesConPinRepo } from "../infrastructure/operadores-repository";

export const listAccionesConPinQuery = defineQuery({
  name: "operadores.accionesConPin.listar",
  permiso: "config.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<AccionConPin[]> => listAccionesConPinRepo(tx, session.tenantId),
});

export async function listAccionesConPin(): Promise<AccionConPin[]> {
  return listAccionesConPinQuery.execute({});
}
