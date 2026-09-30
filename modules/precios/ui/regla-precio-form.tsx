"use client";

/** `/admin/configuracion/precios`'s "nueva versión" form (FASE 4 point 4.6, ADM/DT). */
import { guardarReglaPrecioAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";

export interface ReglaPrecioFormProps {
  margenActual: string | null;
}

export function ReglaPrecioForm({ margenActual }: ReglaPrecioFormProps) {
  return (
    <div className="card p-4">
      <h2 className="mb-1 text-base font-semibold">{margenActual === null ? "Configurar margen" : "Nueva versión del margen"}</h2>
      <p className="mb-3 text-xs text-zinc-500">
        Precio final = costo de insumos + el margen aplicado sobre ese costo (margen 150 = costo × 2,5). Sin honorario fijo, sin variación por forma farmacéutica. Guardar acá NO modifica la regla
        actual: cierra la vigente y crea una versión nueva -- las cotizaciones ya calculadas mantienen el margen con el que se calcularon.
      </p>
      <SimpleForm action={guardarReglaPrecioAction} submitLabel="Guardar" className="max-w-xs">
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
            className="input"
          />
        </div>
      </SimpleForm>
    </div>
  );
}
