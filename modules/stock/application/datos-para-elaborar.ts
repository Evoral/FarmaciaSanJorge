/**
 * `stock.lote.datos-para-elaborar` (openspec/changes/lotes-elaborados): what the "Elaborar lote" form needs for a
 * produced droga -- its fórmula (if any), the eligible partidas of every droga involved (the produced one for a
 * dilución, the fórmula's components, plus `drogaIds` the user added, e.g. the excipiente of a dilución) in
 * consumption order (abiertas first, then FEFO), the suggested lote code and whether the contralor is active (EL6).
 * Read-only. Each partida's costo only with `stock.valorizado.ver`, like the partida listings.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { can } from "@/shared/auth/authorize";
import { NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { formulasDeDrogasEnTx, type FormulaLeida } from "@/modules/drogas/application/formula-de-droga";
import { ordenarParaConsumo } from "../domain/reparto";
import { codigoLoteElaborado, prefijoLoteElaborado, type TipoElaboracion } from "../domain/elaboracion-lote";
import { getFechaActivacionContralor, jornadaActualTenant } from "../infrastructure/partida-repository";
import {
  contarLotesConPrefijo,
  getDrogaProducida,
  listPartidasElegiblesParaElaborar,
  type DrogaProducida,
  type PartidaParaElaborar,
} from "../infrastructure/elaboracion-lote-repository";

const datosParaElaborarInput = z.object({
  drogaProducidaId: uuid,
  drogaIds: z.array(uuid).max(50).default([]),
});

export interface PartidaElegibleParaElaborar extends Omit<PartidaParaElaborar, "costoUnitario"> {
  /** `null` without `stock.valorizado.ver`. */
  costoUnitario: string | null;
}

export interface DatosParaElaborar {
  droga: DrogaProducida;
  formula: FormulaLeida | null;
  /** drogaId -> its eligible partidas, in consumption order. A droga without any is present with `[]`. */
  partidasPorDroga: Record<string, PartidaElegibleParaElaborar[]>;
  /** EL9: the code each tipo would get now. Shown only: the command assigns it at commit (another elaboration may take it first). */
  proximoLote: Record<TipoElaboracion, string>;
  jornada: string;
  contralorActivo: boolean;
}

export const datosParaElaborarQuery = defineQuery({
  name: "stock.lote.datos-para-elaborar",
  permiso: "stock.lote.elaborar",
  input: datosParaElaborarInput,
  handler: async ({ tx, session, input }): Promise<DatosParaElaborar> => {
    const tenantId = session.tenantId;
    const droga = await getDrogaProducida(tx, tenantId, input.drogaProducidaId);
    if (!droga) throw new NotFoundError("Droga no encontrada.");

    const formula = (await formulasDeDrogasEnTx(tx, tenantId, [droga.id])).get(droga.id) ?? null;
    const drogaIds = [...new Set([droga.id, ...(formula?.componentes.map((c) => c.drogaId) ?? []), ...input.drogaIds])];
    const jornada = await jornadaActualTenant(tx, tenantId);
    const conCosto = can(session, "stock.valorizado.ver");

    const partidas = await listPartidasElegiblesParaElaborar(tx, tenantId, drogaIds);
    const partidasPorDroga: Record<string, PartidaElegibleParaElaborar[]> = {};
    for (const drogaId of drogaIds) {
      partidasPorDroga[drogaId] = ordenarParaConsumo(
        partidas.filter((p) => p.drogaId === drogaId),
        jornada,
      ).map((p) => ({ ...p, costoUnitario: conCosto ? p.costoUnitario : null }));
    }

    return {
      droga,
      formula,
      partidasPorDroga,
      proximoLote: {
        DILUCION: codigoLoteElaborado("DILUCION", jornada, await contarLotesConPrefijo(tx, tenantId, prefijoLoteElaborado("DILUCION", jornada))),
        FORMULA: codigoLoteElaborado("FORMULA", jornada, await contarLotesConPrefijo(tx, tenantId, prefijoLoteElaborado("FORMULA", jornada))),
      },
      jornada,
      contralorActivo: (await getFechaActivacionContralor(tx, tenantId)) !== null,
    };
  },
});

export async function datosParaElaborar(input: { drogaProducidaId: string; drogaIds?: string[] }): Promise<DatosParaElaborar> {
  return datosParaElaborarQuery.execute(input);
}
