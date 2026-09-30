/**
 * `getReceta` (M09, FASE 6 points 6.1/6.3/6.6). Read-only, gated on
 * `recetas.crear` -- no dedicated `recetas.ver` in plan §7's matrix, and
 * every recetas.* permiso the write side needs (crear/editar/fisica) shares
 * the SAME role set (ATP/FAR/DT); reusing the broadest one for reads is the
 * same precedent as modules/drogas/application/list-drogas.ts (reusing
 * `drogas.editar`) and modules/pacientes/medicos (reusing `.gestionar`).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { listAsientosEnEfectoDeReceta } from "@/modules/libro/application/asientos-en-efecto";
import type { AsientoEnEfecto } from "@/modules/libro/application/asientos-en-efecto";
import { getRecetaConItems, itemsConPreparacionIniciada } from "../infrastructure/receta-repository";
import type { RecetaDetalle } from "../infrastructure/receta-repository";

/** The detail plus what decides whether it may be anulled directly (domain/anulacion.ts). */
export interface RecetaDetalleVista extends RecetaDetalle {
  asientosEnEfecto: AsientoEnEfecto[];
  itemsConPreparacionIniciada: string[];
}

export type { RecetaDetalle };

const getRecetaInput = z.object({ id: uuid });

export const getRecetaQuery = defineQuery({
  name: "recetas.ver",
  permiso: "recetas.crear",
  input: getRecetaInput,
  handler: async ({ tx, session, input }): Promise<RecetaDetalleVista | null> => {
    const receta = await getRecetaConItems(tx, session.tenantId, input.id);
    if (!receta) return null;
    return {
      ...receta,
      asientosEnEfecto: await listAsientosEnEfectoDeReceta(tx, session.tenantId, receta.id),
      itemsConPreparacionIniciada: await itemsConPreparacionIniciada(tx, session.tenantId, receta.id),
    };
  },
});

export async function getReceta(id: string): Promise<RecetaDetalleVista | null> {
  return getRecetaQuery.execute({ id });
}
