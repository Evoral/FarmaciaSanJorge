/**
 * Synonyms for the droga pickers of this module's screens
 * (docs/specs/sinonimos-droga.md): the pickers filter their options
 * client-side, so they receive each droga's vigente synonyms as extra
 * search keywords. One query per screen, each behind that screen's own
 * permiso (a synonym is catalog data, nothing more sensitive than the droga
 * names those screens already show).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { readSinonimosDrogas } from "../infrastructure/sinonimos-drogas-repository";

/** droga id -> vigente synonyms. */
export type SinonimosPorDroga = Record<string, string[]>;

export const sinonimosDrogasComparadorQuery = defineQuery({
  name: "proveedores.comparar-costos.sinonimos",
  permiso: "stock.valorizado.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<SinonimosPorDroga> => readSinonimosDrogas(tx, session.tenantId),
});

export const sinonimosDrogasTrayectoriaQuery = defineQuery({
  name: "proveedores.trayectoria.sinonimos",
  permiso: "proveedores.gestionar",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<SinonimosPorDroga> => readSinonimosDrogas(tx, session.tenantId),
});

export async function listSinonimosDrogasComparador(): Promise<SinonimosPorDroga> {
  return sinonimosDrogasComparadorQuery.execute({});
}

export async function listSinonimosDrogasTrayectoria(): Promise<SinonimosPorDroga> {
  return sinonimosDrogasTrayectoriaQuery.execute({});
}
