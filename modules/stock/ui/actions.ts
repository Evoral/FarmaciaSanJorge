"use server";

/** Server Actions for `/stock/**` (FASE 5). */
import { revalidatePath } from "next/cache";
import { ingresarPartida } from "@/modules/stock/application/ingresar-partida";
import { registrarAjusteStock } from "@/modules/stock/application/registrar-ajuste";
import { corregirCostoPartida } from "@/modules/stock/application/corregir-costo-partida";
import type { MotivoAjuste } from "@/modules/stock/domain/partida";
import { AppError } from "@/shared/errors";
import type { StockActionState } from "./action-state";

function fromError(error: unknown, fallback: string): StockActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  return { status: "error", message: fallback };
}

export async function ingresarPartidaAction(_prevState: StockActionState, formData: FormData): Promise<StockActionState> {
  try {
    await ingresarPartida({
      drogaId: String(formData.get("drogaId") ?? ""),
      proveedorId: String(formData.get("proveedorId") ?? ""),
      lote: String(formData.get("lote") ?? ""),
      fechaVencimiento: String(formData.get("fechaVencimiento") ?? ""),
      cantidadCompra: String(formData.get("cantidadCompra") ?? ""),
      unidadCompraId: String(formData.get("unidadCompraId") ?? ""),
      costoUnitario: String(formData.get("costoUnitario") ?? ""),
      numeroValeAdquisicion: (formData.get("numeroValeAdquisicion") as string | null)?.trim() || undefined,
    });
    revalidatePath("/stock");
    return { status: "success", message: "Partida ingresada." };
  } catch (error) {
    return fromError(error, "No se pudo ingresar la partida.");
  }
}

/**
 * FIX 4 (jd-fix-agent, 2026-09-23): `registrarAjusteStock` itself now runs
 * the DT co-firma verification (own transaction, rate-limited, audits
 * failures) BEFORE doing anything else -- this Server Action only forwards
 * the raw form fields, it does NOT verify anything itself. See
 * `modules/stock/application/registrar-ajuste.ts`'s module doc comment for
 * why this moved out of the UI layer (an exported command that trusted a
 * pre-verified id could be called directly by ANY other caller, bypassing
 * co-firma entirely).
 */
export async function registrarAjusteAction(_prevState: StockActionState, formData: FormData): Promise<StockActionState> {
  try {
    await registrarAjusteStock({
      partidaId: String(formData.get("partidaId") ?? ""),
      cantidad: String(formData.get("cantidad") ?? ""),
      motivoAjuste: String(formData.get("motivoAjuste") ?? "") as MotivoAjuste,
      observacion: String(formData.get("observacion") ?? ""),
      dtUsuarioId: String(formData.get("dtUsuarioId") ?? ""),
      dtPassword: String(formData.get("dtPassword") ?? ""),
    });
    revalidatePath("/stock");
    return { status: "success", message: "Ajuste registrado." };
  } catch (error) {
    return fromError(error, "No se pudo registrar el ajuste.");
  }
}

export async function corregirCostoPartidaAction(_prevState: StockActionState, formData: FormData): Promise<StockActionState> {
  try {
    await corregirCostoPartida({
      id: String(formData.get("id") ?? ""),
      costoUnitarioNuevo: String(formData.get("costoUnitarioNuevo") ?? ""),
      motivo: String(formData.get("motivo") ?? ""),
    });
    revalidatePath("/stock");
    return { status: "success", message: "Costo corregido." };
  } catch (error) {
    return fromError(error, "No se pudo corregir el costo.");
  }
}
