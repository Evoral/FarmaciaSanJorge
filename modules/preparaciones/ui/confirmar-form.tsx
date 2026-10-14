"use client";

/**
 * The confirmación screen (M11, FASE 8 points 8.2/8.3). For every non-manual
 * línea, shows the system's OWN proposed split (read-only amounts, INV-S13/
 * S20) with a checkbox per eligible partida so the farmacéutico may choose
 * DIFFERENT partidas (INV-S15) -- the amounts are always recomputed by the
 * SERVER for whatever selection is submitted, never sent from here. For
 * manual-enrase lines, a required quantity input (the ONLY quantity this
 * form ever lets the user type). `motivoApertura_<lineaId>` only shows (and
 * is required) when the current choice needs it: INV-S18's own pure rule
 * (`requiereMotivoAperturaAdicional`, the one `confirmarPreparacion` runs
 * against fresh balances) over the línea's partidas, the checked ones and
 * its required quantity. The server still has the last word: with stale
 * balances it rejects the submission with its own message.
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
import { useMemo, useState, type ReactNode } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { ToneBadge } from "@/shared/ui/status-badge";
import { crearCatalogoUnidades, formatCantidad, formatCantidadesFila, formatNumero } from "@/shared/format/cantidad";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { confirmarPreparacionAction, modificarReservaStockAction, reservarStockAction } from "./actions";
import type { DatosConfirmacion, LineaPantalla } from "@/modules/preparaciones/application/datos-confirmacion";
import { requiereMotivoAperturaAdicional } from "@/modules/preparaciones/domain/apertura-adicional";
import { Decimal } from "@/shared/decimal";
import { MENSAJE_VENCIDA_REQUIERE_DT, estadoVencimientoPartida, textoPorVencer } from "@/modules/stock/domain/vencimiento-partida";
import { convertirCantidad, mismaMagnitud } from "@/shared/decimal/convertir-unidad";

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

/**
 * INV-S18 for the current choice: does it open a cerrada partida while the abiertas alone cover the línea? `cantidadManual`
 * is the typed enrase quantity (manual lines); without a valid quantity there is nothing to compare yet.
 */
