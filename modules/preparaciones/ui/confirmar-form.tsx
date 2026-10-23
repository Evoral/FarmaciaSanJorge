"use client";

/**
 * The reserva / confirmation form (M11, FASE 8 points 8.2/8.3; docs/specs/reserva-stock-preparacion.md R1, DT decision
 * 2026-10-15). For every línea it shows, read-only, the AUTOMATIC plan -- which partida (lote, vencimiento, pureza)
 * and how much to take from each, abiertas first then FEFO -- so the lab knows which bottle to grab. The user only
 * types what still needs a human:
 *   - the lot(s) to weigh from, for every línea (docs/specs/pesada-real.md): pre-checked with the automatic plan's
 *     (the oldest first; a recalculation pre-checks the current reserva's); the plan runs over the checked ones, in
 *     the same order. A línea whose partidas differ in purity (R25) warns that the weight depends on the lot;
 *   - the pesada real of a non-manual línea (docs/specs/pesada-real.md): prefilled with the expected weight of the
 *     checked lots rounded to the balance (`precision_balanza`); outside `tolerancia_pesada_porcentaje` the form asks
 *     the DT co-firma (`CoFirmaDt`);
 *   - the real quantity of an enrase manual línea (its plan follows it live: `repartirLinea`, the same function the
 *     server runs, over the línea's candidate partidas);
 *   - the motivo de apertura adicional, ONLY when INV-S18 asks for it over the plan (by construction the automatic
 *     order never does; the field stays wired for the rule).
 * The server recomputes everything under its locks: what is shown here is display-only, never sent.
 *
 * The toma workspace's pesada en la ficha (./pesaje-en-toma.tsx) reuses `planDeLinea`, `pesadaDeLinea` and
 * `lotesPorDefecto`, so the inline fields and this form compute the same plan and tolerance.
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
import { formatFechaIso } from "@/shared/format/fecha";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { CoFirmaDt } from "@/shared/ui/co-firma-dt";
import { confirmarPreparacionAction, recalcularReservaStockAction, reservarStockAction } from "./actions";
import { TipoVencimientoSelect } from "./tipo-vencimiento-select";
import type { DatosConfirmacion, LineaPantalla } from "@/modules/preparaciones/application/datos-confirmacion";
import { requiereMotivoAperturaAdicional } from "@/modules/preparaciones/domain/apertura-adicional";
import { repartirLinea, requiereElegirPartida } from "@/modules/preparaciones/domain/reparto-linea";
import { evaluarPesada, precisionDeLinea, redondearABalanza, type EvaluacionPesada } from "@/modules/preparaciones/domain/pesada-real";
import { ordenarParaConsumo } from "@/modules/stock/domain/reparto";
import { Decimal } from "@/shared/decimal";
import { numeroONull, numeroParaInput } from "@/shared/decimal/numero-ingresado";
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

/**
 * A línea's plan as the form shows it: what to take from each partida, or the faltante; `"elegir"` = its partidas
 * differ in purity and no lot is checked yet (R25); `null` = nothing to show yet (an enrase quantity not typed).
 */
export type PlanDeLinea =
  | { ok: true; partes: { partidaId: string; cantidad: string }[]; /** Physical, droga's unidad base. */ totalFisico: string; requiereMotivo: boolean }
  | { ok: false; faltante: string }
  | "elegir"
  | null;

/** Parsed like the server does (`decimalString` -> `interpretarNumero`: comma decimals); `null` unless a finite quantity > 0. */
export function cantidadValida(texto: string | undefined): Decimal | null {
  const numero = numeroONull(texto);
  if (numero === null) return null;
  const valor = new Decimal(numero);
  return valor.isFinite() && valor.greaterThan(0) ? valor : null;
}

/**
 * The plan of a línea over the checked lots (docs/specs/pesada-real.md), in consumption order: a non-manual one covers
 * its cantidadAPesar in ACTIVE terms (purity per partida); an enrase manual one the typed quantity (línea unit,
 * converted into the droga's unidad base, no purity correction) -- exactly what the server will do. `"elegir"` = no
 * lot checked while the droga has some.
 */
