/**
 * Configurable red background for the preparado's etiqueta (`etiqueta_hoja.formas_fondo_rojo` and `tono_fondo_rojo`,
 * migration 0130). Two gates, like the sheet (./get-etiqueta-hoja.ts, ./get-hoja-para-imprimir.ts): the admin screen
 * reads it with `config.ver`; print workflows with `etiquetas.imprimir`.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { getFondoEtiqueta as getFondoEtiquetaRepo } from "../infrastructure/etiqueta-hoja-repository";
import type { FondoEtiquetaConfig } from "../domain/etiqueta-fondo";

export const getFondoEtiquetaQuery = defineQuery({
  name: "etiquetaHoja.fondo.ver",
  permiso: "config.ver",
  input: z.object({}).strict(),
  handler: async ({ tx, session }): Promise<FondoEtiquetaConfig> => getFondoEtiquetaRepo(tx, session.tenantId),
});

export const getFondoEtiquetaParaImprimirQuery = defineQuery({
  name: "etiquetaHoja.fondo.paraImprimir",
  permiso: "etiquetas.imprimir",
  input: z.object({}).strict(),
  handler: async ({ tx, session }): Promise<FondoEtiquetaConfig> => getFondoEtiquetaRepo(tx, session.tenantId),
});

export async function getFondoEtiqueta(): Promise<FondoEtiquetaConfig> {
  return getFondoEtiquetaQuery.execute({});
}

export async function getFondoEtiquetaParaImprimir(): Promise<FondoEtiquetaConfig> {
  return getFondoEtiquetaParaImprimirQuery.execute({});
}
