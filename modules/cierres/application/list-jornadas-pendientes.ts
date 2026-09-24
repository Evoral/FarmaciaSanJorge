/**
 * `listJornadasPendientes` -- FASE 10, M13a points 10.1/10.3. Gated on
 * `cierres.ver` (DIRECTOR_TECNICO/FARMACEUTICO/SOLO_CONSULTA, migration
 * 0002) -- every role that can firmar already holds `cierres.ver` too (the
 * seed grants DT both), so this single permiso covers both the `/cierres`
 * pending list and the layout banner (FASE 10 point 10.3) for every
 * audience the task names.
 *
 * DP-18d RESUELTA: only fechas with at least one unsigned VIGENTE asiento
 * (recetario or contralor) are pending -- enforced at the SQL layer
 * (`listJornadasPendientes` in the repository already only selects those
 * fechas) and re-asserted here via the pure domain filter
 * (`filtrarJornadasQueRequierenFirma`) as a defensive double check.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import {
  listJornadasPendientes as listJornadasPendientesDb,
  jornadaActualTenant,
  getPlazoFirmaDias,
  getResumenPendientes,
} from "../infrastructure/cierre-repository";
import { filtrarJornadasQueRequierenFirma } from "../domain/pendientes";
import { calcularAntiguedadDias, calcularFueraDeTermino } from "../domain/demora";

export interface JornadaPendienteItem {
  fecha: string;
  cantidadRecetario: number;
  cantidadContralor: number;
  antiguedadDias: number;
  fueraDeTermino: boolean;
  /** `true` only for the FIRST (oldest) row -- the UI/chronological-order guard (INV-C19 is the real backstop) only lets this one be signed next. */
  esLaMasAntigua: boolean;
}

export const listJornadasPendientesQuery = defineQuery({
  name: "cierres.jornadas.pendientes",
  permiso: "cierres.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<JornadaPendienteItem[]> => {
    const [rows, jornadaActual, plazoFirmaDias] = await Promise.all([
      listJornadasPendientesDb(tx, session.tenantId),
      jornadaActualTenant(tx, session.tenantId),
      getPlazoFirmaDias(tx, session.tenantId),
    ]);

    const pendientes = filtrarJornadasQueRequierenFirma(rows);

    return pendientes.map((row, index) => ({
      fecha: row.fecha,
      cantidadRecetario: row.cantidadRecetario,
      cantidadContralor: row.cantidadContralor,
      antiguedadDias: calcularAntiguedadDias(row.fecha, jornadaActual),
      fueraDeTermino: calcularFueraDeTermino({ jornadaActual, fecha: row.fecha, plazoFirmaDias }),
      esLaMasAntigua: index === 0,
    }));
  },
});

export async function listJornadasPendientes(): Promise<JornadaPendienteItem[]> {
  return listJornadasPendientesQuery.execute({});
}

/**
 * Cheap summary for the layout banner (FASE 10 point 10.3) -- backed by
 * `getResumenPendientes`'s SQL-side aggregate (count + oldest fecha) instead
 * of running the full pending list just to keep the first item, then
 * computes antigüedad/fuera-de-término ONLY for that single oldest fecha
 * (same domain helpers, and the same `plazo_firma_dias` source, the full
 * list uses -- `fsj.cierre_diario_calcular_fuera_de_termino`'s JS mirror).
 */
export interface ResumenPendientes {
  cantidad: number;
  masAntigua: { fecha: string; antiguedadDias: number; fueraDeTermino: boolean } | null;
}

export const resumenJornadasPendientesQuery = defineQuery({
  name: "cierres.jornadas.resumenPendientes",
  permiso: "cierres.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<ResumenPendientes> => {
    const resumen = await getResumenPendientes(tx, session.tenantId);
    if (resumen.cantidad === 0 || !resumen.masAntiguaFecha) {
      return { cantidad: resumen.cantidad, masAntigua: null };
    }

    const [jornadaActual, plazoFirmaDias] = await Promise.all([
      jornadaActualTenant(tx, session.tenantId),
      getPlazoFirmaDias(tx, session.tenantId),
    ]);

    return {
      cantidad: resumen.cantidad,
      masAntigua: {
        fecha: resumen.masAntiguaFecha,
        antiguedadDias: calcularAntiguedadDias(resumen.masAntiguaFecha, jornadaActual),
        fueraDeTermino: calcularFueraDeTermino({ jornadaActual, fecha: resumen.masAntiguaFecha, plazoFirmaDias }),
      },
    };
  },
});

export async function resumenJornadasPendientes(): Promise<ResumenPendientes> {
  return resumenJornadasPendientesQuery.execute({});
}

/** The tenant's current jornada -- used by `/cierres` to decide whether the oldest pending fecha IS today (DP-18b's explicit warning). Same permiso as the rest of this file. */
export const jornadaActualCierresQuery = defineQuery({
  name: "cierres.jornadaActual",
  permiso: "cierres.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<string> => jornadaActualTenant(tx, session.tenantId),
});

export async function getJornadaActualCierres(): Promise<string> {
  return jornadaActualCierresQuery.execute({});
}