export function planDeLinea(linea: LineaPantalla, cantidadManual: string | undefined, elegidas: readonly string[], jornada: string): PlanDeLinea {
  const candidatas = linea.partidasElegibles.filter((p) => elegidas.includes(p.id));
  if (candidatas.length === 0 && linea.partidasElegibles.length > 0) return "elegir";
  if (!mismaMagnitud(linea.unidad, linea.unidadStock)) return null;
  let requeridaStock: Decimal;
  if (linea.esEnraseManual) {
    const cantidad = cantidadValida(cantidadManual);
    if (!cantidad) return null;
    requeridaStock = convertirCantidad(cantidad, linea.unidad, linea.unidadStock);
  } else {
    if (!linea.cantidadAPesar) return null;
    requeridaStock = convertirCantidad(new Decimal(linea.cantidadAPesar), linea.unidad, linea.unidadStock);
  }
  const resultado = repartirLinea(candidatas, requeridaStock, jornada, linea.esEnraseManual);
  if (!resultado.ok) return { ok: false, faltante: convertirCantidad(resultado.faltante, linea.unidadStock, linea.unidad).toFixed() };
  const usadas = new Set(resultado.partes.map((p) => p.partidaId));
  return {
    ok: true,
    partes: resultado.partes.map((p) => ({ partidaId: p.partidaId, cantidad: p.cantidad.toString() })),
    totalFisico: resultado.totalFisico.toString(),
    requiereMotivo: requiereMotivoAperturaAdicional(
      linea.partidasElegibles.map((p) => ({ ...p, potenciaDeclarada: linea.esEnraseManual ? null : p.potenciaDeclarada, elegida: usadas.has(p.id) })),
      requeridaStock,
      jornada,
    ),
  };
}

/** The lots pre-checked for a línea: the current reserva's, else the automatic plan's, else the first one to consume (oldest). */
export function lotesPorDefecto(linea: LineaPantalla, jornada: string): string[] {
  if (linea.reserva?.partidaIds.length) return linea.reserva.partidaIds;
  if (linea.propuesta?.length) return linea.propuesta.map((p) => p.partidaId);
  const primera = ordenarParaConsumo(linea.partidasElegibles, jornada).find((p) => new Decimal(p.cantidadDisponible).greaterThan(0));
  return primera ? [primera.id] : [];
}

/** A non-manual línea's pesada real: the expected weight (línea unit), its balance-rounded prefill and, once typed, the tolerance check. */
export interface PesadaDeLinea {
  esperada: Decimal;
  sugerida: string;
  evaluacion: EvaluacionPesada | null;
}

export function pesadaDeLinea(linea: LineaPantalla, plan: PlanDeLinea, real: string | undefined, datos: DatosConfirmacion): PesadaDeLinea | null {
  if (linea.esEnraseManual || plan === null || plan === "elegir" || !plan.ok) return null;
  const precision = precisionDeLinea(linea.unidad, datos.pesada.precisionBalanza);
  const esperada = convertirCantidad(new Decimal(plan.totalFisico), linea.unidadStock, linea.unidad);
  // Shown es-AR (comma decimals), like every typed number.
  const sugerida = numeroParaInput(redondearABalanza(esperada, precision).toFixed());
  const valor = cantidadValida(real ?? sugerida);
  return { esperada, sugerida, evaluacion: valor ? evaluarPesada(valor, esperada, datos.pesada.toleranciaPorcentaje, precision) : null };
}

