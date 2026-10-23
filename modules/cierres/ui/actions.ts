"use server";

/** Server Actions for `/cierres/**` (FASE 10). */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { firmarCierre } from "@/modules/cierres/application/firmar-cierre";
import { actionError } from "@/shared/ui/action-error";
import type { CierresActionState } from "./action-state";
import { MOTIVO_DEMORA_VALUES } from "../domain/motivo-demora";

function esMotivoDemoraValido(value: string): value is (typeof MOTIVO_DEMORA_VALUES)[number] {
  return (MOTIVO_DEMORA_VALUES as readonly string[]).includes(value);
}

/** Migration 0097: the "libroId:numeroInicial" pairs the form showed, sent only when the DT ticked the confirmation. */
function numeracionConfirmadaDe(formData: FormData): { libroId: string; numeroInicial: string }[] {
  if (formData.get("confirmaNumeracion") !== "on") return [];
  return formData.getAll("numeracion").map((v) => {
    const [libroId = "", numeroInicial = ""] = String(v).split(":");
    return { libroId, numeroInicial };
  });
}

export async function firmarCierreAction(_prevState: CierresActionState, formData: FormData): Promise<CierresActionState> {
  const fecha = String(formData.get("fecha") ?? "");
  const motivoDemoraRaw = String(formData.get("motivoDemora") ?? "");
  let firmado: { id: string; fecha: string };
  try {
    const resultado = await firmarCierre({
      fecha,
      password: String(formData.get("password") ?? ""),
      motivoDemora: esMotivoDemoraValido(motivoDemoraRaw) ? motivoDemoraRaw : undefined,
      motivoDemoraDetalle: (formData.get("motivoDemoraDetalle") as string | null)?.trim() || undefined,
      numeracionConfirmada: numeracionConfirmadaDe(formData),
    });
    revalidatePath("/cierres");
    revalidatePath("/cierres/historial");
    revalidatePath(`/cierres/${resultado.id}`);
    revalidatePath("/libro/dias");
    revalidatePath("/libro/numeracion");
    firmado = { id: resultado.id, fecha: resultado.fecha };
  } catch (error) {
    // The form's hidden numeracion fields may be stale (renumbered meanwhile): refresh them, or every retry fails.
    revalidatePath("/cierres");
    return actionError(error, "No se pudo firmar el cierre.");
  }
  // Back to /cierres with the signed jornada, so the DT can print its sheet right away (outside the try: redirect throws).
  redirect(`/cierres?firmada=${encodeURIComponent(firmado.id)}&fecha=${encodeURIComponent(firmado.fecha)}`);
}
