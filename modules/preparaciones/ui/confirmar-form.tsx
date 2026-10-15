"use client";

/**
 * The reserva / confirmation form (M11, FASE 8 points 8.2/8.3; docs/specs/reserva-stock-preparacion.md R1, DT decision
 * 2026-10-15). Nobody chooses partidas: for every línea it shows, read-only, the AUTOMATIC plan -- which partida
 * (lote, vencimiento, pureza) and how much to take from each, abiertas first then FEFO -- so the lab knows which
 * bottle to grab. The user only types what still needs a human:
 *   - the real quantity of an enrase manual línea (its plan follows it live: `repartirLinea`, the same function the
 *     server runs, over the línea's candidate partidas);
 *   - the motivo de apertura adicional, ONLY when INV-S18 asks for it over the plan (by construction the automatic
 *     order never does; the field stays wired for the rule).
 * The server recomputes everything under its locks: what is shown here is display-only, never sent.
 *
 * Three destinations, same fields: a ficha técnica from the toma workspace's "Marcar como preparada" dialog
 * (`reservarStockAction`: creates the preparación and RESERVES the stock; stock and libro recetario are fixed later,
 * at "Imprimir etiquetas"), a reserved preparación from its "Recalcular reserva" dialog (`recalcularReservaStockAction`:
 * re-plans it; the form starts from the current enrase quantity/motivo, `linea.reserva`), or an INICIADA preparación
 * without reserva on `/preparaciones/[id]` (`confirmarPreparacionAction`). A línea without enough stock shows its
 * faltante (línea unit) and disables the submit; so does a closed jornada (`cierre_diario`) for the confirmation -- a
 * reserva only warns that its etiqueta can not be printed today. Behind re-authentication (`ReauthAwareForm`), which
 * keeps every typed value when the server refuses.
 */
import { useMemo, useState, type ReactNode } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { ToneBadge } from "@/shared/ui/status-badge";
import { crearCatalogoUnidades, formatCantidadesFila, formatNumero, type CatalogoUnidades } from "@/shared/format/cantidad";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { confirmarPreparacionAction, recalcularReservaStockAction, reservarStockAction } from "./actions";
import type { DatosConfirmacion, LineaPantalla } from "@/modules/preparaciones/application/datos-confirmacion";
import { requiereMotivoAperturaAdicional } from "@/modules/preparaciones/domain/apertura-adicional";
import { repartirLinea } from "@/modules/preparaciones/domain/reparto-linea";
import { Decimal } from "@/shared/decimal";
import { estadoVencimientoPartida, textoPorVencer } from "@/modules/stock/domain/vencimiento-partida";
import { convertirCantidad, mismaMagnitud } from "@/shared/decimal/convertir-unidad";

export interface ConfirmarPreparacionFormProps {
  datos: DatosConfirmacion;
  /**
   * An INICIADA preparación to confirm (it can still be discarded below the form), the ficha técnica a new preparación
   * is created from on submit (its stock reserved), or a preparación whose reserva is recalculated.
   */
  destino: { preparacionId: string } | { fichaTecnicaId: string } | { reservaDePreparacionId: string };
  /** After a successful submit (the page is refreshed anyway); receives the success message. */
  onSuccess?: (message: string | undefined) => void;
  /** E.g. the dialog's "Cancelar" (`type="button"`), next to the submit. */
  extraActions?: ReactNode;
}

/** A línea's plan as the form shows it: what to take from each partida, or the faltante; `null` = nothing to show yet (an enrase quantity not typed). */
type PlanDeLinea = { ok: true; partes: { partidaId: string; cantidad: string }[]; requiereMotivo: boolean } | { ok: false; faltante: string } | null;

/** Parsed like the server does (`decimalString`: `new Decimal`); `null` unless a finite quantity > 0. */
function cantidadValida(texto: string | undefined): Decimal | null {
  try {
    const valor = new Decimal(texto?.trim() ?? "");
    return valor.isFinite() && valor.greaterThan(0) ? valor : null;
  } catch {
    return null;
  }
}

/**
 * The plan of a línea: the server's for a non-manual one; for an enrase manual one, `repartirLinea` over its candidates
 * with the typed quantity (línea unit, converted into the droga's unidad base, no purity correction) -- exactly what
 * the server will do.
 */
