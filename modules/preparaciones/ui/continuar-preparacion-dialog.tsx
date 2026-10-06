"use client";

/**
 * "Continuar" on a toma workspace ítem (/preparaciones/recetas/[recetaId]): the ítem's confirmation in a dialog, without
 * leaving the receta. Opening it only reads (`getConfirmacionDeFichaAction`, fresh stock on every opening); the form is
 * the same as `/preparaciones/[id]`'s (./confirmar-form.tsx: partidas, enrase, motivo, warnings, re-authentication) and
 * its "Confirmar y descontar stock" creates and confirms the preparación in one transaction. On success the dialog
 * closes and the page refreshes; an error stays inside it, keeping what was entered.
 *
 * Native `<dialog>` opened with `showModal()`, like ./ver-receta-pendiente-dialog.tsx: focus trap and Escape come from
 * the browser. Unlike that read-only preview, a click on the backdrop does NOT close it (it would lose what was
 * entered); "Cancelar", the close button or Escape do. The re-authentication prompt renders inside the dialog, so it
 * stays interactive on top of it.
 */
import { useId, useRef, useState } from "react";
import { CircleAlert, FlaskConical, X } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { ConfirmarPreparacionForm } from "./confirmar-form";
import { getConfirmacionDeFichaAction } from "./actions";
import type { ConfirmacionDeFichaState } from "./action-state";

export interface ContinuarPreparacionDialogProps {
  fichaTecnicaId: string;
  /** The ítem, shown under the dialog's title. */
  itemNombre: string;
}

export function ContinuarPreparacionDialog({ fichaTecnicaId, itemNombre }: ContinuarPreparacionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Bumped on every opening and closing: a late answer from a previous opening is ignored.
  const aperturaRef = useRef(0);
  const tituloId = useId();
  const [contenido, setContenido] = useState<ConfirmacionDeFichaState | null>(null);

  async function abrir() {
    const apertura = ++aperturaRef.current;
    setContenido(null);
    dialogRef.current?.showModal();
    const resultado = await getConfirmacionDeFichaAction(fichaTecnicaId);
    if (aperturaRef.current === apertura) setContenido(resultado);
  }

  function cerrar() {
    dialogRef.current?.close();
  }

  const cancelar = (
    <button type="button" onClick={cerrar} className="btn btn-secondary">
      Cancelar
    </button>
  );

  return (
    <>
      <button type="button" onClick={abrir} aria-haspopup="dialog" className="btn btn-primary">
        <FlaskConical className="size-4" aria-hidden />
        Continuar
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={tituloId}
        // Escape or `close()`: the next opening starts over with fresh data.
        onClose={() => {
          aperturaRef.current++;
          setContenido(null);
        }}
        className="card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-4xl p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={tituloId} className="text-lg font-semibold">
                Confirmar preparación
              </h2>
              <p className="truncate text-sm text-zinc-500">{itemNombre}</p>
            </div>
            <button type="button" onClick={cerrar} aria-label="Cerrar" className="btn btn-ghost btn-sm">
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {contenido === null ? (
            <p role="status" className="text-sm text-zinc-500">
              Cargando…
            </p>
          ) : contenido.status === "error" ? (
            <>
              <div role="alert" className="alert alert-danger">
                <CircleAlert aria-hidden />
                <p>{contenido.message}</p>
              </div>
              <div className="flex justify-end">{cancelar}</div>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-600">Revisá las partidas de cada línea ({contenido.datos.lineas.length}) y confirmá. Se pide reautenticación.</p>
              <ConfirmarPreparacionForm
                datos={contenido.datos}
                destino={{ fichaTecnicaId }}
                extraActions={cancelar}
                onSuccess={(message) => {
                  if (message) toast(message);
                  cerrar();
                }}
              />
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
