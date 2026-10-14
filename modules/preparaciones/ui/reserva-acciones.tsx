"use client";

/**
 * The toma workspace's actions on reserved stock: per ítem, and the receta's "Imprimir etiquetas" (migration 0071,
 * docs/specs/reserva-stock-preparacion.md). Liberar and imprimir are behind re-authentication (`ReauthAwareForm`); the
 * pérdida asks only for the Director Técnico's password (`SimpleForm` + co-firma, like the stock ajuste):
 *   - `LiberarReservaForm`: "Liberar reserva" -- deletes the reserva and discards the preparación; the ítem is
 *     Pendiente again.
 *   - `EtiquetasDeReceta`: the receta's ONE "Imprimir etiquetas", below its ítems -- enabled only once every ítem not
 *     yet confirmed holds a reserva; confirms them all in one transaction (stock, libro recetario with consecutive
 *     asientos, contralor, etiquetas: modules/preparaciones/application/confirmar-reservas-receta.ts), then opens the
 *     "Seleccionar etiquetas" dialog (./imprimir-etiqueta-dialog.tsx: a size and an "Imprimir" per ítem). Once nothing
 *     is left to confirm it is that dialog's button (reprint). The page renders it at a FIXED place whatever the ítems'
 *     state, so its "just confirmed" flag survives the refresh that unmounts the form inside it, and the dialog opens by
 *     itself right after.
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
import type { EtiquetaTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { MOTIVO_AJUSTE_LABELS } from "@/modules/stock/domain/partida";
import { MOTIVOS_PERDIDA } from "../domain/perdida";
import { confirmarReservasRecetaAction, liberarReservaStockAction, registrarPerdidaReservaAction } from "./actions";
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

export interface EtiquetasDeRecetaProps {
  recetaId: string;
  /** Ítems not confirmed yet: what "Imprimir etiquetas" confirms. 0 = all confirmed, the button reprints. */
  porConfirmar: number;
  /** Every ítem not confirmed yet holds a reserva (domain/toma.ts#itemsSinReserva): the confirmation may run. */
  todasReservadas: boolean;
  /** `preparaciones.confirmar` + `etiquetas.generar`. */
  puedeConfirmar: boolean;
  /** `etiquetas.imprimir`: without it the confirmation still runs, but no print dialog is offered. */
  puedeImprimir: boolean;
  tamanos: readonly EtiquetaTamano[];
  /** The confirmed ítems that have their etiqueta, in ítem order: the dialog's rows. */
  etiquetas: readonly EtiquetaDeItemParaImprimir[];
}

export function EtiquetasDeReceta({ recetaId, porConfirmar, todasReservadas, puedeConfirmar, puedeImprimir, tamanos, etiquetas }: EtiquetasDeRecetaProps) {
  // "Just confirmed" is set when the confirmation resolves, NOT from the form's onSuccess: the action's revalidatePath
  // re-renders the page in the same response, so the form unmounts before its success effect ever runs. This component
  // stays mounted (the page renders it at a fixed place), so its own state survives and opens the dialog right after.
  const [recienConfirmadas, setRecienConfirmadas] = useState(false);
  async function confirmar(prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
    const state = await confirmarReservasRecetaAction(prevState, formData);
    if (state.status === "success") {
      if (state.message) toast(state.message);
      setRecienConfirmadas(true);
    }
    return state;
  }

  if (porConfirmar > 0) {
    if (!puedeConfirmar) return null;
    return (
      <div className="panel flex flex-wrap items-center justify-end gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
        {todasReservadas ? (
          <p className="flex items-center gap-1.5 text-sm text-zinc-600">
            <CircleAlert className="size-4 shrink-0 text-amber-600" aria-hidden />
            Al imprimir, se registran todos los ítems en el libro recetario y se descuenta el stock.
          </p>
        ) : (
          <p className="text-sm text-zinc-500">Reservá el stock de todos los ítems para imprimir las etiquetas.</p>
        )}
        <ReauthAwareForm action={confirmar} submitLabel="Imprimir etiquetas" pendingLabel="Confirmando…" submitDisabled={!todasReservadas} layout="inline">
          <input type="hidden" name="recetaId" value={recetaId} />
        </ReauthAwareForm>
      </div>
    );
  }

  return puedeImprimir && etiquetas.length > 0 ? (
    <div className="panel flex justify-end px-4 py-3 sm:px-5">
      <SeleccionarEtiquetasDialog etiquetas={etiquetas} tamanos={tamanos} abrirAlMontar={recienConfirmadas} />
    </div>
  ) : null;
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
            Se descuenta de la partida como un ajuste, vinculado a esta preparación. Después se vuelve a calcular la reserva con las mismas partidas; si ya no
            alcanza, vas a tener que modificar la reserva. Requiere la contraseña del Director Técnico.
          </p>
          <SimpleForm
            key={apertura}
            action={registrarPerdidaReservaAction}
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
