"use client";

/** `/admin/precios`'s "nueva versión" form (FASE 4 point 4.6, ADM/DT). */
import { guardarReglaPrecioAction } from "./actions";
import { SimpleForm } from "./simple-form";

export interface ReglaPrecioFormProps {
  margenActual: string | null;
}

export function ReglaPrecioForm({ margenActual }: ReglaPrecioFormProps) {
  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="mb-1 text-base font-semibold">{margenActual === null ? "Configurar margen" : "Nueva versión del margen"}</h2>
      <p className="mb-3 text-xs text-zinc-500">
        Precio final = costo de insumos + el margen aplicado sobre ese costo (margen 150 = costo × 2,5). Sin honorario fijo, sin variación por forma farmacéutica (DP-09). Guardar acá NO modifica la regla
        actual: cierra la vigente y crea una versión nueva (INV-PR-001) -- las cotizaciones ya calculadas mantienen el margen con el que se calcularon.
      </p>
      <SimpleForm action={guardarReglaPrecioAction} submitLabel="Guardar" className="flex max-w-xs flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="margen" className="text-sm font-medium">
            Margen (%) {margenActual !== null ? `— actual: ${margenActual}` : ""}
          </label>
          <input
            id="margen"
            name="margen"
            type="text"
            inputMode="decimal"
            required
            placeholder="Ej: 300"
            className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      </SimpleForm>
    </div>
  );
}
