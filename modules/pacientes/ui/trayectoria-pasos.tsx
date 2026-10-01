/**
 * The journey strip of one receta: Ingreso -> Preparación -> Libro ->
 * Entrega -> Archivo, each with where it stands. Only the steps the session
 * may see arrive in `pasos` (see `AccesoTrayectoria`). State is always shown
 * as text, never only as color. Server component.
 */
import { ESTADO_PASO_LABELS, PASO_JORNADA_LABELS } from "../domain/trayectoria";
import type { EstadoPaso, PasoTrayectoria } from "../domain/trayectoria";

const TONE_CLASSES: Record<EstadoPaso, string> = {
  COMPLETO: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  EN_CURSO: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  PENDIENTE: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400",
  SIN_EFECTO: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  NO_APLICA: "border-zinc-200 bg-transparent text-zinc-400 dark:border-zinc-800 dark:text-zinc-500",
};

export function TrayectoriaPasos({ pasos }: { pasos: readonly PasoTrayectoria[] }) {
  return (
    <ol aria-label="Recorrido de la receta" className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {pasos.map((p, i) => (
        <li key={p.paso} className="flex items-center gap-2">
          <span className={`inline-flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-xs ${TONE_CLASSES[p.estado]}`}>
            <span className="font-medium">{PASO_JORNADA_LABELS[p.paso]}</span>
            <span>{ESTADO_PASO_LABELS[p.estado]}</span>
          </span>
          {i < pasos.length - 1 ? (
            <span aria-hidden="true" className="text-zinc-400">
              →
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
