"use server";

/**
 * Server Action behind every repartidor autocomplete (the envío of the entregas modal, the "Exportar envíos"
 * dialog). The typed text travels in the POST of the action, never in a URL. The caller picks `soloActivos`: `true`
 * to ASSIGN a repartidor (an inactive one is not offered for new envíos), `false` where inactive ones still matter
 * (the hoja de envíos of a repartidor already deactivated).
 *
 * Returns a result object, not a bare list, so a failure reaches the user with its Spanish message (a thrown error
 * would be masked in production). Client components do not call it directly: `./repartidor-search.ts` adapts it to
 * the `search` prop of `shared/ui/combobox.tsx`.
 */
import { buscarRepartidores } from "@/modules/repartidores/application/buscar-repartidores";
import type { RepartidorOpcion } from "@/modules/repartidores/domain/repartidor";
import { actionErrorMessage } from "@/shared/ui/action-error";

export type BuscarRepartidoresResult = { status: "success"; repartidores: RepartidorOpcion[] } | { status: "error"; message: string };

export async function buscarRepartidoresAction(texto: string, soloActivos: boolean): Promise<BuscarRepartidoresResult> {
  try {
    const repartidores = await buscarRepartidores({ texto: String(texto ?? "").slice(0, 100), soloActivos: soloActivos !== false });
    return { status: "success", repartidores };
  } catch (error) {
    return { status: "error", message: actionErrorMessage(error, "No se pudo buscar repartidores.") };
  }
}
