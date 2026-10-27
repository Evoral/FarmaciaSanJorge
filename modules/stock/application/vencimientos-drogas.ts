/**
 * Vencimientos of DROGA partidas, the ones that wait on the Director Técnico
 * (openspec/specs/reanalisis-partida/spec.md): insumos are excluded, as in the spec.
 * Read-only, `stock.ver` -- the same permiso as `alertasStock`, whose
 * repository queries they reuse (`alertasVencidasConSaldo` / `alertasPorVencer`).
 *
 * - `listVencimientosDrogas`: the "Gestión DT › Vencimientos" tab
 *   (`/cierres/vencimientos`) -- vencidas con saldo and por vencer within
 *   `dias_alerta_vencimiento_partida`, plus the jornada and whether the
 *   session's usuario is a DT vigente today (the page offers "Registrar
 *   reanálisis" / "Marcar como vencida" only to them; the commands re-check
 *   it, and so does the DB).
 * - `resumenVencimientosDrogas`: one aggregate for the app-wide banner --
 *   distinct drogas with a vencida partida and with a por vencer one.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import {
  alertasPorVencer,
  alertasVencidasConSaldo,
  getDiasAlertaVencimiento,
  jornadaActualTenant,
  resumenVencimientosDrogas as resumenVencimientosDrogasRepo,
} from "../infrastructure/partida-repository";
import type { AlertaPorVencer, ResumenVencimientosDrogas } from "../infrastructure/partida-repository";
import { esDtVigenteHoy } from "../infrastructure/co-firma-repository";

export type VencimientoDroga = AlertaPorVencer;
export type { ResumenVencimientosDrogas };

export interface VencimientosDrogasResult {
  /** Vencimiento vigente < jornada, with saldo: blocked until the DT acts. Oldest first. */
  vencidas: VencimientoDroga[];
  /** Vencimiento vigente within `[jornada, jornada + diasAlertaVencimiento]`, with saldo. Soonest first. */
  porVencer: VencimientoDroga[];
  diasAlertaVencimiento: number;
  /** The tenant's jornada, YYYY-MM-DD. */
  jornadaActual: string;
  /** The session's usuario is a DT vigente (titular or suplente) today. */
  sesionEsDtVigente: boolean;
}

const sinInput = z.object({});

export const listVencimientosDrogasQuery = defineQuery({
  name: "stock.vencimientos.listar",
  permiso: "stock.ver",
  input: sinInput,
  handler: async ({ tx, session }): Promise<VencimientosDrogasResult> => {
    const diasAlertaVencimiento = await getDiasAlertaVencimiento(tx, session.tenantId);
    const vencidas = await alertasVencidasConSaldo(tx, session.tenantId);
    const porVencer = await alertasPorVencer(tx, session.tenantId, diasAlertaVencimiento);
    return {
      vencidas: vencidas.filter((a) => a.esDroga),
      porVencer: porVencer.filter((a) => a.esDroga),
      diasAlertaVencimiento,
      jornadaActual: await jornadaActualTenant(tx, session.tenantId),
      sesionEsDtVigente: await esDtVigenteHoy(tx, session.tenantId, session.usuario.id),
    };
  },
});

export async function listVencimientosDrogas(): Promise<VencimientosDrogasResult> {
  return listVencimientosDrogasQuery.execute({});
}

export const resumenVencimientosDrogasQuery = defineQuery({
  name: "stock.vencimientos.resumen",
  permiso: "stock.ver",
  input: sinInput,
  handler: async ({ tx, session }): Promise<ResumenVencimientosDrogas> => {
    const diasAlertaVencimiento = await getDiasAlertaVencimiento(tx, session.tenantId);
    return resumenVencimientosDrogasRepo(tx, session.tenantId, diasAlertaVencimiento);
  },
});

export async function resumenVencimientosDrogas(): Promise<ResumenVencimientosDrogas> {
  return resumenVencimientosDrogasQuery.execute({});
}
