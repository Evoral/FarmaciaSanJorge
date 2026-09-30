/**
 * Banner for a receta just saved: an optional success line plus the
 * notices of the automatic ficha/cotización generation
 * (domain/avisos-generacion.ts -- rebuilt from codes, never free text).
 * Used by /recetas after creating a receta and by /recetas/[id] after
 * editing one. Server Component (no interactivity).
 */
import type { ReactNode } from "react";
import { mensajeAviso } from "../domain/avisos-generacion";
import type { AvisoGeneracion } from "../domain/avisos-generacion";

export interface AvisosGeneracionProps {
  /** "Receta Nº X registrada." -- omitted when only the notices matter. */
  exito?: ReactNode;
  avisos: readonly AvisoGeneracion[];
  /** Shown after the notices, e.g. a link to the receta to generate the ficha by hand. */
  accion?: ReactNode;
}

export function AvisosGeneracion({ exito, avisos, accion }: AvisosGeneracionProps) {
  if (!exito && avisos.length === 0) return null;
  const hayAvisos = avisos.length > 0;
  return (
    <section
      role="status"
      aria-label={hayAvisos ? "Avisos de la generación automática" : "Receta registrada"}
      className={`mb-6 rounded border p-3 text-sm ${
        hayAvisos
          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      }`}
    >
      {exito ? <p className="font-medium">{exito}</p> : null}
      {hayAvisos ? (
        <>
          <p className={exito ? "mt-1" : "font-medium"}>{exito ? "Pero:" : "La receta se guardó, pero:"}</p>
          <ul className="list-disc pl-5">
            {avisos.map((aviso, i) => (
              <li key={i}>{mensajeAviso(aviso)}</li>
            ))}
          </ul>
          {accion ? <p className="mt-1">{accion}</p> : null}
        </>
      ) : null}
    </section>
  );
}
