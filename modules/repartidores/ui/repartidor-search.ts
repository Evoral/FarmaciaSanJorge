/**
 * Adapter between `buscarRepartidoresAction` and the `search` prop of `shared/ui/combobox.tsx`:
 *
 *   const search = useMemo(() => buscarRepartidoresParaCombobox(true), []);
 *   <Combobox label="Repartidor" search={search} ... />
 *
 * Option label: "Apellido, Nombre · teléfono", suffixed " (inactivo)" when the repartidor is not active. A failure
 * throws with the action's Spanish message, which the Combobox shows with its retry button.
 */
import type { ComboboxOption } from "@/shared/ui/combobox";
import { formatearRepartidorOpcion } from "../domain/repartidor";
import type { RepartidorOpcion } from "../domain/repartidor";
import { buscarRepartidoresAction } from "./buscar-repartidores-action";

export function repartidorAOpcion(repartidor: RepartidorOpcion): ComboboxOption {
  return { value: repartidor.id, label: formatearRepartidorOpcion(repartidor) };
}

/** `soloActivos`: `true` to assign a repartidor to an envío, `false` to also find inactive ones (the hoja de envíos). */
export function buscarRepartidoresParaCombobox(soloActivos: boolean): (query: string) => Promise<readonly ComboboxOption[]> {
  return async (query) => {
    const result = await buscarRepartidoresAction(query, soloActivos);
    if (result.status === "error") throw new Error(result.message);
    return result.repartidores.map(repartidorAOpcion);
  };
}
