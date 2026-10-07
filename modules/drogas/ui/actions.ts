"use server";

/** Server Actions for `/catalogos/drogas` (FASE 4 point 4.2), synonyms included (docs/specs/sinonimos-droga.md). */
import { revalidatePath } from "next/cache";
import { crearDroga } from "@/modules/drogas/application/crear-droga";
import { editarDroga } from "@/modules/drogas/application/editar-droga";
import { darDeBajaDroga } from "@/modules/drogas/application/dar-de-baja-droga";
import { reactivarDroga } from "@/modules/drogas/application/reactivar-droga";
import { actionError } from "@/shared/ui/action-error";
import type { DrogaActionState } from "./action-state";

/**
 * Disabled fields are not submitted: a missing field is sent as `undefined`
 * so the command keeps the stored value. `esControlada` is never read from
 * the form -- the command derives it from `tipoControl`.
 */
function optionalField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return value === null ? undefined : String(value);
}

/** `sinonimo-0`, `sinonimo-1`, ... in index order, blanks kept: the command reports a rejected one by that same index. */
function sinonimosDelForm(formData: FormData): string[] {
  const sinonimos: string[] = [];
  for (const [key, value] of formData.entries()) {
    const match = /^sinonimo-(\d+)$/.exec(key);
    if (match) sinonimos[Number(match[1])] = String(value);
  }
  return Array.from(sinonimos, (s) => s ?? "");
}

/** «A», «B» y «C». */
function listaNombres(nombres: readonly string[]): string {
  const citados = nombres.map((n) => `«${n}»`);
  return citados.length <= 1 ? citados.join("") : `${citados.slice(0, -1).join(", ")} y ${citados.at(-1)}`;
}

function fromError(error: unknown, fallback: string): DrogaActionState {
  return actionError(error, fallback);
}

export async function crearDrogaAction(_prevState: DrogaActionState, formData: FormData): Promise<DrogaActionState> {
  try {
    const creada = await crearDroga({
      nombre: String(formData.get("nombre") ?? ""),
      unidadBaseId: String(formData.get("unidadBaseId") ?? ""),
      tipoControl: optionalField(formData, "tipoControl"),
      clase: optionalField(formData, "clase"),
      stockMinimo: String(formData.get("stockMinimo") ?? "0"),
      sinonimos: sinonimosDelForm(formData),
    });
    revalidatePath("/catalogos/drogas");
    const otros = creada.sinonimos.length > 0 ? ` con ${creada.sinonimos.length === 1 ? "otro nombre" : "otros nombres"}: ${listaNombres(creada.sinonimos)}` : "";
    return { status: "success", message: `Droga creada${otros}.` };
  } catch (error) {
    return fromError(error, "No se pudo crear la droga.");
  }
}

export async function editarDrogaAction(_prevState: DrogaActionState, formData: FormData): Promise<DrogaActionState> {
  try {
    const editada = await editarDroga({
      id: String(formData.get("id") ?? ""),
      nombre: String(formData.get("nombre") ?? ""),
      unidadBaseId: optionalField(formData, "unidadBaseId"),
      tipoControl: optionalField(formData, "tipoControl"),
      clase: optionalField(formData, "clase"),
      stockMinimo: String(formData.get("stockMinimo") ?? "0"),
      // The "Otros nombres" rows travel only when the form rendered them enabled (marker field).
      ...(formData.has("sinonimosEnviados")
        ? { sinonimos: sinonimosDelForm(formData), sinonimosCargados: formData.getAll("sinonimosCargados").map(String) }
        : {}),
      version: {
        nombre: String(formData.get("versionNombre") ?? ""),
        unidadBaseId: String(formData.get("versionUnidadBaseId") ?? ""),
        esControlada: String(formData.get("versionEsControlada") ?? "") === "true",
        tipoControl: String(formData.get("versionTipoControl") ?? "") as never,
        clase: String(formData.get("versionClase") ?? ""),
        stockMinimo: String(formData.get("versionStockMinimo") ?? ""),
      },
    });
    revalidatePath("/catalogos/drogas");
    const cambios = [
      editada.sinonimosAgregados.length > 0 ? `${editada.sinonimosAgregados.length === 1 ? "se agregó" : "se agregaron"} ${listaNombres(editada.sinonimosAgregados)}` : null,
      editada.sinonimosQuitados.length > 0 ? `${editada.sinonimosQuitados.length === 1 ? "se quitó" : "se quitaron"} ${listaNombres(editada.sinonimosQuitados)}` : null,
    ].filter(Boolean);
    return { status: "success", message: cambios.length > 0 ? `Cambios guardados: ${cambios.join("; ")}.` : "Droga actualizada." };
  } catch (error) {
    return fromError(error, "No se pudieron guardar los cambios.");
  }
}

export async function darDeBajaDrogaAction(_prevState: DrogaActionState, formData: FormData): Promise<DrogaActionState> {
  try {
    await darDeBajaDroga({ id: String(formData.get("id") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    revalidatePath("/catalogos/drogas");
    return { status: "success", message: "Droga dada de baja." };
  } catch (error) {
    return fromError(error, "No se pudo dar de baja la droga.");
  }
}

export async function reactivarDrogaAction(_prevState: DrogaActionState, formData: FormData): Promise<DrogaActionState> {
  try {
    await reactivarDroga({ id: String(formData.get("id") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    revalidatePath("/catalogos/drogas");
    return { status: "success", message: "Droga reactivada." };
  } catch (error) {
    return fromError(error, "No se pudo reactivar la droga.");
  }
}
