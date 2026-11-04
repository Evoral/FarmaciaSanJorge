/**
 * Where the toma's "Incluir excipientes en la etiqueta" switch starts (`etiqueta_hoja.incluir_excipientes`, migration
 * 0117). Two gates, like the sheet (./get-etiqueta-hoja.ts, ./get-hoja-para-imprimir.ts): the admin screen reads it with
 * `config.ver`; the toma, whose "Imprimir etiquetas" generates the etiquetas, with `etiquetas.generar`.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { getIncluirExcipientes as getIncluirExcipientesRepo } from "../infrastructure/etiqueta-hoja-repository";

export const getIncluirExcipientesQuery = defineQuery({
  name: "etiquetaHoja.incluirExcipientes.ver",
  permiso: "config.ver",
  input: z.object({}).strict(),
  handler: async ({ tx, session }): Promise<boolean> => getIncluirExcipientesRepo(tx, session.tenantId),
});

export const getIncluirExcipientesParaGenerarQuery = defineQuery({
  name: "etiquetaHoja.incluirExcipientes.paraGenerar",
  permiso: "etiquetas.generar",
  input: z.object({}).strict(),
  handler: async ({ tx, session }): Promise<boolean> => getIncluirExcipientesRepo(tx, session.tenantId),
});

export async function getIncluirExcipientes(): Promise<boolean> {
  return getIncluirExcipientesQuery.execute({});
}

export async function getIncluirExcipientesParaGenerar(): Promise<boolean> {
  return getIncluirExcipientesParaGenerarQuery.execute({});
}
