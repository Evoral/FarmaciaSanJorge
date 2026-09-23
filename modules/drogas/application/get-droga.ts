/** `getDroga` (M06, FASE 4 point 4.2): single-row read for `/catalogos/drogas/[id]`. */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { getDrogaParaAccion, tieneAlgunaPartida } from "../infrastructure/droga-repository";
import type { DrogaParaAccion } from "../infrastructure/droga-repository";

const getDrogaInput = z.object({ id: uuid });

export interface DrogaDetalle extends DrogaParaAccion {
  /** DP-12 (task's conservative rule): the UI disables unidadBaseId/esControlada/tipoControl when true -- see modules/drogas/application/editar-droga.ts for the enforced version of this check. */
  tienePartidas: boolean;
}

export const getDrogaQuery = defineQuery({
  name: "drogas.ver",
  permiso: "drogas.editar",
  input: getDrogaInput,
  handler: async ({ tx, session, input }): Promise<DrogaDetalle | null> => {
    const droga = await getDrogaParaAccion(tx, session.tenantId, input.id);
    if (!droga) return null;
    const tienePartidas = await tieneAlgunaPartida(tx, session.tenantId, input.id);
    return { ...droga, tienePartidas };
  },
});

export async function getDroga(id: string): Promise<DrogaDetalle | null> {
  return getDrogaQuery.execute({ id });
}
