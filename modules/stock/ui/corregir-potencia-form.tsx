"use client";

/** `/partidas/[id]`'s "corregir pureza / actividad" form. The page provides the surrounding panel. */
import { useState } from "react";
import { corregirPotenciaPartidaAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
import { NumeroInput } from "@/shared/ui/numero-input";
import { formatNumero } from "@/shared/format/cantidad";
import { parsearActividadOValor } from "../domain/partida";

export interface CorregirPotenciaFormProps {
  partidaId: string;
  potenciaActual: string | null;
  actividadActual?: string | null;
}

export function CorregirPotenciaForm({ partidaId, potenciaActual, actividadActual = null }: CorregirPotenciaFormProps) {
  const [actividadTexto, setActividadTexto] = useState("");
  const esUi = actividadActual !== null;
  const actividadParsed = esUi && actividadTexto.trim() ? parsearActividadOValor(actividadTexto) : null;

  return (
    <SimpleForm
      action={corregirPotenciaPartidaAction}
      submitLabel="Guardar corrección"
      onSuccess={() => setActividadTexto("")}
    >
      <input type="hidden" name="id" value={partidaId} />
      {esUi ? (
        <div className="field">
          <label htmlFor="actividadDeclaradaNueva" className="field-label">
            Actividad nueva (U.I.)
          </label>
          <input
            id="actividadDeclaradaNueva"
            name="actividadDeclaradaNueva"
            required
            placeholder="ej. 1000 U.I. cada 10 g o 100"
            value={actividadTexto}
            onChange={(e) => setActividadTexto(e.target.value)}
            aria-describedby="actividadDeclaradaNueva-ayuda"
            className="input font-mono"
          />
          <p id="actividadDeclaradaNueva-ayuda" className="field-help">
            Actual: <span className="font-mono">{formatNumero(actividadActual)} U.I./g</span>.
            {actividadParsed ? (
              <span className="ml-1 font-mono">
                {actividadParsed.ok ? `(= ${formatNumero(actividadParsed.uiPorGramo)} U.I./g)` : actividadParsed.mensaje}
              </span>
            ) : null}
          </p>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="potenciaDeclaradaNueva" className="field-label">
            Pureza nueva (%)
          </label>
          <NumeroInput
            id="potenciaDeclaradaNueva"
            name="potenciaDeclaradaNueva"
            placeholder="100"
            aria-describedby="potenciaDeclaradaNueva-ayuda"
            className="input font-mono"
          />
          <p id="potenciaDeclaradaNueva-ayuda" className="field-help">
            Actual: <span className="font-mono">{potenciaActual ? `${potenciaActual} %` : "No declarada (100 %)"}</span>. Dejar vacío o 100 para restablecer sin corrección.
          </p>
        </div>
      )}
      <div className="field">
        <label htmlFor="motivo-potencia" className="field-label">
          Motivo de la corrección
        </label>
        <textarea id="motivo-potencia" name="motivo" required rows={2} className="input" />
      </div>
    </SimpleForm>
  );
}
