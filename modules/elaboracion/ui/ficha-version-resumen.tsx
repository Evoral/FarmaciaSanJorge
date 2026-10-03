/**
 * One ficha técnica version's heading -- "Versión N", its líneas de pesaje, who generated it and when -- plus its
 * "Imprimir PDF" link when allowed. Shared by the ficha técnica screen (/recetas/[id]/items/[itemId]/ficha-tecnica) and
 * the toma workspace (/preparaciones/recetas/[recetaId]). Server-safe presentational component; the date comes already
 * formatted (each screen formats it its own way).
 */
import { Printer } from "lucide-react";
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="index-badge w-auto min-w-[1.5rem] px-1.5" aria-hidden>
          v{version}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-900">
            Versión {version}
            <span className="ml-2 font-normal text-zinc-500 tabular-nums">
              {cantidadLineas} {cantidadLineas === 1 ? "línea" : "líneas"} de pesaje
            </span>
          </p>
          <p className="text-xs text-zinc-500">
            Generada el <span className="tabular-nums">{generadaEnTexto}</span> por {generadaPorNombre}
          </p>
          {detalle}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {puedeImprimir ? (
          <a href={`/api/fichas-tecnicas/${fichaTecnicaId}/pdf`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
            <Printer className="size-3.5" aria-hidden />
            Imprimir PDF
          </a>
        ) : null}
        {acciones}
      </div>
    </div>
  );
}
