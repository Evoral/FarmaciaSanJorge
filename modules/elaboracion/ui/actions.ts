"use server";

/** Server Action for `/recetas/[id]/items/[itemId]/ficha-tecnica` (FASE 7 point 7.2). */
import { revalidatePath } from "next/cache";
import { generarFichaTecnica } from "@/modules/elaboracion/application/generar-ficha-tecnica";
import { AppError } from "@/shared/errors";
import type { FichaActionState } from "./action-state";

export async function generarFichaTecnicaAction(_prevState: FichaActionState, formData: FormData): Promise<FichaActionState> {
  const itemRecetaId = String(formData.get("itemRecetaId") ?? "");
  const recetaId = String(formData.get("recetaId") ?? "");
  try {
    const nueva = await generarFichaTecnica({ itemRecetaId });
    if (recetaId) {
      revalidatePath(`/recetas/${recetaId}/items/${itemRecetaId}/ficha-tecnica`);
    }
    return { status: "success", message: `Ficha versión ${nueva.version} generada.`, id: nueva.id, version: nueva.version };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "No se pudo generar la ficha técnica.";
    return { status: "error", message };
  }
}
