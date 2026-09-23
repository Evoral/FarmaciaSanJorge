/**
 * `alertasStock` (M07, FASE 5 point 5.7). Read-only, `stock.ver`. Three
 * independent alerts (plan §9 M07 historia 6):
 *   - drogas below `stock_minimo` (from `fsj.v_stock_droga`, never summed).
 *   - partidas expiring within `dias_alerta_vencimiento_partida` days of
 *     the tenant's jornada (DP-14).
 *   - already-expired partidas that still carry a balance -- suggests a
 *     VENCIMIENTO ajuste (5.4).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import {
  alertasBajoMinimo,
  alertasPorVencer,
  alertasVencidasConSaldo,
  getDiasAlertaVencimiento,
} from "../infrastructure/partida-repository";
import type { AlertaBajoMinimo, AlertaPorVencer, AlertaVencidaConSaldo } from "../infrastructure/partida-repository";

const alertasStockInput = z.object({});

export interface AlertasStockResult {
  bajoMinimo: AlertaBajoMinimo[];
  porVencer: AlertaPorVencer[];
  vencidasConSaldo: AlertaVencidaConSaldo[];
  diasAlertaVencimiento: number;
}

export const alertasStockQuery = defineQuery({
  name: "stock.alertas.listar",
  permiso: "stock.ver",
  input: alertasStockInput,
  handler: async ({ tx, session }): Promise<AlertasStockResult> => {
    const diasAlertaVencimiento = await getDiasAlertaVencimiento(tx, session.tenantId);
    const [bajoMinimo, porVencer, vencidasConSaldo] = await Promise.all([
      alertasBajoMinimo(tx, session.tenantId),
      alertasPorVencer(tx, session.tenantId, diasAlertaVencimiento),
      alertasVencidasConSaldo(tx, session.tenantId),
    ]);
    return { bajoMinimo, porVencer, vencidasConSaldo, diasAlertaVencimiento };
  },
});

export async function alertasStock(): Promise<AlertasStockResult> {
  return alertasStockQuery.execute({});
}
