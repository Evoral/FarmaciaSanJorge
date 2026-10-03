"use client";

/** `/stock/partidas/[id]`'s "corregir costo" form (FASE 5 point 5.5, DT/ADM). The page provides the surrounding panel. */
import { corregirCostoPartidaAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";

export interface CorregirCostoFormProps {
  partidaId: string;
  costoUnitarioActual: string;
}

export function CorregirCostoForm({ partidaId, costoUnitarioActual }: CorregirCostoFormProps) {
  return (
    <SimpleForm action={corregirCostoPartidaAction} submitLabel="Guardar corrección">
      <input type="hidden" name="id" value={partidaId} />
      <div className="field">
        <label htmlFor="costoUnitarioNuevo" className="field-label">
          Costo unitario nuevo
        </label>
        <input id="costoUnitarioNuevo" name="costoUnitarioNuevo" type="text" inputMode="decimal" required aria-describedby="costoUnitarioNuevo-ayuda" className="input font-mono" />
        <p id="costoUnitarioNuevo-ayuda" className="field-help">
          Actual: <span className="font-mono">{costoUnitarioActual}</span>
        </p>
      </div>
      <div className="field">
        <label htmlFor="motivo" className="field-label">
          Motivo de la corrección
        </label>
        <textarea id="motivo" name="motivo" required rows={2} className="input" />
      </div>
    </SimpleForm>
  );
}
