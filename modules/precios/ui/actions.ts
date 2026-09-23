"use server";

/** Server Actions for `/admin/precios` (FASE 4 point 4.6) and `/recetas/[id]/items/[itemId]/cotizacion` (FASE 7 point 7.4). */
import { revalidatePath } from "next/cache";
import { guardarReglaPrecio } from "@/modules/precios/application/guardar-regla-precio";
import { calcularCotizacionItem } from "@/modules/precios/application/calcular-cotizacion";
import { AppError } from "@/shared/errors";
import type { PreciosActionState } from "./action-state";

function fromError(error: unknown, fallback: string): PreciosActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  return { status: "error", message: fallback };
}

export async function guardarReglaPrecioAction(_prevState: PreciosActionState, formData: FormData): Promise<PreciosActionState> {
  try {
    await guardarReglaPrecio({ margen: String(formData.get("margen") ?? "") });
    revalidatePath("/admin/precios");
    return { status: "success", message: "Regla de precio guardada." };
  } catch (error) {
    return fromError(error, "No se pudo guardar la regla de precio.");
  }
}

export async function calcularCotizacionAction(_prevState: PreciosActionState, formData: FormData): Promise<PreciosActionState> {
  try {
    const itemRecetaId = String(formData.get("itemRecetaId") ?? "");
    const recetaId = String(formData.get("recetaId") ?? "");
    const resultado = await calcularCotizacionItem({ itemRecetaId });
    if (recetaId) {
      revalidatePath(`/recetas/${recetaId}/items/${itemRecetaId}/cotizacion`);
    }
    const avisos: string[] = [];
    if (resultado.esParcial) avisos.push("cotización PARCIAL (hay líneas de enrase manual sin costo)");
    if (resultado.esIncompleta) avisos.push("cotización INCOMPLETA (stock insuficiente en alguna línea)");
    return {
      status: "success",
      message: `Precio final: $${resultado.precioFinal}${avisos.length ? ` — ${avisos.join("; ")}` : ""}.`,
    };
  } catch (error) {
    return fromError(error, "No se pudo calcular la cotización.");
  }
}