export function ConfirmarPreparacionForm({ datos, destino, onSuccess, extraActions }: ConfirmarPreparacionFormProps) {
  const recalcular = "reservaDePreparacionId" in destino;
  // Reserving or recalculating a reserva (nothing is descontado yet), vs confirming.
  const esReserva = !("preparacionId" in destino);

  // Mirrors of two uncontrolled inputs: the typed enrase quantity (the línea's plan follows it) and the motivo, which
  // keeps its text while the field is hidden and shown again.
  const [cantidadesManuales, setCantidadesManuales] = useState<Record<string, string>>(() =>
    Object.fromEntries(datos.lineas.flatMap((l) => (l.reserva?.cantidadManual ? [[l.id, numeroParaInput(l.reserva.cantidadManual)]] : []))),
  );
  const [motivos, setMotivos] = useState<Record<string, string>>(() =>
    Object.fromEntries(datos.lineas.flatMap((l) => (l.reserva?.motivoAperturaAdicional ? [[l.id, l.reserva.motivoAperturaAdicional]] : []))),
  );
  // The checked lots of each línea (docs/specs/pesada-real.md; a recalculation starts from the current reserva's).
  const [elegidas, setElegidas] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(datos.lineas.map((l) => [l.id, lotesPorDefecto(l, datos.jornadaActual)])),
  );
  // The pesada real the user typed; a línea not typed shows the balance-rounded expected weight, which follows the lots.
  const [reales, setReales] = useState<Record<string, string>>(() =>
    Object.fromEntries(datos.lineas.flatMap((l) => (l.reserva?.cantidadReal ? [[l.id, numeroParaInput(l.reserva.cantidadReal)]] : []))),
  );

  // Stock amounts are DISPLAYED in a readable unit of the droga's chain (e.g. 999.999,55 mg -> 1.000 g, 2 decimals).
  const catalogo = useMemo(() => crearCatalogoUnidades(datos.unidades), [datos.unidades]);
  const planes = datos.lineas.map((linea) => planDeLinea(linea, cantidadesManuales[linea.id], elegidas[linea.id] ?? [], datos.jornadaActual));
  const pesadas = datos.lineas.map((linea, i) => pesadaDeLinea(linea, planes[i]!, reales[linea.id], datos));
  const requiereCoFirma = pesadas.some((p) => p?.evaluacion?.fueraDeTolerancia);

  const lineasSinStock = planes.filter((plan) => plan !== null && plan !== "elegir" && !plan.ok).length;
  // A reserva writes no libro: a closed jornada only matters when its etiqueta is printed.
  const bloqueada = lineasSinStock > 0 || planes.includes("elegir") || (datos.jornadaCerrada && !esReserva);

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
        accion="preparaciones.confirmar"
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
            <fieldset key={linea.id} className="group-card" data-alerta={(plan !== null && plan !== "elegir" && !plan.ok) || undefined}>
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
                      defaultValue={linea.reserva?.cantidadManual ? numeroParaInput(linea.reserva.cantidadManual) : undefined}
                      onChange={(event) => {
                        const valor = event.target.value;
                        setCantidadesManuales((prev) => ({ ...prev, [linea.id]: valor }));
                      }}
                      className="input font-mono"
                    />
                  </div>
                ) : null}

                {linea.partidasElegibles.length > 0 ? (
                  <ElegirLotes
                    linea={linea}
                    elegidas={elegidas[linea.id] ?? []}
                    onChange={(ids) => setElegidas((prev) => ({ ...prev, [linea.id]: ids }))}
                    catalogo={catalogo}
                    datos={datos}
                  />
                ) : null}

                <PlanLinea linea={linea} plan={plan} catalogo={catalogo} datos={datos} />

                {pesadas[indice] ? (
                  <PesadaReal
                    linea={linea}
                    pesada={pesadas[indice]!}
                    valor={reales[linea.id] ?? pesadas[indice]!.sugerida}
                    tolerancia={datos.pesada.toleranciaPorcentaje}
                    onChange={(valor) => setReales((prev) => ({ ...prev, [linea.id]: valor }))}
                  />
                ) : null}

                {plan !== null && plan !== "elegir" && plan.ok && plan.requiereMotivo ? (
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

        {requiereCoFirma ? <CoFirmaDt dts={datos.dts} titulo="Co-firma del Director Técnico (pesada fuera de tolerancia)" /> : null}

        {/* docs/specs/vencimiento-preparado.md R10: dated only when confirming, never on a reserva. */}
        {esReserva ? null : (
          <TipoVencimientoSelect id="tipoVencimiento" name="tipoVencimiento" label="Vencimiento del preparado" mesesEstandar={datos.mesesVencimientoPreparado} />
        )}
      </ReauthAwareForm>
    </div>
  );
}

