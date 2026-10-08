"use client";

/**
 * The confirmación screen (M11, FASE 8 points 8.2/8.3). For every non-manual
 * línea, shows the system's OWN proposed split (read-only amounts, INV-S13/
 * S20) with a checkbox per eligible partida so the farmacéutico may choose
 * DIFFERENT partidas (INV-S15) -- the amounts are always recomputed by the
 * SERVER for whatever selection is submitted, never sent from here. For
 * manual-enrase lines, a required quantity input (the ONLY quantity this
 * form ever lets the user type). `motivoApertura_<lineaId>` is always
 * rendered (optional) -- `confirmarPreparacion` rejects the submission with
 * a clear message if INV-S18 requires it and it was left empty, which is
 * simpler and more honest than guessing client-side whether it will be
 * required.
 *
 * Two destinations, same fields: an INICIADA preparación on
 * `/preparaciones/[id]` (`confirmarPreparacionAction`), or a ficha técnica
 * from the toma workspace's "Continuar" dialog (`reservarStockAction`:
 * creates the preparación and RESERVES the stock, validated exactly like the
 * confirmation; stock and libro recetario are fixed later, at "Imprimir
 * etiqueta" -- docs/specs/reserva-stock-preparacion.md), or a reserved
 * preparación from its "Modificar reserva" dialog (`modificarReservaStockAction`:
 * replaces its reserva; the form starts from the current one, `linea.reserva`).
 * A línea without
 * stock is warned up front and disables the submit; so does a closed
 * jornada (`cierre_diario`) for the confirmation -- a reserva only warns
 * that its etiqueta can not be printed today.
 */
import { useState, type ReactNode } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { ToneBadge } from "@/shared/ui/status-badge";
import { formatNumero } from "@/shared/format/cantidad";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { confirmarPreparacionAction, modificarReservaStockAction, reservarStockAction } from "./actions";
import type { DatosConfirmacion } from "@/modules/preparaciones/application/datos-confirmacion";

export interface ConfirmarPreparacionFormProps {
  datos: DatosConfirmacion;
  /**
   * An INICIADA preparación to confirm (it can still be discarded below the form), the ficha técnica a new preparación
   * is created from on submit (its stock reserved), or a preparación whose reserva is replaced.
   */
  destino: { preparacionId: string } | { fichaTecnicaId: string } | { reservaDePreparacionId: string };
  /** After a successful submit (the page is refreshed anyway); receives the success message. */
  onSuccess?: (message: string | undefined) => void;
  /** E.g. the dialog's "Cancelar" (`type="button"`), next to the submit. */
  extraActions?: ReactNode;
}

function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short" }).format(new Date(`${iso}T00:00:00`));
}

