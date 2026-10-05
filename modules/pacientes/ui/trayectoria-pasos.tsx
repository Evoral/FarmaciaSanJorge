/**
 * The journey strip of one receta: Ingreso -> Preparación -> Libro -> Entrega -> Archivo, each with where it stands
 * (shared `.stepper`: done steps green, the one in progress ink, "sin efecto" red, "no aplica" faded). Only the steps
 * the session may see arrive in `pasos` (see `AccesoTrayectoria`). State is always shown as text, never only as
 * color. Server component.
 */
import { Check, Minus, X } from "lucide-react";
import { ESTADO_PASO_LABELS, PASO_JORNADA_LABELS } from "../domain/trayectoria";
import type { EstadoPaso, PasoTrayectoria } from "../domain/trayectoria";

const DOT_CLASSES: Partial<Record<EstadoPaso, string>> = {
  SIN_EFECTO: "border-red-300 bg-red-50 text-red-700",
};

function IconoPaso({ estado, numero }: { estado: EstadoPaso; numero: number }) {
  if (estado === "COMPLETO") return <Check className="size-3" strokeWidth={2.5} />;
  if (estado === "SIN_EFECTO") return <X className="size-3" strokeWidth={2.5} />;
  if (estado === "NO_APLICA") return <Minus className="size-3" />;
  return <>{numero}</>;
}

export function TrayectoriaPasos({ pasos }: { pasos: readonly PasoTrayectoria[] }) {
  return (
    <ol aria-label="Recorrido de la receta" className="stepper mb-0">
      {pasos.map((p, i) => (
        <li
          key={p.paso}
          data-state={p.estado === "COMPLETO" ? "done" : undefined}
          aria-current={p.estado === "EN_CURSO" ? "step" : undefined}
          className={p.estado === "NO_APLICA" ? "opacity-60" : undefined}
        >
          <span className={`stepper-dot ${DOT_CLASSES[p.estado] ?? ""}`} aria-hidden>
            <IconoPaso estado={p.estado} numero={i + 1} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-medium text-zinc-900">{PASO_JORNADA_LABELS[p.paso]}</span>
            <span className={`text-xs ${p.estado === "SIN_EFECTO" ? "text-red-700" : "text-zinc-500"}`}>{ESTADO_PASO_LABELS[p.estado]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
