"use client";

/** `/partidas/[id]`'s "corregir pureza" form (openspec/changes/corregir-potencia-partida/proposal.md). The page provides the surrounding panel. */
import { corregirPotenciaPartidaAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";

export interface CorregirPotenciaFormProps {
  partidaId: string;
  potenciaActual: string | null;
}

export function CorregirPotenciaForm({ partidaId, potenciaActual }: CorregirPotenciaFormProps) {
  return (
    <SimpleForm action={corregirPotenciaPartidaAction} submitLabel="Guardar corrección">
      <input type="hidden" name="id" value={partidaId} />
      <div className="field">
        <label htmlFor="potenciaDeclaradaNueva" className="field-label">
          Pureza nueva (%)
        </label>
        <input
          id="potenciaDeclaradaNueva"
          name="potenciaDeclaradaNueva"
          type="text"
          inputMode="decimal"
          placeholder="100"
          aria-describedby="potenciaDeclaradaNueva-ayuda"
          className="input font-mono"
        />
        <p id="potenciaDeclaradaNueva-ayuda" className="field-help">
          Actual: <span className="font-mono">{potenciaActual ? `${potenciaActual} %` : "No declarada (100 %)"}</span>. Dejar vacío o 100 para restablecer sin corrección.
        </p>
      </div>
      <div className="field">
        <label htmlFor="motivo-potencia" className="field-label">
          Motivo de la corrección
        </label>
        <textarea id="motivo-potencia" name="motivo" required rows={2} className="input" />
      </div>
    </SimpleForm>
  );
}
