"use client";

/**
 * The toma workspace's actions on an ítem whose stock is reserved (migration 0071,
 * docs/specs/reserva-stock-preparacion.md). Liberar and imprimir are behind re-authentication (`ReauthAwareForm`); the
 * pérdida asks only for the Director Técnico's password (`SimpleForm` + co-firma, like the stock ajuste):
 *   - `LiberarReservaForm`: "Liberar reserva" -- deletes the reserva and discards the preparación; the ítem is
 *     Pendiente again.
 *   - `EtiquetaDeItem`: "Imprimir etiqueta" -- confirms the preparación from its reserva (stock, libro recetario,
 *     contralor) and generates its etiqueta in one transaction, then opens the existing print flow (the size dialog,
 *     ./imprimir-etiqueta-dialog.tsx). Once the ítem is confirmed it renders that print dialog's button itself (reprints).
 *     The page renders it at the SAME place for the reserved and the confirmed ítem, so this component (and its "just
 *     confirmed" state) survives the refresh that turns one into the other, and the dialog opens by itself right after.
 *   - `PerdidaReservaDialog`: "Registrar pérdida" -- a loss (rotura, derrame) of a reserved partida during the work: an
 *     AJUSTE linked to the preparación, with the Director Técnico's co-firma in the same form (an ajuste always needs it),
 *     after which the reserva is re-planned (modules/preparaciones/application/registrar-perdida-reserva.ts). Native
 *     `<dialog>` like ./continuar-preparacion-dialog.tsx (no backdrop close: it would lose what was entered).
 */
import { useId, useRef, useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { SimpleForm } from "@/shared/ui/simple-form";
import { toast } from "@/shared/ui/toast";
import { CoFirmaDt, type CoFirmaDtOpcion } from "@/shared/ui/co-firma-dt";
import type { EtiquetaTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { MOTIVO_AJUSTE_LABELS } from "@/modules/stock/domain/partida";
import { MOTIVOS_PERDIDA } from "../domain/perdida";
import { confirmarReservaStockAction, liberarReservaStockAction, registrarPerdidaReservaAction } from "./actions";
import { ImprimirEtiquetaDialog } from "./imprimir-etiqueta-dialog";

export function LiberarReservaForm({ preparacionId }: { preparacionId: string }) {
  return (
    // The ítem goes back to Pendiente and this form unmounts: the message goes to a toast.
    <ReauthAwareForm
      action={liberarReservaStockAction}
      submitLabel="Liberar reserva"
      pendingLabel="Liberando…"
      submitVariant="secondary"
      layout="inline"
      onSuccess={(state) => {
        if (state.message) toast(state.message);
      }}
    >
      <input type="hidden" name="preparacionId" value={preparacionId} />
    </ReauthAwareForm>
  );
}

export interface EtiquetaDeItemProps {
  preparacionId: string;
  /** `true`: the preparación holds a reserva (the button confirms it first); `false`: it is CONFIRMADA with its etiqueta. */
  reservada: boolean;
  /** `etiquetas.imprimir`: without it the confirmation still runs, but no print dialog is offered. */
  puedeImprimir: boolean;
  tamanos: readonly EtiquetaTamano[];
}

export function EtiquetaDeItem({ preparacionId, reservada, puedeImprimir, tamanos }: EtiquetaDeItemProps) {
  const [recienConfirmada, setRecienConfirmada] = useState(false);

  if (!reservada) {
    return puedeImprimir ? <ImprimirEtiquetaDialog preparacionId={preparacionId} tamanos={tamanos} variant="primary" small={false} abrirAlMontar={recienConfirmada} /> : null;
  }

  return (
    <ReauthAwareForm
      action={confirmarReservaStockAction}
      submitLabel="Imprimir etiqueta"
      pendingLabel="Confirmando…"
      layout="inline"
      onSuccess={(state) => {
        if (state.message) toast(state.message);
        setRecienConfirmada(true);
      }}
    >
      <input type="hidden" name="preparacionId" value={preparacionId} />
    </ReauthAwareForm>
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
      <button type="button" onClick={() => dialogRef.current?.showModal()} aria-haspopup="dialog" className="btn btn-secondary">
        <TriangleAlert className="size-4" aria-hidden />
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
