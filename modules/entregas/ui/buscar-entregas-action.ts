"use server";

/**
 * Search Server Action for `/entregas` (FASE 11). Same DP-24 discipline as
 * `modules/pacientes/ui/buscar-pacientes-action.ts`/`modules/recetas/ui/actions.ts`'s
 * `buscarPacientesParaRecetaAction`: the paciente-name search term travels
 * ONLY as POST'd FormData (a Server Action RPC call), never a URL/query
 * string -- own copy per module.
 */
import { listEntregasPendientes } from "@/modules/entregas/application/list-entregas-pendientes";
import type { EntregaPendienteItem } from "@/modules/entregas/application/list-entregas-pendientes";
import { AppError } from "@/shared/errors";

const RESULTADOS_BUSQUEDA = 50;

export type BuscarEntregasState =
  | { status: "idle"; items: EntregaPendienteItem[]; total: number }
  | { status: "error"; message: string; items: EntregaPendienteItem[]; total: number }
  | { status: "success"; items: EntregaPendienteItem[]; total: number };

export async function buscarEntregasAction(prevState: BuscarEntregasState, formData: FormData): Promise<BuscarEntregasState> {
  const q = String(formData.get("q") ?? "").trim();
  try {
    const result = await listEntregasPendientes({ search: q.length > 0 ? q : undefined, page: 1, pageSize: RESULTADOS_BUSQUEDA });
    return { status: "success", items: result.items, total: result.total };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "No se pudo buscar entregas pendientes.";
    return { status: "error", message, items: prevState.items, total: prevState.total };
  }
}