/** The línea's automatic plan, read-only: one row per partida to take from (lote, vence, pureza, cantidad), or the faltante. */
function PlanLinea({ linea, plan, catalogo, datos }: { linea: LineaPantalla; plan: PlanDeLinea; catalogo: CatalogoUnidades; datos: DatosConfirmacion }) {
  if (plan === "elegir") return <p className="text-xs text-zinc-500">Elegí el lote del que vas a pesar para ver cuánto tomar.</p>;
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
                  <span className="text-zinc-900">{partida?.fechaVencimiento ? formatFechaIso(partida.fechaVencimiento) : "No vence"}</span>
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

/**
 * The lot(s) the línea is weighed from (docs/specs/pesada-real.md; consumption order: abiertas first, then FEFO). With
 * several checked, the first is used up before the next; one that covers the línea is enough. R25: when the partidas
 * differ in purity the weight depends on the lot, and the block says so.
 */
function ElegirLotes({
  linea,
  elegidas,
  onChange,
  catalogo,
  datos,
}: {
  linea: LineaPantalla;
  elegidas: readonly string[];
  onChange: (ids: string[]) => void;
  catalogo: CatalogoUnidades;
  datos: DatosConfirmacion;
}) {
  const partidas = ordenarParaConsumo(linea.partidasElegibles, datos.jornadaActual);
  const disponibles = formatCantidadesFila(
    partidas.map((p) => p.cantidadDisponible),
    linea.unidadStock,
    catalogo,
  );
  const ayudaId = `partidas_${linea.id}_ayuda`;
  return (
    <div className="flex flex-col gap-2" role="group" aria-describedby={ayudaId}>
      {requiereElegirPartida(linea.partidasElegibles, linea.esEnraseManual) ? (
        <div role="note" className="alert alert-warn">
          <TriangleAlert aria-hidden />
          <p id={ayudaId}>
            Las partidas de esta droga tienen distinta pureza: la cantidad a pesar depende del lote. Marcá el lote del que vas a pesar; si marcás varios, se termina el primero
            y el resto sale del siguiente.
          </p>
        </div>
      ) : (
        <p id={ayudaId} className="text-xs text-zinc-500">
          Lote del que vas a pesar (por defecto, el que se usa primero). Si marcás varios, se termina el primero y el resto sale del siguiente.
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {partidas.map((partida, i) => {
          const disponible = disponibles[i]!;
          const vencimiento = estadoVencimientoPartida(partida.fechaVencimiento, datos.jornadaActual, datos.diasAlertaVencimiento);
          return (
            <li key={partida.id}>
              <label className="choice-row cursor-pointer">
                <input
                  type="checkbox"
                  name={`partidas_${linea.id}`}
                  value={partida.id}
                  checked={elegidas.includes(partida.id)}
                  onChange={(event) => {
                    const marcada = event.target.checked;
                    onChange(marcada ? [...elegidas, partida.id] : elegidas.filter((id) => id !== partida.id));
                  }}
                />
                <span className="grid min-w-0 flex-1 gap-x-6 gap-y-1 sm:flex-none sm:grid-cols-[9rem_10rem_10rem]">
                  <span className="truncate">
                    <span className="text-zinc-500">Lote </span>
                    <span className="font-mono font-medium text-zinc-900">{partida.lote}</span>
                  </span>
                  <span className="flex justify-between gap-2 tabular-nums">
                    <span className="text-zinc-500">Vence</span>
                    <span className="text-zinc-900">{partida.fechaVencimiento ? formatFechaIso(partida.fechaVencimiento) : "No vence"}</span>
                  </span>
                  <span className="flex justify-between gap-2 tabular-nums" title={disponible.exacto}>
                    <span className="text-zinc-500">Disponible</span>
                    <span className="font-mono text-zinc-900">{disponible.texto}</span>
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap justify-end gap-1.5">
                  <ToneBadge tone="neutral">Pureza {partida.potenciaDeclarada ? formatNumero(partida.potenciaDeclarada) : "100"} %</ToneBadge>
                  {partida.fechaApertura ? <ToneBadge tone="neutral">Abierta</ToneBadge> : null}
                  {vencimiento === "POR_VENCER" && partida.fechaVencimiento ? <ToneBadge tone="warn">{textoPorVencer(partida.fechaVencimiento, datos.jornadaActual)}</ToneBadge> : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The pesada real of a non-manual línea (docs/specs/pesada-real.md): what the balance showed, prefilled with the
 * expected weight of the checked lots rounded to the balance. Shows the deviation once typed; outside the tolerance
 * the form adds the DT co-firma (the server re-checks everything).
 */
function PesadaReal({
  linea,
  pesada,
  valor,
  tolerancia,
  onChange,
}: {
  linea: LineaPantalla;
  pesada: PesadaDeLinea;
  valor: string;
  tolerancia: string;
  onChange: (valor: string) => void;
}) {
  const campoId = `cantidadReal_${linea.id}`;
  const evaluacion = pesada.evaluacion;
  return (
    <div className="flex flex-col gap-2">
      <div className="field max-w-xs">
        <label htmlFor={campoId} className="field-label">
          Pesada real ({linea.unidadSimbolo})
        </label>
        <input
          id={campoId}
          name={campoId}
          type="text"
          inputMode="decimal"
          required
          value={valor}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={`${campoId}_ayuda`}
          className="input font-mono"
        />
        <p id={`${campoId}_ayuda`} className="field-help">
          Esperada {formatNumero(pesada.esperada.toString())} {linea.unidadSimbolo}
          {evaluacion ? ` · desvío ${evaluacion.desvioPorcentaje.greaterThan(0) ? "+" : ""}${formatNumero(evaluacion.desvioPorcentaje.toString())} %` : null}
          {` · tolerancia ±${formatNumero(tolerancia)} %`}
        </p>
      </div>
      {evaluacion?.fueraDeTolerancia ? (
        <div role="alert" className="alert alert-warn">
          <TriangleAlert aria-hidden />
          <p>La pesada está fuera de la tolerancia: volvé a pesar o pedí la co-firma del Director Técnico al final del formulario.</p>
        </div>
      ) : null}
    </div>
  );
}
