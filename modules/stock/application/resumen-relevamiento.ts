import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { getEstadoRelevamientoInicial } from "../infrastructure/existencia-inicial-repository";
import { jornadaActualTenant } from "../infrastructure/partida-repository";
import {
  countFilasRelevamiento,
  countDrogasFaltanCargar,
} from "../infrastructure/relevamiento-fila-repository";

export interface ResumenRelevamientoResult {
  mostrar: boolean;
  diasRestantes?: number;
  filasPlanilla?: number;
  faltanCargar?: number;
  fechaLimite?: string;
}

const resumenRelevamientoInput = z.object({});

export const resumenRelevamientoQuery = defineQuery({
  name: "stock.relevamiento.resumen",
  permiso: "stock.ver",
  input: resumenRelevamientoInput,
  handler: async ({ tx, session }): Promise<ResumenRelevamientoResult> => {
    const estado = await getEstadoRelevamientoInicial(tx, session.tenantId);
    if (!estado.abierto || !estado.fechaLimite) {
      return { mostrar: false };
    }

    const jornada = await jornadaActualTenant(tx, session.tenantId);
    const ms = Date.parse(`${estado.fechaLimite}T00:00:00Z`) - Date.parse(`${jornada}T00:00:00Z`);
    const diasRestantes = Math.round(ms / 86_400_000);

    if (diasRestantes > 7) {
      return { mostrar: false };
    }

    const [filasPlanilla, faltanCargar] = await Promise.all([
      countFilasRelevamiento(tx, session.tenantId),
      countDrogasFaltanCargar(tx, session.tenantId),
    ]);

    return {
      mostrar: true,
      diasRestantes: Math.max(0, diasRestantes),
      filasPlanilla,
      faltanCargar,
      fechaLimite: estado.fechaLimite,
    };
  },
});

export async function resumenRelevamiento(): Promise<ResumenRelevamientoResult> {
  return resumenRelevamientoQuery.execute({});
}
