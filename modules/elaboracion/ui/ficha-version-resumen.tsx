/**
 * One ficha técnica version's heading -- "Versión N — X líneas de pesaje", who generated it and when -- plus its
 * "Imprimir PDF" link when allowed. Shared by the ficha técnica screen (/recetas/[id]/items/[itemId]/ficha-tecnica) and
 * the toma workspace (/preparaciones/recetas/[recetaId]). Server-safe presentational component; the date comes already
 * formatted (each screen formats it its own way).
 */
import type { ReactNode } from "react";

export interface FichaVersionResumenProps {
  fichaTecnicaId: string;
  version: number;
  cantidadLineas: number;
  generadaEnTexto: string;
  generadaPorNombre: string;
  puedeImprimir: boolean;
  /** Extra lines under the heading (e.g. the associated preparación). */
  detalle?: ReactNode;
  /** Extra actions next to "Imprimir PDF". */
  acciones?: ReactNode;
}

export function FichaVersionResumen({
  fichaTecnicaId,
  version,
  cantidadLineas,
  generadaEnTexto,
  generadaPorNombre,
  puedeImprimir,
  detalle,
  acciones,
}: FichaVersionResumenProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-sm font-medium">
          Versión {version} — {cantidadLineas} línea{cantidadLineas === 1 ? "" : "s"} de pesaje
        </p>
        <p className="text-xs text-zinc-500">
          Generada el {generadaEnTexto} por {generadaPorNombre}
        </p>
        {detalle}
      </div>
      <div className="flex gap-2">
        {puedeImprimir ? (
          <a href={`/api/fichas-tecnicas/${fichaTecnicaId}/pdf`} target="_blank" rel="noreferrer" className="btn btn-secondary">
            Imprimir PDF
          </a>
        ) : null}
        {acciones}
      </div>
    </div>
  );
}
