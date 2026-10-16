"use client";

/**
 * The alta de insumo of `/catalogos/drogas?nueva=1` in a dialog, for screens that need a droga that does not exist yet
 * without leaving them (e.g. a "sin asociar" row of a price list import). It is the SAME `DrogaForm`, so any change to
 * the alta shows up in both places; only the frame differs. On success the dialog closes and hands the created droga
 * to `onCreada` (the form raises the toast; the screen mounts the Toaster).
 *
 * Controlled by the caller (`abierta`); the form only mounts while open, so each opening starts from `nombreInicial`.
 * Native `<dialog>` + `showModal()` like modules/preparaciones/ui/ver-receta-pendiente-dialog.tsx: focus trap and
 * Escape come from the browser, a press-and-release on the backdrop closes it. Render it OUTSIDE any other `<form>`
 * (forms can not nest, and React would bubble this form's submit to the outer one).
 */
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { DrogaForm, type UnidadOpcion } from "./droga-form";
import type { DrogaCreada } from "./action-state";

export interface NuevaDrogaDialogProps {
  abierta: boolean;
  /** The name the alta starts with. */
  nombreInicial: string;
  /** Vigente units for the unidad base (`listUnidadesVigentesParaDroga`). */
  unidades: UnidadOpcion[];
  /** Optional line under the title, e.g. where the alta was opened from. */
  subtitulo?: string;
  onCreada: (droga: DrogaCreada) => void;
  onCerrar: () => void;
}

export function NuevaDrogaDialog({ abierta, nombreInicial, unidades, subtitulo, onCreada, onCerrar }: NuevaDrogaDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const presionoFondoRef = useRef(false);
  const tituloId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (abierta && !dialog.open) dialog.showModal();
    if (!abierta && dialog.open) dialog.close();
  }, [abierta]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={tituloId}
      // Escape (native) and every other way out end here: the caller's state follows.
      onClose={onCerrar}
      onPointerDown={(event) => {
        presionoFondoRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const cerrarPorFondo = presionoFondoRef.current && event.target === event.currentTarget;
        presionoFondoRef.current = false;
        if (cerrarPorFondo) dialogRef.current?.close();
      }}
      className="card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-3xl p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {abierta ? (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 id={tituloId} className="text-lg font-semibold">
                Nuevo insumo
              </h2>
              {subtitulo ? <p className="text-[0.8125rem] text-zinc-600 dark:text-zinc-400">{subtitulo}</p> : null}
            </div>
            <button type="button" onClick={() => dialogRef.current?.close()} className="btn btn-ghost btn-sm btn-icon" aria-label="Cerrar el alta de insumo">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <DrogaForm mode="crear" unidades={unidades} disabled={false} nombreInicial={nombreInicial} onCreada={onCreada} />
        </div>
      ) : null}
    </dialog>
  );
}
