"use client";

/**
 * "Exportar envíos" (docs/specs/envios-repartidores.md, "Listado de entregas"): the button in the `/entregas` header
 * opens a dialog to pick the repartidor (required; inactive ones are listed too, marked "(inactivo)", because they can
 * still carry pending envíos) and the fecha de envío (preselected to today in the farmacia's time zone, which the page
 * computes; clearable for "every pending envío"). "Exportar" opens the "Hoja de envíos" PDF in a new tab.
 *
 * Only the repartidor's uuid and the fecha go in the URL (E11). Native `<dialog>` opened with `showModal()`, same
 * pattern as `modules/preparaciones/ui/imprimir-etiqueta-dialog.tsx`; the PDF opens from the button's own click (a user
 * gesture, so no popup blocker).
 */
import { useId, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { Printer } from "lucide-react";
import { Combobox, type ComboboxOption } from "@/shared/ui/combobox";
import { DateInput } from "@/shared/ui/date-input";
import { buscarRepartidoresParaCombobox } from "@/modules/repartidores/ui/repartidor-search";

const CLASE_DIALOG =
  "card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-md overflow-visible p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900";

/** Active and inactive repartidores: an inactive one can still have pending envíos (E3). */
const buscarRepartidores = buscarRepartidoresParaCombobox(false);

/** `GET /api/entregas/envios/pdf` for the chosen repartidor; `fecha` is left out when cleared (every pending envío). */
export function hrefEnviosPdf(repartidorId: string, fecha: string): string {
  const params = new URLSearchParams({ repartidorId });
  if (fecha) params.set("fecha", fecha);
  return `/api/entregas/envios/pdf?${params.toString()}`;
}

export interface ExportarEnviosDialogProps {
  /** Today (YYYY-MM-DD) in the farmacia's time zone: the preselected fecha de envío. */
  fechaHoy: string;
}

export function ExportarEnviosDialog({ fechaHoy }: ExportarEnviosDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const presionoFondoRef = useRef(false);
  const tituloId = useId();
  const fechaId = useId();
  const [repartidor, setRepartidor] = useState<ComboboxOption | null>(null);
  const [fecha, setFecha] = useState(fechaHoy);

  function cerrar() {
    dialogRef.current?.close();
  }

  function exportar() {
    if (!repartidor) return;
    window.open(hrefEnviosPdf(repartidor.value, fecha), "_blank", "noreferrer");
    cerrar();
  }

  // The content wrapper fills the dialog, so a target that is the dialog itself is the backdrop. Close only when the
  // press AND the click both landed there (a drag from inside released over the backdrop must not close it).
  function alPresionar(event: PointerEvent<HTMLDialogElement>) {
    presionoFondoRef.current = event.target === event.currentTarget;
  }
  function alHacerClick(event: MouseEvent<HTMLDialogElement>) {
    const cerrarPorFondo = presionoFondoRef.current && event.target === event.currentTarget;
    presionoFondoRef.current = false;
    if (cerrarPorFondo) cerrar();
  }

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} aria-haspopup="dialog" className="btn btn-secondary">
        <Printer className="size-4" aria-hidden />
        Exportar envíos
      </button>
      <dialog ref={dialogRef} aria-labelledby={tituloId} onPointerDown={alPresionar} onClick={alHacerClick} className={CLASE_DIALOG}>
        <div className="p-5">
          <h2 id={tituloId} className="text-lg font-semibold">
            Exportar envíos
          </h2>
          <p className="mb-4 text-sm text-zinc-500">Hoja con los envíos pendientes de firma que lleva un repartidor, lista para imprimir.</p>

          <div className="flex flex-col gap-4">
            <Combobox
              label="Repartidor"
              placeholder="Buscar repartidor por nombre o teléfono"
              search={buscarRepartidores}
              value={repartidor}
              onChange={setRepartidor}
              helperText="Los repartidores inactivos aparecen marcados: pueden tener envíos pendientes."
            />

            <div className="field">
              <label htmlFor={fechaId} className="field-label">
                Fecha de envío
              </label>
              <DateInput id={fechaId} value={fecha} onValueChange={setFecha} />
              <p className="field-help">
                {fecha ? (
                  <>
                    Solo los envíos de ese día.{" "}
                    <button type="button" onClick={() => setFecha("")} className="font-medium text-primary underline">
                      Ver todos los pendientes
                    </button>
                  </>
                ) : (
                  "Se incluyen todos los envíos pendientes del repartidor."
                )}
              </p>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={cerrar} className="btn btn-secondary btn-sm">
              Cancelar
            </button>
            <button type="button" onClick={exportar} disabled={!repartidor} className="btn btn-primary btn-sm">
              <Printer className="size-3.5" aria-hidden />
              Exportar
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
