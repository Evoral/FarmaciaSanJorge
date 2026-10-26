"use client";

/**
 * The toma workspace's actions on reserved stock: per ítem, and the receta's "Imprimir etiquetas" (migration 0071,
 * openspec/specs/reserva-stock-preparacion/spec.md). Liberar and imprimir are behind re-authentication (`ReauthAwareForm`); the
 * pérdida asks only for the Director Técnico's password (`SimpleForm` + co-firma, like the stock ajuste):
 *   - `LiberarReservaForm`: "Liberar reserva" -- deletes the reserva and discards the preparación; the ítem is
 *     Pendiente again.
 *   - `EtiquetasDeReceta`: the receta's ONE "Imprimir etiquetas", below its ítems -- enabled only once every ítem not
 *     yet confirmed holds a reserva; confirms them all in one transaction (stock, ONE libro recetario asiento for the
 *     receta, contralor, etiquetas: modules/preparaciones/application/confirmar-reservas-receta.ts) from ONE dialog
 *     (./imprimir-etiqueta-dialog.tsx: per ítem its size, vencimiento and position; ONE "Imprimir" confirms and opens
 *     every etiqueta in one PDF). Once nothing is left to confirm it is the same dialog without the confirmation
 *     (reprint, one "Imprimir" per ítem). The page renders it at a FIXED place whatever the ítems' state, and the
 *     dialog sits at a fixed place inside it, so it survives the refresh that follows the confirmation.
 *   - `PerdidaReservaDialog`: "Registrar pérdida" -- a loss (rotura, derrame) of a reserved partida during the work: an
 *     AJUSTE linked to the preparación, with the Director Técnico's co-firma in the same form (an ajuste always needs it),
 *     after which the reserva is re-planned (modules/preparaciones/application/registrar-perdida-reserva.ts). Native
 *     `<dialog>` like ./continuar-preparacion-dialog.tsx (no backdrop close: it would lose what was entered).
 */
