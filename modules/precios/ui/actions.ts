"use server";

/** Server Actions for `/admin/configuracion/precios` (FASE 4 point 4.6) and `/recetas/[id]/items/[itemId]/cotizacion` (FASE 7 point 7.4). */
import { revalidatePath } from "next/cache";
import { guardarReglaPrecio } from "@/modules/precios/application/guardar-regla-precio";
import { calcularCotizacionItem } from "@/modules/precios/application/calcular-cotizacion";
import { actionError } from "@/shared/ui/action-error";
import type { PreciosActionState } from "./action-state";

function fromError(error: unknown, fallback: string): PreciosActionState {
  return actionError(error, fallback);
}

export async function guardarReglaPrecioAction(_prevState: PreciosActionState, formData: FormData): Promise<PreciosActionState> {
  try {
    // One row per tramo, in order: `tramoCostoHasta` is "" for the open-ended
    // last tramo (rendered as a hidden input) -- "" anywhere means "sin tope",
    // and the use case rejects it on any tramo but the last.
    const costosHasta = formData.getAll("tramoCostoHasta").map((v) => String(v).trim());
    const margenes = formData.getAll("tramoMargen").map((v) => String(v));
    await guardarReglaPrecio({
      precioMinimo: String(formData.get("precioMinimo") ?? ""),
      tramos: margenes.map((margen, i) => ({ costoHasta: costosHasta[i] ? costosHasta[i]! : null, margen })),
    });
    revalidatePath("/admin/configuracion/precios");
    return { status: "success", message: "Reglas de precio guardadas." };
  } catch (error) {
    return fromError(error, "No se pudieron guardar las reglas de precio.");
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