function planDeLinea(linea: LineaPantalla, cantidadManual: string | undefined, jornada: string): PlanDeLinea {
  if (!linea.esEnraseManual) {
    if (linea.stockInsuficiente) return { ok: false, faltante: linea.faltante ?? "" };
    return linea.propuesta ? { ok: true, partes: linea.propuesta, requiereMotivo: linea.requiereMotivo } : null;
  }
  const cantidad = cantidadValida(cantidadManual);
  if (!cantidad || !mismaMagnitud(linea.unidad, linea.unidadStock)) return null;
  const requeridaStock = convertirCantidad(cantidad, linea.unidad, linea.unidadStock);
  const resultado = repartirLinea(linea.partidasElegibles, requeridaStock, jornada, true);
  if (!resultado.ok) return { ok: false, faltante: convertirCantidad(resultado.faltante, linea.unidadStock, linea.unidad).toFixed() };
  const usadas = new Set(resultado.partes.map((p) => p.partidaId));
  return {
    ok: true,
    partes: resultado.partes.map((p) => ({ partidaId: p.partidaId, cantidad: p.cantidad.toString() })),
    requiereMotivo: requiereMotivoAperturaAdicional(
      linea.partidasElegibles.map((p) => ({ ...p, potenciaDeclarada: null, elegida: usadas.has(p.id) })),
      requeridaStock,
      jornada,
    ),
  };
}

function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short" }).format(new Date(`${iso}T00:00:00`));
}

export function ConfirmarPreparacionForm({ datos, destino, onSuccess, extraActions }: ConfirmarPreparacionFormProps) {
  const recalcular = "reservaDePreparacionId" in destino;
  // Reserving or recalculating a reserva (nothing is descontado yet), vs confirming.
  const esReserva = !("preparacionId" in destino);

  // Mirrors of two uncontrolled inputs: the typed enrase quantity (the línea's plan follows it) and the motivo, which
  // keeps its text while the field is hidden and shown again.
  const [cantidadesManuales, setCantidadesManuales] = useState<Record<string, string>>(() =>
    Object.fromEntries(datos.lineas.flatMap((l) => (l.reserva?.cantidadManual ? [[l.id, l.reserva.cantidadManual]] : []))),
  );
  const [motivos, setMotivos] = useState<Record<string, string>>(() =>
    Object.fromEntries(datos.lineas.flatMap((l) => (l.reserva?.motivoAperturaAdicional ? [[l.id, l.reserva.motivoAperturaAdicional]] : []))),
  );

  // Stock amounts are DISPLAYED in a readable unit of the droga's chain (e.g. 999.999,55 mg -> 1.000 g, 2 decimals).
  const catalogo = useMemo(() => crearCatalogoUnidades(datos.unidades), [datos.unidades]);
  const planes = datos.lineas.map((linea) => planDeLinea(linea, cantidadesManuales[linea.id], datos.jornadaActual));

  const lineasSinStock = planes.filter((plan) => plan !== null && !plan.ok).length;
  // A reserva writes no libro: a closed jornada only matters when its etiqueta is printed.
  const bloqueada = lineasSinStock > 0 || (datos.jornadaCerrada && !esReserva);

  return (
    <div className="flex flex-col gap-5">
      {esReserva ? (
        <div role="note" className="alert alert-info">
          <Info aria-hidden />
          <div>
            <p className="font-semibold">El sistema reserva el stock: primero las partidas abiertas, después las que vencen antes.</p>
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
            <p>Al confirmar se descuenta stock de las partidas indicadas y se escribe un asiento en el libro recetario, que no se puede editar ni deshacer.</p>
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

      {lineasSinStock > 0 ? (
        <div role="alert" className="alert alert-danger">
          <CircleAlert aria-hidden />
          <p>
            {lineasSinStock === 1 ? "Una línea no tiene" : `${lineasSinStock} líneas no tienen`} stock suficiente: no se puede {esReserva ? "reservar" : "confirmar"} hasta que haya saldo.
            {esReserva ? null : " Podés descartar la preparación más abajo."}
          </p>
        </div>
      ) : null}

      <ReauthAwareForm
        action={recalcular ? recalcularReservaStockAction : esReserva ? reservarStockAction : confirmarPreparacionAction}
        submitLabel={recalcular ? "Recalcular reserva" : esReserva ? "Marcar como preparada" : "Confirmar preparación"}
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

        {datos.lineas.map((linea, indice) => {
          const plan = planes[indice]!;
          return (
            <fieldset key={linea.id} className="group-card" data-alerta={(plan !== null && !plan.ok) || undefined}>
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
                ) : null}

                <PlanLinea linea={linea} plan={plan} catalogo={catalogo} datos={datos} />

                {plan?.ok && plan.requiereMotivo ? (
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
                      Se abre una partida nueva aunque la que ya está abierta alcanza: indicá por qué.
                    </p>
                  </div>
                ) : null}
              </div>
            </fieldset>
          );
        })}
      </ReauthAwareForm>
    </div>
  );
}