import { useId, useRef, useState } from "react";
import { CircleAlert, TriangleAlert, X } from "lucide-react";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { SimpleForm } from "@/shared/ui/simple-form";
import { toast } from "@/shared/ui/toast";
import { CoFirmaDt, type CoFirmaDtOpcion } from "@/shared/ui/co-firma-dt";
import type { HojaEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { EtiquetaTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { MOTIVO_AJUSTE_LABELS } from "@/modules/stock/domain/partida";
import { MOTIVOS_PERDIDA } from "../domain/perdida";
import { confirmarReservasRecetaAction, liberarReservaStockAction, recalcularReservaStockAction, registrarPerdidaReservaAction } from "./actions";
import type { PreparacionActionState } from "./action-state";
import { SeleccionarEtiquetasDialog, type EtiquetaDeItemParaImprimir } from "./imprimir-etiqueta-dialog";

/**
 * The ítem goes back to Pendiente and this form unmounts: the message goes to a toast. Fired here, when the action
 * resolves, and NOT from the form's onSuccess: the action's revalidatePath re-renders the page in the same response, so
 * the form unmounts before its success effect ever runs.
 */
async function liberarReservaConToast(prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  const state = await liberarReservaStockAction(prevState, formData);
  if (state.status === "success" && state.message) toast(state.message);
  return state;
}

export function LiberarReservaForm({ preparacionId }: { preparacionId: string }) {
  return (
    <ReauthAwareForm
      action={liberarReservaConToast}
      accion="preparaciones.descartar"
      submitLabel="Liberar reserva"
      pendingLabel="Liberando…"
      submitVariant="secondary"
      submitSize="sm"
      layout="inline"
    >
      <input type="hidden" name="preparacionId" value={preparacionId} />
    </ReauthAwareForm>
  );
}

/** One-click "Recalcular reserva" (no enrase quantity to type): re-plans the ítem's reserva automatically (R1b/R5). */
export function RecalcularReservaForm({ preparacionId }: { preparacionId: string }) {
  return (
    <ReauthAwareForm action={recalcularReservaStockAction} accion="preparaciones.confirmar" submitLabel="Recalcular reserva" pendingLabel="Recalculando…" submitVariant="secondary" submitSize="sm" layout="inline">
      <input type="hidden" name="preparacionId" value={preparacionId} />
    </ReauthAwareForm>
  );
}

export interface EtiquetasDeRecetaProps {
  recetaId: string;
  /** Ítems not confirmed yet: what "Imprimir etiquetas" confirms. 0 = all confirmed, the button reprints. */
  porConfirmar: number;
  /** Every ítem not confirmed yet holds a reserva (domain/toma.ts#itemsSinReserva): the confirmation may run. */
  todasReservadas: boolean;
  /** Ítems ("Ítem N") whose reserva no longer fits (R5): recalculate them before printing. */
  sinAlcance: readonly number[];
  /** `preparaciones.confirmar` + `etiquetas.generar`. */
  puedeConfirmar: boolean;
  /** `etiquetas.imprimir`: without it the confirmation still runs, but no print dialog is offered. */
  puedeImprimir: boolean;
  /** The active sizes that fit the sheet. */
  tamanos: readonly EtiquetaTamano[];
  hoja: HojaEtiqueta;
  /** The confirmed ítems that have their etiqueta, in ítem order: the dialog's rows. */
  etiquetas: readonly EtiquetaDeItemParaImprimir[];
  /** The ítems "Imprimir etiquetas" confirms (reserved), in ítem order: one tipo de vencimiento selector each (openspec/specs/vencimiento-preparado/spec.md R10). */
  aConfirmar: readonly { preparacionId: string; numero: number; nombre: string }[];
  /** `meses_vencimiento_preparado`, shown in the `ESTANDAR` option. */
  mesesVencimiento: number;
  /** Open the confirmation dialog on load when it is enabled (the Confirmadas tab's "Imprimir", `?imprimir=1`). */
  abrirAlMontar?: boolean;
}

export function EtiquetasDeReceta({
  recetaId,
  porConfirmar,
  todasReservadas,
  sinAlcance,
  puedeConfirmar,
  puedeImprimir,
  tamanos,
  hoja,
  etiquetas,
  aConfirmar,
  mesesVencimiento,
  abrirAlMontar = false,
}: EtiquetasDeRecetaProps) {
  async function confirmar(prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
    const state = await confirmarReservasRecetaAction(prevState, formData);
    if (state.status === "success" && state.message) toast(state.message);
    return state;
  }

  const confirmando = porConfirmar > 0;
  if (confirmando ? !puedeConfirmar : !puedeImprimir || etiquetas.length === 0) return null;

  // Same tree in both phases (the note's slot may be empty): the open dialog must not remount when the confirmation
  // re-renders the page with nothing left to confirm.
  return (
    <div className="panel flex flex-wrap items-center justify-end gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
      {!confirmando ? null : todasReservadas && sinAlcance.length > 0 ? (
        <p className="text-sm text-red-700">Recalculá la reserva {sinAlcance.length === 1 ? `del ítem ${sinAlcance[0]}` : `de los ítems ${sinAlcance.join(", ")}`} para imprimir las etiquetas.</p>
      ) : todasReservadas ? (
        <p className="flex items-center gap-1.5 text-sm text-zinc-600">
          <CircleAlert className="size-4 shrink-0 text-amber-600" aria-hidden />
          Al imprimir, se registran todos los ítems en el libro recetario y se descuenta el stock.
        </p>
      ) : (
        <p className="text-sm text-zinc-500">Reservá el stock de todos los ítems para imprimir las etiquetas.</p>
      )}
      <SeleccionarEtiquetasDialog
        etiquetas={etiquetas}
        tamanos={puedeImprimir ? tamanos : []}
        hoja={hoja}
        abrirAlMontar={abrirAlMontar}
        confirmacion={
          confirmando
            ? { recetaId, items: aConfirmar, mesesVencimiento, confirmar, deshabilitado: !todasReservadas || sinAlcance.length > 0 }
            : undefined
        }
      />
    </div>
  );
}

export interface PartidaReservada {
  partidaId: string;
  drogaNombre: string;
  lote: string;
  /** Reserved now (physical), in `unidadSimbolo`. */
  cantidad: string;
  unidadSimbolo: string;
}

export interface PerdidaReservaDialogProps {
  preparacionId: string;
  /** The ítem's reserved partidas (only those the split draws from). */
  partidas: readonly PartidaReservada[];
  /** DTs vigentes for the co-firma. */
  dts: readonly CoFirmaDtOpcion[];
  /** The operator is themselves a DT vigente (they still type their own password). */
  operadorEsDt: boolean;
  /** The ítem, shown under the dialog's title. */
  itemNombre: string;
}

export function PerdidaReservaDialog({ preparacionId, partidas, dts, operadorEsDt, itemNombre }: PerdidaReservaDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tituloId = useId();
  const campoId = useId();
  // Bumped on every closing: the next opening starts with an empty form.
  const [apertura, setApertura] = useState(0);

  function cerrar() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} aria-haspopup="dialog" className="btn btn-secondary btn-sm">
        <TriangleAlert className="size-3.5" aria-hidden />
        Registrar pérdida
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={tituloId}
        onClose={() => setApertura((n) => n + 1)}
        className="card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-2xl p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={tituloId} className="text-lg font-semibold">
                Registrar pérdida
              </h2>
              <p className="truncate text-sm text-zinc-500">{itemNombre}</p>
            </div>
            <button type="button" onClick={cerrar} aria-label="Cerrar" className="btn btn-ghost btn-sm">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <p className="text-sm text-zinc-600">
            Se descuenta de la partida como un ajuste, vinculado a esta preparación. Después la reserva se recalcula sola sobre todas las partidas de la droga;
            solo si no queda stock suficiente deja de alcanzar. Requiere la contraseña del Director Técnico.
          </p>
          <SimpleForm
            key={apertura}
            action={registrarPerdidaReservaAction}
            accion="preparaciones.confirmar"
            submitLabel="Registrar pérdida"
            pendingLabel="Registrando…"
            submitVariant="danger-solid"
            className="flex flex-col gap-4"
            extraActions={
              <button type="button" onClick={cerrar} className="btn btn-secondary">
                Cancelar
              </button>
            }
            onSuccess={(state) => {
              if (state.message) toast(state.message);
              cerrar();
            }}
          >
            <input type="hidden" name="preparacionId" value={preparacionId} />
            <div className="field">
              <label htmlFor={`${campoId}-partida`} className="field-label">
                Partida reservada
              </label>
              <select id={`${campoId}-partida`} name="partidaId" required className="input">
                {partidas.map((p) => (
                  <option key={p.partidaId} value={p.partidaId}>
                    {p.drogaNombre} · lote {p.lote} (reservado {p.cantidad} {p.unidadSimbolo})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="field">
                <label htmlFor={`${campoId}-cantidad`} className="field-label">
                  Cantidad perdida
                </label>
                <input id={`${campoId}-cantidad`} name="cantidad" type="text" inputMode="decimal" required className="input font-mono" />
                <p className="field-help">En la misma unidad que la reserva.</p>
              </div>
              <div className="field">
                <label htmlFor={`${campoId}-motivo`} className="field-label">
                  Motivo
                </label>
                <select id={`${campoId}-motivo`} name="motivoAjuste" required className="input">
                  {MOTIVOS_PERDIDA.map((motivo) => (
                    <option key={motivo} value={motivo}>
                      {MOTIVO_AJUSTE_LABELS[motivo]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor={`${campoId}-observacion`} className="field-label">
                Observación (opcional)
              </label>
              <input id={`${campoId}-observacion`} name="observacion" type="text" className="input" />
            </div>
            <CoFirmaDt dts={dts} operadorEsDt={operadorEsDt} idSuffix={`-${campoId}`} />
          </SimpleForm>
        </div>
      </dialog>
    </>
  );
}
