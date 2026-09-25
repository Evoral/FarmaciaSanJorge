"use client";

/** `/stock/partidas/[id]`'s "corregir costo" form (FASE 5 point 5.5, DT/ADM). */
import { corregirCostoPartidaAction } from "./actions";
import { SimpleForm } from "./simple-form";

export interface CorregirCostoFormProps {
  partidaId: string;
  costoUnitarioActual: string;
}

export function CorregirCostoForm({ partidaId, costoUnitarioActual }: CorregirCostoFormProps) {
  return (
    <div className="card p-4">
      <h2 className="mb-3 text-base font-semibold">Corregir costo de la partida</h2>
      <SimpleForm action={corregirCostoPartidaAction} submitLabel="Guardar corrección" className="flex max-w-md flex-col gap-3">
        <input type="hidden" name="id" value={partidaId} />
        <div className="flex flex-col gap-1">
          <label htmlFor="costoUnitarioNuevo" className="text-sm font-medium">
            Costo unitario nuevo (actual: {costoUnitarioActual})
          </label>
          <input
            id="costoUnitarioNuevo"
            name="costoUnitarioNuevo"
            type="text"
            inputMode="decimal"
            required
            className="input"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="motivo" className="text-sm font-medium">
            Motivo de la corrección
          </label>
          <textarea id="motivo" name="motivo" required rows={2} className="input" />
        </div>
      </SimpleForm>
    </div>
  );
}