/** The línea's automatic plan, read-only: one row per partida to take from (lote, vence, pureza, cantidad), or the faltante. */
function PlanLinea({ linea, plan, catalogo, datos }: { linea: LineaPantalla; plan: PlanDeLinea; catalogo: CatalogoUnidades; datos: DatosConfirmacion }) {
  if (plan === null) {
    if (linea.esEnraseManual) return <p className="text-xs text-zinc-500">Ingresá la cantidad real para ver de qué partidas se toma.</p>;
    return (
      <div className="alert alert-danger">
        <CircleAlert aria-hidden />
        <p>No se puede calcular de qué partidas se toma esta línea (unidad incompatible con el stock de la droga).</p>
      </div>
    );
  }
  if (!plan.ok) {
    return (
      <div className="alert alert-danger">
        <CircleAlert aria-hidden />
        <p>
          Stock insuficiente: faltan{" "}
          <strong className="font-mono">
            {formatNumero(plan.faltante)} {linea.unidadSimbolo}
          </strong>
          .
        </p>
      </div>
    );
  }

  // One display unit for every partida of the línea, so the quantities read side by side.
  const cantidades = formatCantidadesFila(
    plan.partes.map((p) => p.cantidad),
    linea.unidadStock,
    catalogo,
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-500">{plan.partes.length === 1 ? "Se toma de esta partida:" : `Se toma de estas ${plan.partes.length} partidas, en este orden:`}</p>
      <ul className="flex flex-col gap-1.5">
        {plan.partes.map((parte, i) => {
          const partida = linea.partidasElegibles.find((p) => p.id === parte.partidaId);
          const vencimiento = partida ? estadoVencimientoPartida(partida.fechaVencimiento, datos.jornadaActual, datos.diasAlertaVencimiento) : null;
          const cantidad = cantidades[i]!;
          return (
            <li key={parte.partidaId} className="choice-row">
              {/* Fixed column widths: every row of every línea lines up. */}
              <span className="grid min-w-0 flex-1 gap-x-6 gap-y-1 sm:flex-none sm:grid-cols-[9rem_10rem_10rem]">
                <span className="truncate">
                  <span className="text-zinc-500">Lote </span>
                  <span className="font-mono font-medium text-zinc-900">{partida?.lote ?? "—"}</span>
                </span>
                <span className="flex justify-between gap-2 tabular-nums">
                  <span className="text-zinc-500">Vence</span>
                  <span className="text-zinc-900">{partida?.fechaVencimiento ? fechaCorta(partida.fechaVencimiento) : "No vence"}</span>
                </span>
                <span className="flex justify-between gap-2 tabular-nums" title={cantidad.exacto}>
                  <span className="text-zinc-500">Tomar</span>
                  <span className="font-mono font-semibold text-zinc-900">{cantidad.texto}</span>
                </span>
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap justify-end gap-1.5">
                {vencimiento === "POR_VENCER" && partida?.fechaVencimiento ? <ToneBadge tone="warn">{textoPorVencer(partida.fechaVencimiento, datos.jornadaActual)}</ToneBadge> : null}
                {partida?.reanalizada ? <ToneBadge tone="neutral">Reanalizada</ToneBadge> : null}
                {partida?.fechaApertura ? <ToneBadge tone="neutral">Abierta</ToneBadge> : null}
                {partida?.potenciaDeclarada && !linea.esEnraseManual ? <ToneBadge tone="neutral">Pureza {formatNumero(partida.potenciaDeclarada)} %</ToneBadge> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
