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
 * (./reserva-acciones.tsx) -- ONE dialog for the whole flow. While ítems are left to confirm
 * (`confirmacion`), each row asks its size, its tipo de vencimiento and its position, and ONE
 * "Imprimir" confirms the receta and opens every etiqueta in ONE PDF, on the same sheet while
 * they do not overlap (R14). The tab is opened during the click itself (a user gesture, so no
 * popup blocker) and pointed at the PDF once the confirmation succeeds. On a reprint (nothing
 * left to confirm) each row has its own "Imprimir" (that ítem's single-etiqueta PDF). Nothing
 * about positions is persisted: inside the open dialog, the rows the user did not touch default
 * to the cell after the previous row of the same size (before confirming) or after the last
 * printed one (`../domain/celda-por-defecto.ts`, R11).
 */
import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from "react";
import Link from "next/link";
import { ArrowRight, CircleAlert, CircleCheck, Printer, TriangleAlert } from "lucide-react";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { conservarCelda, grillaHoja } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { Celda, HojaEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import { formatearTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import type { EtiquetaTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { celdaPorDefecto, type UltimaImpresion } from "../domain/celda-por-defecto";
import { hrefEtiquetaPdf, hrefEtiquetasPdf } from "../domain/etiqueta";
import type { PreparacionActionState } from "./action-state";
import { PosicionEnHoja } from "./posicion-en-hoja";
import { TipoVencimientoSelect } from "./tipo-vencimiento-select";

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

/** The confirmation the dialog runs first, while the receta still has ítems to confirm (./reserva-acciones.tsx). */
export interface ConfirmacionDeEtiquetas {
  recetaId: string;
  /** The ítems to confirm (reserved), in ítem order: one tipo de vencimiento selector each (docs/specs/vencimiento-preparado.md R10). */
  items: readonly { preparacionId: string; numero: number; nombre: string }[];
  /** `meses_vencimiento_preparado`, shown in the `ESTANDAR` option. */
  mesesVencimiento: number;
  confirmar: (prevState: PreparacionActionState, formData: FormData) => Promise<PreparacionActionState>;
  /** The button stays disabled (and closed on load): its note on the page says why. */
  deshabilitado: boolean;
}

export interface SeleccionarEtiquetasDialogProps {
  /** In ítem order. */
  etiquetas: readonly EtiquetaDeItemParaImprimir[];
  /** The active sizes that fit the sheet; empty without `etiquetas.imprimir` (the confirmation then asks only the vencimiento). */
  tamanos: readonly EtiquetaTamano[];
  hoja: HojaEtiqueta;
  /** Open the dialog as soon as this mounts (or the flag turns on). */
  abrirAlMontar?: boolean;
  /**
   * Set while there are ítems to confirm: the rows are those ítems, each with its size, its vencimiento and its position,
   * and one "Imprimir" confirms them all and opens their ONE PDF. If the browser blocks that tab, the dialog stays open
   * (the parent keeps it at a fixed place, so it survives the refresh) with a link to the PDF.
   */
  confirmacion?: ConfirmacionDeEtiquetas;
}

export function SeleccionarEtiquetasDialog({ etiquetas, tamanos, hoja, abrirAlMontar = false, confirmacion }: SeleccionarEtiquetasDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cierrePorFondo = useCierrePorFondo(dialogRef);
  const tituloId = useId();
  const campoId = useId();
  // Per preparación: the chosen size, the cell the user picked (an untouched row shows the default), and whether it was
  // sent to print while the page is open.
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  const [celdas, setCeldas] = useState<Record<string, Celda>>({});
  const [impresas, setImpresas] = useState<ReadonlySet<string>>(new Set());
  // R11: the last etiqueta sent to print, kept only while this page is open.
  const [ultima, setUltima] = useState<UltimaImpresion | null>(null);
  // The browser blocked the tab: the confirmed etiquetas' PDF, offered as a link instead.
  const [pdfBloqueado, setPdfBloqueado] = useState<string | null>(null);
  // The tab opened during the "Imprimir" click (a user gesture, so no popup blocker), pointed at the PDF once confirmed.
  const ventanaRef = useRef<Window | null>(null);
  const hrefConfirmacionRef = useRef<string | null>(null);
  useAbrirAlMontar(dialogRef, abrirAlMontar && !confirmacion?.deshabilitado);

  function cerrarVentanaVacia() {
    const ventana = ventanaRef.current;
    ventanaRef.current = null;
    if (ventana && !ventana.closed) ventana.close();
  }

  // R11: closing the dialog forgets the positions (nothing is persisted).
  function alCerrar() {
    setCeldas({});
    setUltima(null);
    setPdfBloqueado(null);
    cerrarVentanaVacia();
  }

  function cerrar() {
    dialogRef.current?.close();
  }

  const sinTamanos = tamanos.length === 0;
  const filas: readonly EtiquetaDeItemParaImprimir[] = confirmacion ? confirmacion.items : etiquetas;
  // Every etiqueta sent to print: the flow ends here, so the dialog offers the next step (the Confirmadas tab).
  const imprimibles = etiquetas.filter((e) => !e.noImprimible);
  const todasImpresas = !confirmacion && imprimibles.length > 0 && imprimibles.every((e) => impresas.has(e.preparacionId));

  // The size and the cell shown per row. Before confirming, every etiqueta goes on ONE sheet (R14): an untouched row
  // defaults to the cell after the previous row of the same size. Afterwards (reprint), R11: after the last printed one.
  const estados = new Map<string, { tamano: EtiquetaTamano; celda: Celda }>();
  const previaPorTamano = new Map<string, UltimaImpresion>();
  for (const { preparacionId, noImprimible } of filas) {
    const tamano = noImprimible ? undefined : tamanoElegido(tamanos, elegidos[preparacionId]);
    if (!tamano) continue;
    const grilla = grillaHoja(hoja, tamano);
    const porDefecto = celdaPorDefecto(grilla, tamano.id, confirmacion ? (previaPorTamano.get(tamano.id) ?? null) : ultima);
    const celda = conservarCelda(grilla, celdas[preparacionId] ?? porDefecto);
    previaPorTamano.set(tamano.id, { tamanoId: tamano.id, celda });
    estados.set(preparacionId, { tamano, celda });
  }

  /** R14: the confirmed etiquetas' ONE PDF, in ítem order; `null` without sizes (nothing to print). */
  function hrefConfirmacion(): string | null {
    if (!confirmacion || estados.size === 0) return null;
    return hrefEtiquetasPdf(
      confirmacion.items.flatMap(({ preparacionId }) => {
        const fila = estados.get(preparacionId);
        return fila ? [{ preparacionId, tamanoId: fila.tamano.id, celda: fila.celda }] : [];
      }),
    );
  }

  /** R8: a new size keeps the row's chosen cell if it still fits, else it falls back to the default. */
  function cambiarTamano(preparacionId: string, id: string) {
    const nuevo = tamanos.find((t) => t.id === id);
    const propia = celdas[preparacionId];
    setElegidos((anteriores) => ({ ...anteriores, [preparacionId]: id }));
    if (propia && nuevo) setCeldas((anteriores) => ({ ...anteriores, [preparacionId]: conservarCelda(grillaHoja(hoja, nuevo), propia) }));
  }

  function imprimir(preparacionId: string) {
    const fila = estados.get(preparacionId);
    if (!fila) return;
    abrirPdf(preparacionId, fila.tamano.id, fila.celda);
    // Freeze the printed cell on its row (it must not follow the "next cell" default once printed) and move the default on.
    setCeldas((anteriores) => ({ ...anteriores, [preparacionId]: fila.celda }));
    setUltima({ tamanoId: fila.tamano.id, celda: fila.celda });
    setImpresas((anteriores) => new Set(anteriores).add(preparacionId));
  }

  /** The "Imprimir" click, before the confirmation runs: open the tab now, while the click still counts as a user gesture. */
  function abrirVentanaParaPdf() {
    hrefConfirmacionRef.current = hrefConfirmacion();
    if (!hrefConfirmacionRef.current || (ventanaRef.current && !ventanaRef.current.closed)) return;
    const ventana = window.open("", "_blank");
    if (ventana) ventana.document.title = "Generando etiquetas…";
    ventanaRef.current = ventana;
  }

  /** Confirms the receta; on success the etiquetas' ONE PDF opens in the tab opened by the click, and the dialog closes. */
  async function confirmarEImprimir(prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
    const state = await confirmacion!.confirmar(prevState, formData);
    // A re-authentication or "who is acting" prompt re-submits: keep the tab for it.
    if (state.status === "reauth-required" || state.status === "operador-required") return state;
    const href = hrefConfirmacionRef.current;
    if (state.status !== "success" || !href) {
      cerrarVentanaVacia();
      return state;
    }
    const ventana = ventanaRef.current && !ventanaRef.current.closed ? ventanaRef.current : window.open(href, "_blank");
    ventanaRef.current = null;
    if (ventana) {
      ventana.location.href = href;
      cerrar();
    } else {
      setPdfBloqueado(href);
    }
    return state;
  }

  // One row per ítem, top to bottom: size, vencimiento (only before confirming: it is fixed then), position, and on a
  // reprint its own "Imprimir".
  const lista = (
    <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
      {filas.map(({ preparacionId, numero, nombre, noImprimible }) => {
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
        const fila = estados.get(preparacionId);
        if (!fila && !confirmacion) return null;
        return (
          <li key={preparacionId} className="flex flex-col gap-3 py-3">
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
            {fila ? (
              <div className="field">
                <label htmlFor={`${selectId}-tamano`} className="field-label">
                  Tamaño de la etiqueta
                </label>
                {/* No `name`: the size is not sent with the confirmation, it only drives the print. */}
                <select id={`${selectId}-tamano`} value={fila.tamano.id} onChange={(event) => cambiarTamano(preparacionId, event.target.value)} className="input min-w-0">
                  <OpcionesTamano tamanos={tamanos} />
                </select>
              </div>
            ) : null}
            {confirmacion ? (
              <TipoVencimientoSelect id={`${selectId}-vencimiento`} name={`tipoVencimiento_${preparacionId}`} label="Vencimiento" mesesEstandar={confirmacion.mesesVencimiento} />
            ) : null}
            {fila ? (
              <div className="field">
                <span className="field-label">Posición en la hoja</span>
                <PosicionEnHoja
                  hoja={hoja}
                  tamano={fila.tamano}
                  celda={fila.celda}
                  onChange={(celda) => setCeldas((anteriores) => ({ ...anteriores, [preparacionId]: celda }))}
                  etiqueta={`Posición en la hoja de la etiqueta del ítem ${numero}`}
                />
              </div>
            ) : null}
            {confirmacion || !fila ? null : (
              <button type="button" onClick={() => imprimir(preparacionId)} className="btn btn-primary btn-sm self-start">
                <Printer className="size-3.5" aria-hidden />
                Imprimir
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} aria-haspopup="dialog" disabled={confirmacion?.deshabilitado} className="btn btn-primary">
        <Printer className="size-4" aria-hidden />
        Imprimir etiquetas
      </button>
      <dialog ref={dialogRef} aria-labelledby={tituloId} {...cierrePorFondo} onClose={alCerrar} className={`${CLASE_DIALOG} max-w-xl overflow-y-auto`}>
        <div className="p-5">
          <h2 id={tituloId} className="text-lg font-semibold">
            Imprimir etiquetas
          </h2>
          <p className="mb-3 text-sm text-zinc-500">
            {confirmacion
              ? "Elegí el tamaño, el vencimiento y la posición en la hoja de cada etiqueta. Se imprimen todas juntas, en un solo PDF."
              : "Elegí el tamaño y la posición en la hoja de cada etiqueta. Cada una se abre en una pestaña nueva."}
          </p>

          {pdfBloqueado ? (
            <div role="alert" className="alert alert-warn mb-3">
              <TriangleAlert aria-hidden />
              <p>
                El navegador bloqueó la pestaña de las etiquetas.{" "}
                <a href={pdfBloqueado} target="_blank" rel="noreferrer" className="font-medium underline">
                  Abrir etiquetas
                </a>
              </p>
            </div>
          ) : null}

          {confirmacion ? (
            // Capture phase: runs on the click's submit, before the form's own handler and the async action.
            <div onSubmitCapture={abrirVentanaParaPdf}>
              <ReauthAwareForm
                action={confirmarEImprimir}
                accion={["preparaciones.confirmar", "etiquetas.generar"]}
                submitLabel={sinTamanos ? "Confirmar" : "Imprimir"}
                pendingLabel={sinTamanos ? "Confirmando…" : "Imprimiendo…"}
                className="flex flex-col gap-4"
                extraActions={
                  <button type="button" onClick={cerrar} className="btn btn-secondary">
                    Cancelar
                  </button>
                }
              >
                <input type="hidden" name="recetaId" value={confirmacion.recetaId} />
                {lista}
                {sinTamanos ? null : <AvisoTamanoReal />}
                <div role="note" className="alert alert-warn">
                  <CircleAlert aria-hidden />
                  <p>Al imprimir, se registran todos los ítems en el libro recetario y se descuenta el stock. No se puede deshacer.</p>
                </div>
              </ReauthAwareForm>
            </div>
          ) : (
            <>
              {sinTamanos ? <SinTamanos /> : lista}
              {sinTamanos ? null : <AvisoTamanoReal />}

              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={cerrar} className="btn btn-secondary btn-sm">
                  Cerrar
                </button>
                {todasImpresas ? (
                  <Link href="/preparaciones?estado=CONFIRMADA" className="btn btn-primary btn-sm">
                    Ir a confirmadas
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                ) : null}
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