function pideMotivoApertura(linea: LineaPantalla, elegidas: ReadonlySet<string>, cantidadManual: string | undefined, jornadaActual: string): boolean {
  if (!mismaMagnitud(linea.unidad, linea.unidadStock)) return false;
  let requerida: Decimal;
  try {
    // Parsed like the server does (`decimalString`: `new Decimal`).
    requerida = new Decimal((linea.esEnraseManual ? cantidadManual : linea.cantidadAPesar)?.trim() ?? "");
  } catch {
    return false;
  }
  if (!requerida.isFinite() || requerida.lessThanOrEqualTo(0)) return false;
  const partidas = linea.partidasElegibles.map((p) => ({
    ...p,
    // Manual enrase compares physical quantities, as the confirmation does.
    potenciaDeclarada: linea.esEnraseManual ? null : p.potenciaDeclarada,
    elegida: elegidas.has(p.id),
  }));
  return requiereMotivoAperturaAdicional(partidas, convertirCantidad(requerida, linea.unidad, linea.unidadStock), jornadaActual);
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
        // A vencida partida is blocked until the DT acts (docs/specs/reanalisis-partida.md): never preselected.
        initial[linea.id] = new Set(
          linea.partidasElegibles.filter((p) => estadoVencimientoPartida(p.fechaVencimiento, datos.jornadaActual, datos.diasAlertaVencimiento) !== "VENCIDA").map((p) => p.id),
        );
      }
    }
    return initial;
  });

  // Mirrors of two uncontrolled inputs: the typed enrase quantity (INV-S18 needs it) and the motivo, which keeps its text
  // while the field is hidden and shown again.
  const [cantidadesManuales, setCantidadesManuales] = useState<Record<string, string>>(() =>
    Object.fromEntries(datos.lineas.flatMap((l) => (l.reserva?.cantidadManual ? [[l.id, l.reserva.cantidadManual]] : []))),
  );
  const [motivos, setMotivos] = useState<Record<string, string>>(() =>
    Object.fromEntries(datos.lineas.flatMap((l) => (l.reserva?.motivoAperturaAdicional ? [[l.id, l.reserva.motivoAperturaAdicional]] : []))),
  );

  function toggle(lineaId: string, partidaId: string) {
    setChecked((prev) => {
      const next = new Set(prev[lineaId]);
      if (next.has(partidaId)) next.delete(partidaId);
      else next.add(partidaId);
      return { ...prev, [lineaId]: next };
    });
  }

  // Stock amounts are DISPLAYED in a readable unit of the droga's chain (e.g. 999.999,55 mg -> 1.000 g, 2 decimals);
  // what is submitted and validated stays in the droga's unidad base.
  const catalogo = useMemo(() => crearCatalogoUnidades(datos.unidades), [datos.unidades]);

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
              Nadie más puede usarlo. El stock se descuenta y el asiento se escribe en el libro recetario recién al imprimir las etiquetas de la receta; hasta entonces podés liberar
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
        submitLabel={modificar ? "Guardar reserva" : esReserva ? "Marcar como preparada" : "Confirmar preparación"}
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
                    onChange={(event) => {
                      const valor = event.target.value;
                      setCantidadesManuales((prev) => ({ ...prev, [linea.id]: valor }));
                    }}
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
                {linea.partidasElegibles.map((partida, indice, partidas) => {
                  const propuesta = linea.propuesta?.find((p) => p.partidaId === partida.id);
                  // One display unit for every partida of the línea, so their balances read side by side.
                  const disponible = formatCantidadesFila(
                    partidas.map((p) => p.cantidadDisponible),
                    linea.unidadStock,
                    catalogo,
                  )[indice]!;
                  // Expiry on the vencimiento vigente (reanálisis-aware): a vencida partida can not be chosen.
                  const vencimiento = estadoVencimientoPartida(partida.fechaVencimiento, datos.jornadaActual, datos.diasAlertaVencimiento);
                  const vencida = vencimiento === "VENCIDA";
                  return (
                    <label key={partida.id} className="choice-row" aria-disabled={vencida || undefined}>
                      <input
                        type="checkbox"
                        name={`partida_${linea.id}`}
                        value={partida.id}
                        checked={!vencida && (checked[linea.id]?.has(partida.id) ?? false)}
                        disabled={vencida}
                        title={vencida ? MENSAJE_VENCIDA_REQUIERE_DT : undefined}
                        onChange={() => toggle(linea.id, partida.id)}
                      />
                      {/* Fixed column widths (not fractions of the space the badges leave): every row of every línea lines up. */}
                      <span className="grid min-w-0 flex-1 gap-x-6 gap-y-1 sm:flex-none sm:grid-cols-[9rem_12rem_8.5rem]">
                        <span className="truncate">
                          <span className="text-zinc-500">Lote </span>
                          <span className="font-mono font-medium text-zinc-900">{partida.lote}</span>
                        </span>
                        <span className="flex justify-between gap-2 tabular-nums" title={disponible.exacto}>
                          <span className="text-zinc-500">Disponible</span>
                          <span className="font-mono text-zinc-900">{disponible.texto}</span>
                        </span>
                        <span className="flex justify-between gap-2 tabular-nums">
                          <span className="text-zinc-500">Vence</span>
                          <span className="text-zinc-900">{partida.fechaVencimiento ? fechaCorta(partida.fechaVencimiento) : "No vence"}</span>
                        </span>
                      </span>
                      <span className="flex min-w-0 flex-1 flex-wrap justify-end gap-1.5">
                        {vencida ? <ToneBadge tone="danger">{MENSAJE_VENCIDA_REQUIERE_DT}</ToneBadge> : null}
                        {vencimiento === "POR_VENCER" && partida.fechaVencimiento ? <ToneBadge tone="warn">{textoPorVencer(partida.fechaVencimiento, datos.jornadaActual)}</ToneBadge> : null}
                        {partida.reanalizada ? <ToneBadge tone="neutral">Reanalizada</ToneBadge> : null}
                        {partida.fechaApertura ? <ToneBadge tone="neutral">Abierta</ToneBadge> : null}
                        {partida.potenciaDeclarada && !linea.esEnraseManual ? <ToneBadge tone="neutral">Pureza {formatNumero(partida.potenciaDeclarada)} %</ToneBadge> : null}
                        {propuesta ? (
                          <span title={formatCantidad(propuesta.cantidad, linea.unidadStock, catalogo).exacto}>
                            <ToneBadge tone="success">Propuesto: {formatCantidad(propuesta.cantidad, linea.unidadStock, catalogo).texto}</ToneBadge>
                          </span>
                        ) : null}
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

              {pideMotivoApertura(linea, checked[linea.id] ?? new Set(), cantidadesManuales[linea.id], datos.jornadaActual) ? (
                <div className="field">
                  <label htmlFor={`motivoApertura_${linea.id}`} className="field-label">
                    Motivo de apertura adicional
                  </label>
                  <input
                    id={`motivoApertura_${linea.id}`}
                    name={`motivoApertura_${linea.id}`}
                    type="text"
                    required
                    defaultValue={motivos[linea.id]}
                    onChange={(event) => {
                      const valor = event.target.value;
                      setMotivos((prev) => ({ ...prev, [linea.id]: valor }));
                    }}
                    aria-describedby={`motivoApertura_${linea.id}_ayuda`}
                    className="input"
                  />
                  <p id={`motivoApertura_${linea.id}_ayuda`} className="field-help">
                    Elegiste abrir una partida nueva aunque la que ya está abierta alcanza: indicá por qué.
                  </p>
                </div>
              ) : null}
            </div>
          </fieldset>
        ))}
      </ReauthAwareForm>
    </div>
  );
}
