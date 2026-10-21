"use client";

/**
 * "Imprimir etiqueta": the button opens a "Seleccionar tamaño y posición" dialog with the
 * active sizes the administrator configured (modules/etiqueta-tamanos) and the cell of the
 * sheet to print in (`./posicion-en-hoja.tsx`); confirming opens the etiqueta PDF -- the whole
 * sheet, with the etiqueta in that cell (docs/specs/hoja-etiquetas.md) -- in a new tab. Native
 * `<dialog>` opened with `showModal()` (same pattern as `./ver-receta-pendiente-dialog.tsx`):
 * focus is trapped and returned to the trigger by the browser, Escape closes it natively, and a
 * click on the backdrop closes it too.
 *
 * Plain data only: the page has already read the sizes and the sheet (no client fetch), as
 * plain numbers -- never Prisma `Decimal`s, which can not cross into a client component. The
 * sizes are only the ones that fit the sheet.
 *
 * `abrirAlMontar`: opens the dialog by itself once mounted -- right after
 * ./etiqueta-para-imprimir.tsx generated a missing etiqueta. The PDF still opens
 * from the dialog's own "Imprimir" click (a user gesture, so no popup blocker).
 *
 * `SeleccionarEtiquetasDialog`: the toma workspace's "Imprimir etiquetas"
 * (./reserva-acciones.tsx) -- the same dialog with one row per confirmed ítem,
 * each with its own size, its own position and its own "Imprimir" (each click opens that
 * ítem's single-etiqueta PDF: one user gesture per tab, so no popup blocker). Nothing about
 * positions is persisted: inside the open dialog, the rows the user did not touch default to
 * the cell after the last printed one (`../domain/celda-por-defecto.ts`, R11).
 */
import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, Printer, TriangleAlert } from "lucide-react";
import { conservarCelda, grillaHoja } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { Celda, HojaEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import { formatearTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import type { EtiquetaTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { celdaPorDefecto, type UltimaImpresion } from "../domain/celda-por-defecto";
import { hrefEtiquetaPdf } from "../domain/etiqueta";
import { PosicionEnHoja } from "./posicion-en-hoja";

const CLASE_DIALOG =
  "card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900";

const CELDA_INICIAL: Celda = { columna: 1, fila: 1 };

/**
 * The dialog's backdrop close. The content wrapper fills the dialog, so a target that is the dialog itself is the
 * backdrop. Close only when the press AND the click both landed there: a drag that starts inside (e.g. selecting text)
 * and is released over the backdrop still fires a click on the dialog.
 */
function useCierrePorFondo(dialogRef: RefObject<HTMLDialogElement | null>) {
  const presionoFondoRef = useRef(false);
  return {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => {
      presionoFondoRef.current = event.target === event.currentTarget;
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      const cerrarPorFondo = presionoFondoRef.current && event.target === event.currentTarget;
      presionoFondoRef.current = false;
      if (cerrarPorFondo) dialogRef.current?.close();
    },
  };
}

/** Opens the dialog by itself once mounted (or when the flag turns on). */
function useAbrirAlMontar(dialogRef: RefObject<HTMLDialogElement | null>, abrirAlMontar: boolean) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (abrirAlMontar && dialog && !dialog.open) dialog.showModal();
  }, [dialogRef, abrirAlMontar]);
}

/** The first size is preselected; a stale choice (the list changed meanwhile) falls back to it. */
function tamanoElegido(tamanos: readonly EtiquetaTamano[], elegido: string | undefined): EtiquetaTamano | undefined {
  return tamanos.find((t) => t.id === elegido) ?? tamanos[0];
}

function abrirPdf(preparacionId: string, tamanoId: string, celda: Celda) {
  window.open(hrefEtiquetaPdf(preparacionId, tamanoId, celda), "_blank", "noreferrer");
}

function SinTamanos() {
  return (
    <div role="note" className="alert alert-warn">
      <TriangleAlert aria-hidden />
      <p>No hay tamaños de etiqueta activos que entren en la hoja. Solicite al administrador que habilite uno.</p>
    </div>
  );
}

/** R10: a browser's "fit to page" shifts the grid, so the print must be at real size. */
function AvisoTamanoReal() {
  return (
    <p role="note" className="mt-3 flex items-start gap-1.5 text-xs text-zinc-600">
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber-600" aria-hidden />
      Imprimí en tamaño real (100 %). Si la impresión se ajusta a la página, la etiqueta se corre.
    </p>
  );
}

function OpcionesTamano({ tamanos }: { tamanos: readonly EtiquetaTamano[] }) {
  return tamanos.map((tamano) => (
    <option key={tamano.id} value={tamano.id}>
      {formatearTamano(tamano)}
    </option>
  ));
}

