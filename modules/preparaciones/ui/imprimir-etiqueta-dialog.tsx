"use client";

/**
 * "Imprimir etiqueta": the button opens a "Seleccionar tamaño" dialog with the
 * active sizes the administrator configured (modules/etiqueta-tamanos); confirming
 * opens the etiqueta PDF, rendered on that page size, in a new tab. Native
 * `<dialog>` opened with `showModal()` (same pattern as
 * `./ver-receta-pendiente-dialog.tsx`): focus is trapped and returned to the
 * trigger by the browser, Escape closes it natively, and a click on the
 * backdrop closes it too.
 *
 * Plain data only: the page has already read the sizes (no client fetch), as
 * plain numbers -- never Prisma `Decimal`s, which can not cross into a client
 * component.
 *
 * `abrirAlMontar`: opens the size dialog by itself once mounted -- right after
 * ./etiqueta-para-imprimir.tsx generated a missing etiqueta. The PDF still opens
 * from the dialog's own "Imprimir" click (a user gesture, so no popup blocker).
 *
 * `SeleccionarEtiquetasDialog`: the toma workspace's "Imprimir etiquetas"
 * (./reserva-acciones.tsx) -- the same dialog with one row per confirmed ítem,
 * each with its own size and its own "Imprimir" (each click opens that ítem's
 * single-etiqueta PDF: one user gesture per tab, so no popup blocker).
 */
import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, Printer, TriangleAlert } from "lucide-react";
import { formatearTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import type { EtiquetaTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { hrefEtiquetaPdf } from "../domain/etiqueta";

const CLASE_DIALOG =
  "card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900";

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
export function tamanoElegido(tamanos: readonly EtiquetaTamano[], elegido: string | undefined): string {
  return tamanos.find((t) => t.id === elegido)?.id ?? tamanos[0]?.id ?? "";
}

function abrirPdf(preparacionId: string, tamanoId: string) {
  window.open(hrefEtiquetaPdf(preparacionId, tamanoId), "_blank", "noreferrer");
}

function SinTamanos() {
  return (
    <div role="note" className="alert alert-warn">
      <TriangleAlert aria-hidden />
      <p>No hay tamaños de etiqueta activos. Solicite al administrador que habilite uno.</p>
    </div>
  );
}

export function OpcionesTamano({ tamanos }: { tamanos: readonly EtiquetaTamano[] }) {
  return tamanos.map((tamano) => (
    <option key={tamano.id} value={tamano.id}>
      {formatearTamano(tamano)}
    </option>
  ));
}

export interface ImprimirEtiquetaDialogProps {
  preparacionId: string;
  tamanos: readonly EtiquetaTamano[];
  /** `"secondary"` + `small` in table rows, `"primary"` on the preparación screen. Defaults to the row style. */
  variant?: "primary" | "secondary";
  small?: boolean;
  /** Open the size dialog as soon as this mounts (or the flag turns on). */
  abrirAlMontar?: boolean;
  /** The etiqueta was already printed: the button reads "Reimprimir", at the same fixed width as "Imprimir etiqueta". */
  reimprimir?: boolean;
}

export function ImprimirEtiquetaDialog({ preparacionId, tamanos, variant = "secondary", small = true, abrirAlMontar = false, reimprimir = false }: ImprimirEtiquetaDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cierrePorFondo = useCierrePorFondo(dialogRef);
  const tituloId = useId();
  const selectId = useId();
  const [elegido, setElegido] = useState("");
  useAbrirAlMontar(dialogRef, abrirAlMontar);

  const tamanoId = tamanoElegido(tamanos, elegido);
  const sinTamanos = tamanos.length === 0;

  function cerrar() {
    dialogRef.current?.close();
  }

  function imprimir() {
    if (!tamanoId) return;
    abrirPdf(preparacionId, tamanoId);
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
            Seleccionar tamaño
          </h2>

          {sinTamanos ? (
            <SinTamanos />
          ) : (
            <div className="field">
              <label htmlFor={selectId} className="field-label">
                Tamaño
              </label>
              <select id={selectId} value={tamanoId} onChange={(event) => setElegido(event.target.value)} className="input">
                <OpcionesTamano tamanos={tamanos} />
              </select>
              <p className="field-help">La etiqueta se escala proporcionalmente al tamaño elegido.</p>
            </div>
          )}

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
  tamanos: readonly EtiquetaTamano[];
  /** Open the dialog as soon as this mounts (or the flag turns on): right after the confirmation. */
  abrirAlMontar?: boolean;
  /** Per preparación, the size already chosen in the confirmation dialog (./reserva-acciones.tsx). */
  tamanosIniciales?: Readonly<Record<string, string>>;
}

export function SeleccionarEtiquetasDialog({ etiquetas, tamanos, abrirAlMontar = false, tamanosIniciales }: SeleccionarEtiquetasDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cierrePorFondo = useCierrePorFondo(dialogRef);
  const tituloId = useId();
  const campoId = useId();
  // Per preparación: the chosen size, and whether it was sent to print while the page is open.
  const [elegidos, setElegidos] = useState<Record<string, string>>(() => ({ ...tamanosIniciales }));
  const [impresas, setImpresas] = useState<ReadonlySet<string>>(new Set());
  useAbrirAlMontar(dialogRef, abrirAlMontar);

  const sinTamanos = tamanos.length === 0;
  // Every etiqueta sent to print: the flow ends here, so the dialog offers the next step (the Confirmadas tab).
  const imprimibles = etiquetas.filter((e) => !e.noImprimible);
  const todasImpresas = imprimibles.length > 0 && imprimibles.every((e) => impresas.has(e.preparacionId));

  function imprimir(preparacionId: string) {
    const tamanoId = tamanoElegido(tamanos, elegidos[preparacionId]);
    if (!tamanoId) return;
    abrirPdf(preparacionId, tamanoId);
    setImpresas((anteriores) => new Set(anteriores).add(preparacionId));
  }

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} aria-haspopup="dialog" className="btn btn-primary">
        <Printer className="size-4" aria-hidden />
        Imprimir etiquetas
      </button>
      <dialog ref={dialogRef} aria-labelledby={tituloId} {...cierrePorFondo} className={`${CLASE_DIALOG} max-w-xl`}>
        <div className="p-5">
          <h2 id={tituloId} className="text-lg font-semibold">
            Seleccionar etiquetas
          </h2>
          <p className="mb-3 text-sm text-zinc-500">Elegí el tamaño de cada etiqueta. Cada una se abre en una pestaña nueva.</p>

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
                    <div className="flex items-center gap-2">
                      <label htmlFor={selectId} className="sr-only">
                        Tamaño de la etiqueta del ítem {numero}
                      </label>
                      <select
                        id={selectId}
                        value={tamanoElegido(tamanos, elegidos[preparacionId])}
                        onChange={(event) => setElegidos((anteriores) => ({ ...anteriores, [preparacionId]: event.target.value }))}
                        className="input min-w-0 flex-1"
                      >
                        <OpcionesTamano tamanos={tamanos} />
                      </select>
                      <button type="button" onClick={() => imprimir(preparacionId)} className="btn btn-primary btn-sm shrink-0">
                        <Printer className="size-3.5" aria-hidden />
                        Imprimir
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {sinTamanos ? null : <p className="mt-2 text-xs text-zinc-500">Cada etiqueta se escala proporcionalmente al tamaño elegido.</p>}

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
