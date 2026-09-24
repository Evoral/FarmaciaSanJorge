"use server";

/** Search Server Action for `/regularizacion` (FASE 11 point 11.3). Same DP-24 discipline as buscar-entregas-action.ts -- the paciente search term travels ONLY as POST'd FormData. */
import { listRegularizacion } from "@/modules/entregas/application/list-regularizacion";
import type { RegularizacionListItem } from "@/modules/entregas/application/list-regularizacion";
import { AppError } from "@/shared/errors";

const RESULTADOS_BUSQUEDA = 50;

export type BuscarRegularizacionState =
  | { status: "idle"; items: RegularizacionListItem[]; total: number; plazoRegularizacionDias: number }
  | { status: "error"; message: string; items: RegularizacionListItem[]; total: number; plazoRegularizacionDias: number }
  | { status: "success"; items: RegularizacionListItem[]; total: number; plazoRegularizacionDias: number };

export async function buscarRegularizacionAction(prevState: BuscarRegularizacionState, formData: FormData): Promise<BuscarRegularizacionState> {
  const q = String(formData.get("q") ?? "").trim();
  const soloVencidas = formData.get("soloVencidas") === "on";
  try {
    const result = await listRegularizacion({ search: q.length > 0 ? q : undefined, soloVencidas, page: 1, pageSize: RESULTADOS_BUSQUEDA });
    return { status: "success", items: result.items, total: result.total, plazoRegularizacionDias: result.plazoRegularizacionDias };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "No se pudo buscar recetas pendientes de regularizar.";
    return { status: "error", message, items: prevState.items, total: prevState.total, plazoRegularizacionDias: prevState.plazoRegularizacionDias };
  }
}