export interface ImprimirEtiquetaDialogProps {
  preparacionId: string;
  /** The active sizes that fit the sheet. */
  tamanos: readonly EtiquetaTamano[];
  hoja: HojaEtiqueta;
  /** `"secondary"` + `small` in table rows, `"primary"` on the preparación screen. Defaults to the row style. */
  variant?: "primary" | "secondary";
  small?: boolean;
  /** Open the dialog as soon as this mounts (or the flag turns on). */
  abrirAlMontar?: boolean;
  /** The etiqueta was already printed: the button reads "Reimprimir", at the same fixed width as "Imprimir etiqueta". */
  reimprimir?: boolean;
}

export function ImprimirEtiquetaDialog({ preparacionId, tamanos, hoja, variant = "secondary", small = true, abrirAlMontar = false, reimprimir = false }: ImprimirEtiquetaDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cierrePorFondo = useCierrePorFondo(dialogRef);
  const tituloId = useId();
  const selectId = useId();
  const [elegido, setElegido] = useState("");
  const [celdaElegida, setCeldaElegida] = useState<Celda>(CELDA_INICIAL);
  useAbrirAlMontar(dialogRef, abrirAlMontar);

  const tamano = tamanoElegido(tamanos, elegido);
  const sinTamanos = !tamano;
  const celda = tamano ? conservarCelda(grillaHoja(hoja, tamano), celdaElegida) : CELDA_INICIAL;

  function cerrar() {
    dialogRef.current?.close();
  }

  /** R8: a new size keeps the chosen cell if it still fits its grid, else falls back to 1 / 1. */
  function cambiarTamano(id: string) {
    const nuevo = tamanos.find((t) => t.id === id);
    setElegido(id);
    if (nuevo) setCeldaElegida(conservarCelda(grillaHoja(hoja, nuevo), celda));
  }

  function imprimir() {
    if (!tamano) return;
    abrirPdf(preparacionId, tamano.id, celda);
    cerrar();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        aria-haspopup="dialog"
        className={`btn ${variant === "primary" ? "btn-primary" : "btn-secondary"}${small ? " btn-sm relative w-44 justify-center px-8" : ""}`}
      >
        <Printer className={small ? "absolute left-2.5 size-3.5" : "size-4"} aria-hidden />
        {reimprimir ? "Reimprimir" : "Imprimir etiqueta"}
      </button>
      <dialog ref={dialogRef} aria-labelledby={tituloId} {...cierrePorFondo} className={`${CLASE_DIALOG} max-w-md`}>
        <div className="p-5">
          <h2 id={tituloId} className="mb-3 text-lg font-semibold">
            Seleccionar tamaño y posición
          </h2>

          {tamano ? (
            <div className="flex flex-col gap-4">
              <div className="field">
                <label htmlFor={selectId} className="field-label">
                  Tamaño
                </label>
                <select id={selectId} value={tamano.id} onChange={(event) => cambiarTamano(event.target.value)} className="input">
                  <OpcionesTamano tamanos={tamanos} />
                </select>
              </div>
              <div className="field">
                <span className="field-label">Posición en la hoja</span>
                <PosicionEnHoja hoja={hoja} tamano={tamano} celda={celda} onChange={setCeldaElegida} />
              </div>
            </div>
          ) : (
            <SinTamanos />
          )}
          {tamano ? <AvisoTamanoReal /> : null}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={cerrar} className="btn btn-secondary btn-sm">
              Cancelar
            </button>
            <button type="button" onClick={imprimir} disabled={sinTamanos} className="btn btn-primary btn-sm">
              Imprimir
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/** One confirmed ítem of the receta whose etiqueta is generated. */
export interface EtiquetaDeItemParaImprimir {
  preparacionId: string;
  /** "Ítem N" of the toma workspace. */
  numero: number;
  nombre: string;
  /** Why it can no longer be printed (asiento sin efecto, receta ANULADA -- spec R22); listed disabled with this reason. */
  noImprimible?: string | null;
}

export interface SeleccionarEtiquetasDialogProps {
  /** In ítem order. */
  etiquetas: readonly EtiquetaDeItemParaImprimir[];
  /** The active sizes that fit the sheet. */
  tamanos: readonly EtiquetaTamano[];
  hoja: HojaEtiqueta;
  /** Open the dialog as soon as this mounts (or the flag turns on): right after the confirmation. */
  abrirAlMontar?: boolean;
}

export function SeleccionarEtiquetasDialog({ etiquetas, tamanos, hoja, abrirAlMontar = false }: SeleccionarEtiquetasDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cierrePorFondo = useCierrePorFondo(dialogRef);
  const tituloId = useId();
  const campoId = useId();
  // Per preparación: the chosen size, the cell the user picked (an untouched row shows the default), and whether it was sent to print while the page is open.
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  const [celdas, setCeldas] = useState<Record<string, Celda>>({});
  const [impresas, setImpresas] = useState<ReadonlySet<string>>(new Set());
  // R11: the last etiqueta sent to print, kept only while this page is open.
  const [ultima, setUltima] = useState<UltimaImpresion | null>(null);
  useAbrirAlMontar(dialogRef, abrirAlMontar);

  // R11: closing the dialog forgets the positions (nothing is persisted).
  function olvidarPosiciones() {
    setCeldas({});
    setUltima(null);
  }

  const sinTamanos = tamanos.length === 0;
  // Every etiqueta sent to print: the flow ends here, so the dialog offers the next step (the Confirmadas tab).
  const imprimibles = etiquetas.filter((e) => !e.noImprimible);
  const todasImpresas = imprimibles.length > 0 && imprimibles.every((e) => impresas.has(e.preparacionId));

  /** The size, and the cell shown, of an ítem's row. */
  function estadoDeFila(preparacionId: string): { tamano: EtiquetaTamano; celda: Celda } | null {
    const tamano = tamanoElegido(tamanos, elegidos[preparacionId]);
    if (!tamano) return null;
    const grilla = grillaHoja(hoja, tamano);
    const propia = celdas[preparacionId];
    return { tamano, celda: conservarCelda(grilla, propia ?? celdaPorDefecto(grilla, tamano.id, ultima)) };
  }

  /** R8: a new size keeps the row's chosen cell if it still fits, else it falls back to the default (1 / 1 or the next one). */
  function cambiarTamano(preparacionId: string, id: string) {
    const nuevo = tamanos.find((t) => t.id === id);
    const propia = celdas[preparacionId];
    setElegidos((anteriores) => ({ ...anteriores, [preparacionId]: id }));
    if (propia && nuevo) setCeldas((anteriores) => ({ ...anteriores, [preparacionId]: conservarCelda(grillaHoja(hoja, nuevo), propia) }));
  }

  function imprimir(preparacionId: string) {
    const fila = estadoDeFila(preparacionId);
    if (!fila) return;
    abrirPdf(preparacionId, fila.tamano.id, fila.celda);
    // Freeze the printed cell on its row (it must not follow the "next cell" default once printed) and move the default on.
    setCeldas((anteriores) => ({ ...anteriores, [preparacionId]: fila.celda }));
    setUltima({ tamanoId: fila.tamano.id, celda: fila.celda });
    setImpresas((anteriores) => new Set(anteriores).add(preparacionId));
  }

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} aria-haspopup="dialog" className="btn btn-primary">
        <Printer className="size-4" aria-hidden />
        Imprimir etiquetas
      </button>
      <dialog ref={dialogRef} aria-labelledby={tituloId} {...cierrePorFondo} onClose={olvidarPosiciones} className={`${CLASE_DIALOG} max-w-xl`}>
        <div className="p-5">
          <h2 id={tituloId} className="text-lg font-semibold">
            Seleccionar etiquetas
          </h2>
          <p className="mb-3 text-sm text-zinc-500">Elegí el tamaño y la posición en la hoja de cada etiqueta. Cada una se abre en una pestaña nueva.</p>

          {sinTamanos ? (
            <SinTamanos />
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
              {etiquetas.map(({ preparacionId, numero, nombre, noImprimible }) => {
                const selectId = `${campoId}-${preparacionId}`;
                if (noImprimible) {
                  return (
                    <li key={preparacionId} className="flex flex-col gap-1 py-3 opacity-70">
                      <p className="min-w-0 truncate text-sm font-medium">
                        Ítem {numero}: {nombre}
                      </p>
                      <p className="text-xs text-zinc-500">{noImprimible}</p>
                    </li>
                  );
                }
                const fila = estadoDeFila(preparacionId);
                if (!fila) return null;
                return (
                  <li key={preparacionId} className="flex flex-col gap-2 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-medium">
                        Ítem {numero}: {nombre}
                      </p>
                      {impresas.has(preparacionId) ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700">
                          <CircleCheck className="size-3.5" aria-hidden />
                          Impresa
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="shrink-0">
                        <PosicionEnHoja
                          hoja={hoja}
                          tamano={fila.tamano}
                          celda={fila.celda}
                          onChange={(celda) => setCeldas((anteriores) => ({ ...anteriores, [preparacionId]: celda }))}
                          etiqueta={`Posición en la hoja de la etiqueta del ítem ${numero}`}
                          compacto
                        />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <label htmlFor={selectId} className="sr-only">
                          Tamaño de la etiqueta del ítem {numero}
                        </label>
                        <select id={selectId} value={fila.tamano.id} onChange={(event) => cambiarTamano(preparacionId, event.target.value)} className="input min-w-0">
                          <OpcionesTamano tamanos={tamanos} />
                        </select>
                        <button type="button" onClick={() => imprimir(preparacionId)} className="btn btn-primary btn-sm self-start">
                          <Printer className="size-3.5" aria-hidden />
                          Imprimir
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {sinTamanos ? null : <AvisoTamanoReal />}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => dialogRef.current?.close()} className="btn btn-secondary btn-sm">
              Cerrar
            </button>
            {todasImpresas ? (
              <Link href="/preparaciones?estado=CONFIRMADA" className="btn btn-primary btn-sm">
                Ir a confirmadas
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}
