/**
 * `editarFondoEtiqueta`: configurable red background for the preparado's etiqueta (migration 0130).
 * ADMINISTRADOR only (`config.editar`), audited like the sheet: `fsj.etiqueta_hoja` has no
 * surrogate id, so the audit row's `entidadId` is the tenant.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { getFondoEtiqueta, lockEtiquetaHoja, upsertFondoEtiqueta } from "../infrastructure/etiqueta-hoja-repository";
import { TONOS_FONDO_ROJO_KEYS, type FondoEtiquetaConfig } from "../domain/etiqueta-fondo";
import { FORMAS_FARMACEUTICAS } from "@/modules/recetas/domain/receta";

export const editarFondoEtiquetaInput = z
  .object({
    // A forma checked twice is stored once.
    formasFondoRojo: z.array(z.enum(FORMAS_FARMACEUTICAS)).transform((formas) => [...new Set(formas)]),
    tonoFondoRojo: z.enum(TONOS_FONDO_ROJO_KEYS),
  })
  .strict();

export interface EditarFondoEtiquetaInput {
  formasFondoRojo: string[];
  tonoFondoRojo: string;
}

export const editarFondoEtiquetaCommand = defineCommand({
  name: "etiquetaHoja.fondo.editar",
  permiso: "config.editar",
  input: editarFondoEtiquetaInput,
  audit: { entidad: "etiqueta_hoja", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    await lockEtiquetaHoja(tx, session.tenantId);
    const actual = await getFondoEtiqueta(tx, session.tenantId);
    const config: FondoEtiquetaConfig = {
      formasFondoRojo: input.formasFondoRojo,
      tonoFondoRojo: input.tonoFondoRojo,
    };
    await upsertFondoEtiqueta(tx, session.tenantId, config);
    return {
      output: config,
      audit: {
        entidadId: session.tenantId,
        valorAnterior: { formasFondoRojo: actual.formasFondoRojo, tonoFondoRojo: actual.tonoFondoRojo },
        valorNuevo: { formasFondoRojo: config.formasFondoRojo, tonoFondoRojo: config.tonoFondoRojo },
      },
    };
  },
});

export async function editarFondoEtiqueta(input: EditarFondoEtiquetaInput): Promise<FondoEtiquetaConfig> {
  return editarFondoEtiquetaCommand.execute(input);
}
