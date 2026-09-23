/**
 * `getPreparacionParaPantalla` (M11, FASE 8 point 8.2). Read-only,
 * `preparaciones.iniciar` (see list-preparaciones.ts's doc comment for why
 * this module has no dedicated read permiso). For every non-manual línea,
 * computes the system's OWN proposal via `proponerReparto`
 * (modules/stock/domain/reparto.ts, reused verbatim -- NOT reimplemented)
 * so the farmacéutico sees exactly what the confirmation would draw from
 * by default; the amounts shown here are NEVER editable (INV-S13/S20) --
 * only WHICH partidas to draw from can be changed (INV-S15), which
 * `confirmarPreparacion` recomputes server-side regardless of what this
 * query shows.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { dec } from "@/shared/decimal";
import { proponerReparto } from "@/modules/stock/domain/reparto";
import type { PropuestaLinea } from "@/modules/stock/domain/reparto";
import {
  getPreparacionParaAccion,
  getLineasParaPreparacion,
  listPartidasElegiblesDroga,
  jornadaActualTenant,
} from "../infrastructure/preparacion-repository";
import type { LineaParaPantalla, PartidaElegible } from "../infrastructure/preparacion-repository";

const getPreparacionParaPantallaInput = z.object({ preparacionId: uuid });

export interface LineaPantalla extends LineaParaPantalla {
  partidasElegibles: PartidaElegible[];
  /** The system's own default split, `null` for manual-enrase lines (no fixed quantity to split yet) or when stock is insufficient. */
  propuesta: PropuestaLinea[] | null;
  stockInsuficiente: boolean;
  faltante: string | null;
}

export interface PreparacionParaPantalla {
  id: string;
  estado: string;
  fichaTecnicaId: string;
  jornadaActual: string;
  lineas: LineaPantalla[];
}

export const getPreparacionParaPantallaQuery = defineQuery({
  name: "preparaciones.pantalla",
  permiso: "preparaciones.iniciar",
  input: getPreparacionParaPantallaInput,
  handler: async ({ tx, session, input }): Promise<PreparacionParaPantalla> => {
    const preparacion = await getPreparacionParaAccion(tx, session.tenantId, input.preparacionId);
    if (!preparacion) throw new NotFoundError("Preparación no encontrada.");

    const jornada = await jornadaActualTenant(tx, session.tenantId);
    const lineasDb = await getLineasParaPreparacion(tx, session.tenantId, preparacion.fichaTecnicaId);

    const lineas: LineaPantalla[] = [];
    for (const linea of lineasDb) {
      const partidasElegibles = await listPartidasElegiblesDroga(tx, session.tenantId, linea.drogaId);

      if (linea.esEnraseManual || !linea.cantidadAPesar) {
        lineas.push({ ...linea, partidasElegibles, propuesta: null, stockInsuficiente: false, faltante: null });
        continue;
      }

      const resultado = proponerReparto(
        partidasElegibles.map((p) => ({ id: p.id, cantidadDisponible: p.cantidadDisponible, fechaVencimiento: p.fechaVencimiento, fechaApertura: p.fechaApertura })),
        dec(linea.cantidadAPesar),
        jornada,
      );

      if (resultado.ok) {
        lineas.push({ ...linea, partidasElegibles, propuesta: resultado.lineas as PropuestaLinea[], stockInsuficiente: false, faltante: null });
      } else {
        lineas.push({ ...linea, partidasElegibles, propuesta: null, stockInsuficiente: true, faltante: resultado.faltante.toString() });
      }
    }

    return { id: preparacion.id, estado: preparacion.estado, fichaTecnicaId: preparacion.fichaTecnicaId, jornadaActual: jornada, lineas };
  },
});

export async function getPreparacionParaPantalla(preparacionId: string): Promise<PreparacionParaPantalla> {
  return getPreparacionParaPantallaQuery.execute({ preparacionId });
}
