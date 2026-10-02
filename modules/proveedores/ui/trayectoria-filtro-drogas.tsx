/**
 * "Filtrar por droga" control of the proveedor Trayectoria partidas table
 * (docs/specs/trayectoria-proveedor.md, "Filtro por droga"): the system's
 * standard `FilterForm` (auto-applying GET form) around two things that share
 * `name="droga"`:
 *
 *   - an "Agregar droga" select with the proveedor's drogas that are NOT
 *     selected yet (empty first option, so it always reads as "pick one");
 *   - one CHECKED checkbox per selected droga, drawn as a chip. Unchecking it
 *     applies the form and removes the droga; "Limpiar filtros" unchecks all.
 *
 * `FilterForm` serializes the repeated name as `?droga=a&droga=b` (it appends,
 * never overwrites) and drops `page`. The checkboxes are real form controls, so
 * the control also works without JS (Enter submits the form). Server
 * component: the options and the selection come from the use case (already
 * restricted to the proveedor's own drogas), never from the raw URL.
 */
import { FilterForm } from "@/shared/ui/filter-form";
import { drogasRestantes, drogasSeleccionadas } from "../domain/trayectoria";
import type { DrogaOpcion } from "../domain/trayectoria";

export interface TrayectoriaFiltroDrogasProps {
  /** Every droga the proveedor has partidas of, sorted by name. */
  disponibles: readonly DrogaOpcion[];
  /** Ids of the drogas currently filtered (a subset of `disponibles`). */
  seleccionadas: readonly string[];
}

export function TrayectoriaFiltroDrogas({ disponibles, seleccionadas }: TrayectoriaFiltroDrogasProps) {
  const elegidas = drogasSeleccionadas(disponibles, seleccionadas);
  const restantes = drogasRestantes(disponibles, seleccionadas);

  return (
    <FilterForm className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filtro de partidas por droga" hasActiveFilters={elegidas.length > 0}>
      {restantes.length > 0 ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="trayectoria-droga" className="text-sm font-medium">
            Filtrar por droga
          </label>
          <select id="trayectoria-droga" name="droga" defaultValue="" className="input">
            <option value="">Agregar droga…</option>
            {restantes.map((droga) => (
              <option key={droga.id} value={droga.id}>
                {droga.nombre}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {elegidas.length > 0 ? (
        <div role="group" aria-label="Drogas seleccionadas" className="flex flex-wrap items-center gap-2 pb-1">
          {elegidas.map((droga) => (
            <label
              key={droga.id}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-zinc-300 bg-zinc-100 px-3 py-1 text-sm text-zinc-800 hover:bg-zinc-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--color-brand) dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            >
              <input type="checkbox" name="droga" value={droga.id} defaultChecked className="sr-only" />
              <span className="sr-only">Quitar filtro </span>
              {droga.nombre}
              <span aria-hidden="true" className="text-zinc-500">
                ✕
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </FilterForm>
  );
}
