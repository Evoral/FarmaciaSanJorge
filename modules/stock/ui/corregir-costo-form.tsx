"use client";

/** `/partidas/[id]`'s "corregir costo" form (FASE 5 point 5.5, DT/ADM). The page provides the surrounding panel. */
import { corregirCostoPartidaAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
import { CostoPorUnidadField, type UnidadCosto } from "./costo-por-unidad-field";

export interface CorregirCostoFormProps {
  partidaId: string;
  costoUnitarioActual: string;
  unidadBaseId: string;
  /** Vigente units of the droga's magnitude. */
  unidades: readonly UnidadCosto[];
}

export function CorregirCostoForm({ partidaId, costoUnitarioActual, unidadBaseId, unidades }: CorregirCostoFormProps) {
  return (
    <SimpleForm action={corregirCostoPartidaAction} submitLabel="Guardar corrección">
      <input type="hidden" name="id" value={partidaId} />
      <CostoPorUnidadField unidades={unidades} unidadBaseId={unidadBaseId} costoActual={costoUnitarioActual} />
      <div className="field">
        <label htmlFor="motivo" className="field-label">
          Motivo de la corrección
        </label>
        <textarea id="motivo" name="motivo" required rows={2} className="input" />
      </div>
    </SimpleForm>
  );
}
