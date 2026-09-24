"use server";

/** Server Actions for `/cierres/**` (FASE 10). */
import { revalidatePath } from "next/cache";
import { firmarCierre } from "@/modules/cierres/application/firmar-cierre";
import { AppError } from "@/shared/errors";
import type { CierresActionState } from "./action-state";
import { MOTIVO_DEMORA_VALUES } from "../domain/motivo-demora";

function esMotivoDemoraValido(value: string): value is (typeof MOTIVO_DEMORA_VALUES)[number] {
  return (MOTIVO_DEMORA_VALUES as readonly string[]).includes(value);
}

export async function firmarCierreAction(_prevState: CierresActionState, formData: FormData): Promise<CierresActionState> {
  const fecha = String(formData.get("fecha") ?? "");
  const motivoDemoraRaw = String(formData.get("motivoDemora") ?? "");
  try {
    const resultado = await firmarCierre({
      fecha,
      password: String(formData.get("password") ?? ""),
      motivoDemora: esMotivoDemoraValido(motivoDemoraRaw) ? motivoDemoraRaw : undefined,
      motivoDemoraDetalle: (formData.get("motivoDemoraDetalle") as string | null)?.trim() || undefined,
    });
    revalidatePath("/cierres");
    revalidatePath(`/cierres/${resultado.id}`);
    return { status: "success", message: `Jornada ${resultado.fecha} firmada (${resultado.cantidadAsientos} asiento${resultado.cantidadAsientos === 1 ? "" : "s"}).` };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "No se pudo firmar el cierre.";
    return { status: "error", message };
  }
}