export function ConfirmarPreparacionForm({ datos, destino, onSuccess, extraActions }: ConfirmarPreparacionFormProps) {
  const modificar = "reservaDePreparacionId" in destino;
  // Reserving or modifying a reserva (nothing is descontado yet), vs confirming.
  const esReserva = !("preparacionId" in destino);
  // Which partidas start CHECKED per línea: the current reserva when modifying
  // it; else the system's own proposal for non-manual lines, EVERY eligible
  // partida for manual lines (the pharmacist narrows it down if needed --
  // there is no proposal to default to since the quantity isn't known yet).
  const [checked, setChecked] = useState<Record<string, Set<string>>>(() => {
    const initial: Record<string, Set<string>> = {};
    for (const linea of datos.lineas) {
      if (linea.reserva) {
        initial[linea.id] = new Set(linea.reserva.partidaIds);
      } else if (linea.propuesta) {
        initial[linea.id] = new Set(linea.propuesta.map((p) => p.partidaId));
      } else {
        initial[linea.id] = new Set(linea.partidasElegibles.map((p) => p.id));
      }
    }
    return initial;
  });

  function toggle(lineaId: string, partidaId: string) {
    setChecked((prev) => {
      const next = new Set(prev[lineaId]);
      if (next.has(partidaId)) next.delete(partidaId);
      else next.add(partidaId);
      return { ...prev, [lineaId]: next };
    });
  }

  const hayStockInsuficiente = datos.lineas.some((l) => l.stockInsuficiente);
  const lineasSinStock = datos.lineas.filter((l) => l.stockInsuficiente).length;
  // A reserva writes no libro: a closed jornada only matters when its etiqueta is printed.
  const bloqueada = hayStockInsuficiente || (datos.jornadaCerrada && !esReserva);

  return (
    <div className="flex flex-col gap-5">
      {esReserva ? (
        <div role="note" className="alert alert-info">
          <Info aria-hidden />
          <div>
            <p className="font-semibold">Se reserva el stock de las partidas elegidas.</p>
            <p>
              Nadie más puede usarlo. El stock se descuenta y el asiento se escribe en el libro recetario recién al imprimir la etiqueta; hasta entonces podés liberar
              la reserva.
            </p>
          </div>
        </div>
      ) : (
        <div role="note" className="alert alert-warn">
          <TriangleAlert aria-hidden />
          <div>
            <p className="font-semibold">Esta acción es irreversible.</p>
            <p>Al confirmar se descuenta stock de las partidas elegidas y se escribe un asiento en el libro recetario, que no se puede editar ni deshacer.</p>
          </div>
        </div>
      )}

      {datos.jornadaCerrada ? (
        <div role="alert" className="alert alert-danger">
          <CircleAlert aria-hidden />
          <p>
            La jornada de hoy ya fue firmada por el Director Técnico: no se pueden confirmar preparaciones para el día de hoy.
            {esReserva ? " Podés reservar el stock, pero la etiqueta recién se podrá imprimir en la próxima jornada." : null}
          </p>
        </div>
      ) : null}

      {hayStockInsuficiente ? (
        <div role="alert" className="alert alert-danger">
          <CircleAlert aria-hidden />
          <p>
            {lineasSinStock === 1 ? "Una línea no tiene" : `${lineasSinStock} líneas no tienen`} stock suficiente: no se puede {esReserva ? "reservar" : "confirmar"} hasta que haya saldo.
            {esReserva ? null : " Podés descartar la preparación más abajo."}
          </p>
        </div>
      ) : null}

      <ReauthAwareForm
        action={modificar ? modificarReservaStockAction : esReserva ? reservarStockAction : confirmarPreparacionAction}
        submitLabel={modificar ? "Guardar reserva" : esReserva ? "Reservar stock" : "Confirmar preparación"}
        pendingLabel={esReserva ? "Reservando…" : "Confirmando…"}
        submitDisabled={bloqueada}
        className="flex flex-col gap-4"
        extraActions={extraActions}
        onSuccess={onSuccess ? (state) => onSuccess(state.message) : undefined}
      >
        {"fichaTecnicaId" in destino ? (
          <input type="hidden" name="fichaTecnicaId" value={destino.fichaTecnicaId} />
        ) : (
          <input type="hidden" name="preparacionId" value={"reservaDePreparacionId" in destino ? destino.reservaDePreparacionId : destino.preparacionId} />
        )}

        {datos.lineas.map((linea) => (
          <fieldset key={linea.id} className="group-card" data-alerta={linea.stockInsuficiente || undefined}>
            <input type="hidden" name="lineaIds" value={linea.id} />
            <legend className="sr-only">
              Línea {linea.orden + 1}: {linea.drogaNombre}
            </legend>
            <div className="group-card-header">
              <span className="index-badge" aria-hidden>
                {linea.orden + 1}
              </span>
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">{linea.drogaNombre}</p>
              {linea.esEnraseManual ? (
                <ToneBadge tone="neutral">Enrase manual</ToneBadge>
              ) : (
                <p className="text-right text-xs text-zinc-500">
                  A pesar{" "}
                  <span className="font-mono text-sm font-semibold text-zinc-900 tabular-nums">
                    {linea.cantidadAPesar} {linea.unidadSimbolo}
                  </span>
                </p>
              )}
            </div>

            <div className="flex flex-col gap-4 p-4">
              {linea.esEnraseManual ? (
                <div className="field max-w-xs">
                  <label htmlFor={`cantidadManual_${linea.id}`} className="field-label">
                    Cantidad real registrada ({linea.unidadSimbolo})
                  </label>
                  <input
                    id={`cantidadManual_${linea.id}`}
                    name={`cantidadManual_${linea.id}`}
                    type="text"
                    inputMode="decimal"
                    required
                    defaultValue={linea.reserva?.cantidadManual ?? undefined}
                    className="input font-mono"
                  />
                </div>
              ) : linea.stockInsuficiente ? (
                <div className="alert alert-danger">
                  <CircleAlert aria-hidden />
                  <p>
                    Stock insuficiente: faltan{" "}
                    <strong className="font-mono">
                      {linea.faltante} {linea.unidadSimbolo}
                    </strong>
                    .
                  </p>
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <p className="text-xs text-zinc-500">Partidas: elegí de cuáles {esReserva ? "reservar" : "descontar"}. Los montos los calcula el sistema.</p>
                {linea.partidasElegibles.map((partida) => {
                  const propuesta = linea.propuesta?.find((p) => p.partidaId === partida.id);
                  return (
                    <label key={partida.id} className="choice-row">
                      <input
                        type="checkbox"
                        name={`partida_${linea.id}`}
                        value={partida.id}
                        checked={checked[linea.id]?.has(partida.id) ?? false}
                        onChange={() => toggle(linea.id, partida.id)}
                      />
                      <span className="grid min-w-0 flex-1 gap-x-6 gap-y-1 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                        <span className="truncate">
                          <span className="text-zinc-500">Lote </span>
                          <span className="font-mono font-medium text-zinc-900">{partida.lote}</span>
                        </span>
                        <span className="tabular-nums">
                          <span className="text-zinc-500">Disponible </span>
                          <span className="font-mono text-zinc-900">{formatNumero(partida.cantidadDisponible)}</span>
                        </span>
                        <span className="tabular-nums">
                          <span className="text-zinc-500">Vence </span>
                          <span className="text-zinc-900">{partida.fechaVencimiento ? fechaCorta(partida.fechaVencimiento) : "No vence"}</span>
                        </span>
                      </span>
                      <span className="flex flex-none flex-wrap justify-end gap-1.5">
                        {partida.fechaApertura ? <ToneBadge tone="neutral">Abierta</ToneBadge> : null}
                        {partida.potenciaDeclarada && !linea.esEnraseManual ? <ToneBadge tone="neutral">Pureza {formatNumero(partida.potenciaDeclarada)} %</ToneBadge> : null}
                        {propuesta ? <ToneBadge tone="success">Propuesto: {propuesta.cantidad.toString()}</ToneBadge> : null}
                      </span>
                    </label>
                  );
                })}
                {linea.partidasElegibles.length === 0 ? (
                  <div className="alert alert-danger">
                    <CircleAlert aria-hidden />
                    <p>No hay partidas con saldo para esta droga.</p>
                  </div>
                ) : null}
              </div>

              <div className="field">
                <label htmlFor={`motivoApertura_${linea.id}`} className="field-label">
                  Motivo de apertura adicional
                </label>
                <input
                  id={`motivoApertura_${linea.id}`}
                  name={`motivoApertura_${linea.id}`}
                  type="text"
                  defaultValue={linea.reserva?.motivoAperturaAdicional ?? undefined}
                  aria-describedby={`motivoApertura_${linea.id}_ayuda`}
                  className="input"
                />
                <p id={`motivoApertura_${linea.id}_ayuda`} className="field-help">
                  Solo si abrís una partida nueva teniendo otra abierta con saldo.
                </p>
              </div>
            </div>
          </fieldset>
        ))}
      </ReauthAwareForm>
    </div>
  );
}
