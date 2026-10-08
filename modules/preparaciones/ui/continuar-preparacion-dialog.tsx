"use client";

/**
 * "Continuar" on a toma workspace ítem (/preparaciones/recetas/[recetaId]): the ítem's partidas in a dialog, without
 * leaving the receta. Opening it only reads (`getConfirmacionDeFichaAction`, fresh stock on every opening, stock reserved
 * by other preparaciones left out); the form is the same as `/preparaciones/[id]`'s (./confirmar-form.tsx: partidas,
 * enrase, motivo, warnings, re-authentication) and its "Reservar stock" creates the preparación and reserves its stock in
 * one transaction (`preparaciones.reservarStock`) -- no stock is descontado and nothing is written to the libro
 * recetario until "Imprimir etiqueta" (docs/specs/reserva-stock-preparacion.md). On success the dialog closes and the
 * page refreshes; an error stays inside it, keeping what was entered.
 *
 * Also "Modificar reserva" on a reserved ítem (`objetivo.reservaDePreparacionId`): the same dialog and form, read by
 * `getModificacionDeReservaAction` (the preparación's own reservas available to it, the form prefilled with them), and
 * "Guardar reserva" replaces its reserva (`preparaciones.modificarReserva`).
 *
 * Native `<dialog>` opened with `showModal()`, like ./ver-receta-pendiente-dialog.tsx: focus trap and Escape come from
 * the browser. Unlike that read-only preview, a click on the backdrop does NOT close it (it would lose what was
 * entered); "Cancelar", the close button or Escape do. The re-authentication prompt renders inside the dialog, so it
 * stays interactive on top of it.
 */
import { useId, useRef, useState } from "react";
import { CircleAlert, FlaskConical, PencilLine, X } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { ConfirmarPreparacionForm } from "./confirmar-form";
import { getConfirmacionDeFichaAction, getModificacionDeReservaAction } from "./actions";
import type { ConfirmacionDeFichaState } from "./action-state";

export interface ContinuarPreparacionDialogProps {
  /** The ítem's ficha técnica ("Continuar": reserve), or its reserved preparación ("Modificar reserva"). */
  objetivo: { fichaTecnicaId: string } | { reservaDePreparacionId: string };
  /** The ítem, shown under the dialog's title. */
  itemNombre: string;
}

export function ContinuarPreparacionDialog({ objetivo, itemNombre }: ContinuarPreparacionDialogProps) {
  const modificar = "reservaDePreparacionId" in objetivo;
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Bumped on every opening and closing: a late answer from a previous opening is ignored.
  const aperturaRef = useRef(0);
  const tituloId = useId();
  const [contenido, setContenido] = useState<ConfirmacionDeFichaState | null>(null);

  async function abrir() {
    const apertura = ++aperturaRef.current;
    setContenido(null);
    dialogRef.current?.showModal();
    const resultado =
      "reservaDePreparacionId" in objetivo
        ? await getModificacionDeReservaAction(objetivo.reservaDePreparacionId)
        : await getConfirmacionDeFichaAction(objetivo.fichaTecnicaId);
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
      {modificar ? (
        <button type="button" onClick={abrir} aria-haspopup="dialog" className="btn btn-secondary">
          <PencilLine className="size-4" aria-hidden />
          Modificar reserva
        </button>
      ) : (
        <button type="button" onClick={abrir} aria-haspopup="dialog" className="btn btn-primary">
          <FlaskConical className="size-4" aria-hidden />
          Continuar
        </button>
      )}
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
                {modificar ? "Modificar reserva" : "Reservar stock"}
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
              <p className="text-sm text-zinc-600">Revisá las partidas de cada línea ({contenido.datos.lineas.length}) y reservá el stock. Se pide reautenticación.</p>
              <ConfirmarPreparacionForm
                datos={contenido.datos}
                destino={objetivo}
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
