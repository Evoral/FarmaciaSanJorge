"use client";

/**
 * P13 (openspec/changes/lotes-elaborados, pesada-real delta): the expected weight over the chosen lots is below one
 * balance division. The system does not limit it -- the pesada real is prefilled with the exact quantity -- but it
 * offers the droga's diluted lots ("Usar") and creating a dilución in a dialog, so the pesaje keeps what was typed.
 * The new dilución is chosen for the línea once the data that lists it is reloaded (`onDilucionCreada`).
 * `sugerencia` (migration 0120, `droga.sugerir_dilucion`): the dose CAN be weighed, but the droga asks to always use a
 * diluted lot for precision -- same offer, worded as a suggestion.
 */
import { FlaskConical, Lightbulb, TriangleAlert } from "lucide-react";
import { formatNumero } from "@/shared/format/cantidad";
import { ElaborarLoteDialog } from "@/modules/stock/ui/elaborar-lote-dialog";
import type { LineaPantalla } from "../application/datos-confirmacion";

export interface AvisoBajoLaBalanzaProps {
  linea: LineaPantalla;
  /** Not below the balance: the droga asks for a diluted lot for precision (migration 0120). */
  sugerencia?: boolean;
  elegidas: readonly string[];
  onUsar: (partidaId: string) => void;
  /** `stock.lote.elaborar`: offers "Crear dilución". */
  puedeElaborar: boolean;
  /** The dilución was elaborated: reload the línea's lots and choose it. */
  onDilucionCreada: (partidaId: string) => void;
}

export function AvisoBajoLaBalanza({ linea, sugerencia = false, elegidas, onUsar, puedeElaborar, onDilucionCreada }: AvisoBajoLaBalanzaProps) {
  const diluidas = linea.partidasElegibles.filter((p) => p.esDilucion && !elegidas.includes(p.id));
  return (
    <div role="status" className={sugerencia ? "alert alert-info" : "alert alert-warn"}>
      {sugerencia ? <Lightbulb aria-hidden /> : <TriangleAlert aria-hidden />}
      <div className="flex flex-1 flex-col gap-2">
        {sugerencia ? (
          <p>
            <strong>Sugerencia: Usar lote diluido para mayor precisión.</strong>
            {puedeElaborar ? " Elegí un lote diluido o creá una dilución." : diluidas.length > 0 ? " Elegí un lote diluido." : ""}
          </p>
        ) : (
          <p>
            <strong>La dosis está por debajo de la balanza.</strong> Podés diluirla en el momento y anotar lo que pesaste
            {puedeElaborar ? ", usar un lote diluido o crear una dilución." : " o usar un lote diluido."}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {diluidas.map((p) => (
            <button key={p.id} type="button" onClick={() => onUsar(p.id)} className="btn btn-secondary btn-sm">
              Usar lote {p.lote}
              {p.potenciaDeclarada !== null ? ` (${formatNumero(p.potenciaDeclarada, 6)} %)` : ""}
            </button>
          ))}
          {puedeElaborar ? (
            <ElaborarLoteDialog
              label="Crear dilución"
              icon={<FlaskConical className="size-4" aria-hidden />}
              className="btn btn-ghost btn-sm"
              drogaId={linea.drogaId}
              onElaborado={onDilucionCreada}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
