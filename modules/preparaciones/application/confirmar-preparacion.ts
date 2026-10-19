/**
 * `confirmarPreparacion` (M11, FASE 8 point 8.3). The LEGAL CORE of the
 * system: ONE `defineCommand`, ONE transaction (`shared/usecase.ts`'s
 * `withTenantTransaction`) -- confirming a preparación moves stock AND
 * writes the pharmacy's official book (libro recetario), atomically.
 *
 * Pipeline (`shared/usecase.ts`, in this exact order):
 *   1. requireSession -> authorize('preparaciones.confirmar') ->
 *      requireRecentReauth (INV-X02, `requireRecentReauth: { maxAgeMinutes }`
 *      below) -> zod.parse -- ALL before a transaction is even opened.
 *   2. withTenantTransaction opens the transaction (READ COMMITTED, Postgres
 *      default) and this handler runs inside it:
 *      a. Lock `preparacion` FOR UPDATE; verify INICIADA (friendly message
 *         -- INV-P05 is the DB backstop).
 *      b. Friendly pre-check that today's jornada has no `cierre_diario`
 *         yet (INV-C03 is the DB backstop -- see
 *         `existeCierreParaJornada`'s doc comment).
 *      b2. Lock the receta FOR UPDATE and re-read its estado: only
 *         PENDIENTE_PREPARACION / EN_PREPARACION may get an asiento (an
 *         ANULADA or terminal receta is refused, never silently skipped);
 *         the preparación's ficha must still be the ítem's LATEST version
 *         (docs/specs/reserva-stock-preparacion.md R19/R24). The receta is
 *         locked BEFORE the partidas: preparación -> receta -> partidas, the
 *         order of every preparación command (R23).
 *      c-e. `planificarConsumoEnTx`: the líneas are the ficha's; the
 *         partidas are chosen by the SYSTEM (docs/specs/reserva-stock-preparacion.md
 *         R1, DT decision 2026-10-15): every eligible partida of each
 *         línea's droga ("automatica"), or the partidas a reserva holds
 *         ("reservada", "Imprimir etiquetas"), locked in ONE id-ordered
 *         statement (S11 -- see `lockPartidasParaConfirmacion`), re-read,
 *         and split per línea by `repartirLinea` (domain/reparto-linea.ts:
 *         abiertas first, then FEFO; non-manual líneas in ACTIVE terms via
 *         `proponerRepartoActivo`, domain/potencia.ts -- `cantidadAPesar` is
 *         the active ingredient required, stock moves in PHYSICAL units and
 *         each movimiento records `potencia_aplicada`; manual-enrase líneas
 *         take the typed quantity, no purity correction). UNITS: the línea's
 *         quantity is in the línea's unit (its magnitud's base, e.g. g);
 *         stock is in the droga's unidad base (e.g. mg); the requirement is
 *         converted BEFORE the split, so every stock quantity is in the
 *         droga's unidad base, while the libro recetario (detalle + fórmula)
 *         and the "faltan X" message stay in the línea's unit. Expired
 *         partidas, insufficient stock, INV-S15 desvío and INV-S18's motivo
 *         are checked; then one `EGRESO_PREPARACION` per split line (the DB
 *         trigger updates the balance, sets `fecha_apertura`, and -- via a
 *         DEFERRED constraint trigger -- requires a matching
 *         `asiento_contralor` row when the contralor is active, which this
 *         handler inserts explicitly right after each movimiento of a
 *         controlled droga).
 *      f. The ítem's libro data -- its fórmula text, its `detalle_asiento`
 *         lines and the controlled movimientos still owed an
 *         `asiento_contralor` -- is RETURNED, not written: D8 (one asiento
 *         per receta, docs/specs/libro-recetario-y-contralor.md §1) writes
 *         ONE `asiento_recetario` for every ítem confirmed in the
 *         transaction, after the last one (`registrarAsientoRecetaEnTx`,
 *         ./registrar-asiento-receta.ts). Insumos (droga.clase
 *         EXCIPIENTE/MATERIAL, migration 0063) consume stock like any line
 *         but are left out of the detalle and the fórmula text -- unless
 *         EVERY line is an insumo, in which case all are recorded (an
 *         ítem never ends up without its fórmula).
 *      g. UPDATE `preparacion` -> CONFIRMADA, `preparada_por_id` = the
 *         SESSION user (INV-P06 -- never from input), and snapshot
 *         `fecha_vencimiento` = the confirmation's jornada (tenant-local,
 *         `fsj.jornada_actual`) + the tenant's `meses_vencimiento_preparado`
 *         calendar months (DP-28 "Vencimiento"; migration 0068). It is a
 *         snapshot: changing the parameter later never moves it.
 *      h. UPDATE the receta's estado: PENDIENTE_PREPARACION ->
 *         EN_PREPARACION on its FIRST confirmation (starting or reserving a
 *         preparación no longer moves it -- docs/specs/reserva-stock-preparacion.md),
 *         then EN_PREPARACION -> PREPARADA once EVERY item_receta of the
 *         receta has a CONFIRMADA preparación (INV-P03.4). Both are forward
 *         moves the DB state machine allows, one after the other.
 *      i. `audit.record` runs automatically after this handler returns
 *         (shared/usecase.ts's `defineCommand`, SAME transaction).
 *   3. Any failure at any point -> the WHOLE transaction rolls back --
 *      nothing above ever partially persists (see tests/preparaciones-confirmar-atomicidad.test.ts).
 *
 * Steps 2a-2h live in `confirmarPreparacionEnTx`, so the toma workspace's
 * "Imprimir etiquetas" (`confirmarReservasReceta`, ./confirmar-reservas-receta.ts,
 * via ./confirmar-desde-reservas.ts) runs the very same confirmation from each
 * preparación's reserva de stock (migration 0071,
 * docs/specs/reserva-stock-preparacion.md), every ítem of the receta in one
 * transaction, then writes the receta's ONE asiento and the etiquetas; the
 * reservas are deleted in that same transaction.
 *
 * This command (the legacy single path, /preparaciones/[id]: a preparación
 * INICIADA without reserva, from before R16) writes a por-receta asiento with
 * that single preparación, and is refused while another ítem of the receta is
 * not CONFIRMADA (`validarConfirmacionIndividual`, domain/asiento-receta.ts):
 * those ítems are registered together from the toma. The checks of 2c-2e (`planificarConsumoEnTx`) also
 * validate the reserva itself (./reservar-stock-preparacion.ts). Stock
 * reserved by OTHER preparaciones INICIADA is never available here.
 *
 * Every `INV-XXX` the DB can still raise (defense in depth beyond the
 * pre-checks above) is caught and mapped to a clear Spanish message via
 * `mensajeParaInvariante` (domain/mensajes-invariantes.ts) before it
 * reaches the caller.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { DomainError, NotFoundError, InvariantViolationError, mapDbError } from "@/shared/errors";
import { uuid, nonEmptyString, decimalString } from "@/shared/validation";
import { dec, Decimal } from "@/shared/decimal";
import { convertirCantidad, mismaMagnitud } from "@/shared/decimal/convertir-unidad";
import { estaVencida } from "@/modules/stock/domain/reparto";
import { tieneCorreccion, type PartidaConPotencia } from "../domain/potencia";
import { repartirLinea, repartirPesadaReal, requiereElegirPartida, type ParteDeReparto } from "../domain/reparto-linea";
import { evaluarPesada, precisionDeLinea } from "../domain/pesada-real";
import { ESTADOS_RECETA_EN_LABORATORIO } from "../domain/toma";
import {
  validarCantidadManual,
  esDesvioPropuesta,
  requiereMotivoAperturaAdicional,
} from "../domain/preparacion";
import { formatearFormulaPrescripcion } from "../domain/formula-prescripcion";
import { validarConfirmacionIndividual, type DetalleDeItem } from "../domain/asiento-receta";
import { mensajeParaInvariante } from "../domain/mensajes-invariantes";
import { calcularVencimientoPreparado } from "../domain/vencimiento";
import {
  lockPreparacionParaAccion,
  getPreparacionParaAccion,
  jornadaActualTenant,
  getMesesVencimientoPreparado,
  existeCierreParaJornada,
  getLineasParaPreparacion,
  listPartidasElegiblesDroga,
  lockPartidasParaConfirmacion,
  getPartidasFrescas,
  insertEgresoPreparacion,
  getDrogaTipoControl,
  getFechaActivacionContralor,
  updatePreparacionConfirmada,
  lockRecetaParaTransicion,
  getRecetaEstado,
  updateRecetaEstado,
  todosLosItemsConfirmados,
  getRecetaContextoAsiento,
  getUltimaFichaDeItem,
  deleteReservasDePreparacion,
  listReservasDePreparacion,
  getParametrosPesadaReal,
  insertPesadaReal,
  listItemIdsDeReceta,
  listPreparacionesVivasDeItems,
  getItemPrescriptoDePreparacion,
} from "../infrastructure/preparacion-repository";
import type { LineaParaPantalla, PartidaFresca, RecetaContextoAsiento } from "../infrastructure/preparacion-repository";
import { registrarAsientoRecetaEnTx } from "./registrar-asiento-receta";
import { autorizacionDePesadaReal } from "./co-firma-pesada-real";
import { consumirExcipienteEnTx } from "./excipiente-preparacion";

/**
 * What a user may type for a línea (2026-10-15: the partidas are chosen by the system, R1): the real quantity of an
 * enrase manual línea, only when INV-S18 asks for it the motivo de apertura adicional and, only when the droga's
 * partidas differ in purity (R25), the partidas the línea is weighed from. A línea with nothing to type is not sent.
 */
export const lineaEntradaInput = z.object({
  lineaPesajeId: uuid,
  /** Required (and validated > 0) ONLY for esEnraseManual lines -- the DB is what says whether a línea is manual, never client input. In the línea's unit. */
  cantidadManual: decimalString.optional(),
  motivoAperturaAdicional: nonEmptyString.optional(),
  /** The partidas chosen to weigh from (docs/specs/pesada-real.md; the form pre-checks the automatic plan's). Required when the línea's candidates differ in purity (R25). */
  partidaIds: z.array(uuid).optional(),
  /** Non-manual líneas: the real weighed (physical) quantity, in the línea's unit (docs/specs/pesada-real.md). Ignored for an enrase manual línea. */
  cantidadReal: decimalString.optional(),
});

/** The parsed entrada (`cantidadManual` already a `Decimal`). */
export type LineaEntrada = z.infer<typeof lineaEntradaInput>;

export interface LineaEntradaInput {
  lineaPesajeId: string;
  cantidadManual?: string;
  motivoAperturaAdicional?: string;
  partidaIds?: string[];
  cantidadReal?: string;
}

/**
 * The DT co-firma of a pesada real outside the tolerance (docs/specs/pesada-real.md). Set ONLY by the public wrappers
 * (`confirmarPreparacion`, `reservarStockPreparacion`, `recalcularReservaStock`) from `autorizacionDePesadaReal`'s
 * password check -- never from client input. The DB re-checks it is a DT vigente (migration 0088).
 */
export const pesadaAutorizadaPorIdInput = uuid.optional();

/** What the reserva / confirmation form sends for a pesada real outside the tolerance (verified, never stored as typed). */
export interface CoFirmaPesadaInput {
  dtUsuarioId?: string;
  dtPassword?: string;
}

const confirmarPreparacionInput = z.object({
  preparacionId: uuid,
  lineas: z.array(lineaEntradaInput).default([]),
  pesadaAutorizadaPorId: pesadaAutorizadaPorIdInput,
});

export interface ConfirmarPreparacionInput extends CoFirmaPesadaInput {
  preparacionId: string;
  lineas?: LineaEntradaInput[];
}

/** A reserva's línea as stored (migration 0071): the partidas it holds plus the línea's entrada. Internal, never client input. */
export interface LineaReservada {
  lineaPesajeId: string;
  partidaIds: string[];
  cantidadManual?: Decimal;
  motivoAperturaAdicional?: string;
  /** Non-manual línea weighed for real: physical, línea unit (docs/specs/pesada-real.md). */
  cantidadReal?: Decimal;
  /** The DT who co-signed `cantidadReal` outside the tolerance. */
  pesadaAutorizadaPorId?: string;
}

/** The candidates of the automatic plan, read before locking: the ficha's líneas and, per droga, its eligible (available, not expired) partidas. */
export interface CandidatosAutomaticos {
  lineas: LineaParaPantalla[];
  partidaIdsPorDroga: ReadonlyMap<string, readonly string[]>;
}

/**
 * Where the partidas of each línea come from (docs/specs/reserva-stock-preparacion.md R1):
 *   - "automatica": every eligible partida of the línea's droga, split abiertas first then FEFO; only the partidas the
 *     split draws from are "chosen". `candidatos` may be passed when the caller already locked them (Registrar pérdida).
 *   - "reservada": the partidas a reserva holds ("Imprimir etiquetas"), re-split against fresh balances.
 */
export type SeleccionDePartidas =
  | {
      modo: "automatica";
      entradas: readonly LineaEntrada[];
      candidatos?: CandidatosAutomaticos;
      /** A fresh DT co-firma (docs/specs/pesada-real.md), for every línea whose pesada real is outside the tolerance. */
      pesadaAutorizadaPorId?: string;
      /** Per línea, a reserva's stored co-firma still valid for the same pesada real (`autorizacionesDeReserva`). */
      autorizacionesPorLinea?: ReadonlyMap<string, string>;
    }
  | { modo: "reservada"; lineas: readonly LineaReservada[] };

/** What `confirmarPreparacion` returns: the preparación and its receta's asiento; `fechaVencimiento` is the `YYYY-MM-DD` snapshot written on the preparación. */
export interface ConfirmacionResultado {
  id: string;
  asientoId: string;
  numeroCorrelativo: string;
  fechaVencimiento: string;
}

/** A movimiento of a controlled droga (contralor activo): its `asiento_contralor` EGRESO needs the receta's asiento id (INV-L08, same transaction). */
export interface EgresoControlado {
  movimientoId: string;
  drogaId: string;
  drogaNombre: string;
  unidadBaseId: string;
  cantidad: string;
}

/**
 * What a per-ítem confirmation (`confirmarPreparacionEnTx`) returns: the preparación is CONFIRMADA and its stock moved,
 * but the libro is not written yet (D8) -- its fórmula, detalle lines and pending contralor egresos go into the receta's
 * ONE asiento (`registrarAsientoRecetaEnTx`, ./registrar-asiento-receta.ts), in the same transaction.
 */
export interface ConfirmacionDeItem {
  id: string;
  fechaVencimiento: string;
  /** The receta's id and snapshot data (paciente, médico), read under its lock. */
  contexto: RecetaContextoAsiento;
  /** The ítem's own fórmula (`formatearFormulaTexto`). */
  formulaTexto: string;
  /** The ítem's detalle lines, in ficha order. */
  detalles: DetalleDeItem[];
  egresosControlados: EgresoControlado[];
}

export const confirmarPreparacionCommand = defineCommand({
  name: "preparaciones.confirmar",
  permiso: "preparaciones.confirmar",
  // INV-X02: the SAME shared window every other step-up command in this
  // codebase declares (modules/{usuarios,directores-tecnicos,farmacia,parametros}/
  // application/*.ts) -- never a locally invented number.
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  input: confirmarPreparacionInput,
  audit: { entidad: "preparacion", accion: TipoAccion.CONFIRMAR },
  handler: async ({ tx, session, input }) => {
    // A preparación holding a reserva de stock is confirmed only by "Imprimir etiquetas" in the toma workspace
    // (confirmar-reservas-receta.ts), which also generates its etiqueta and writes the receta's ONE asiento (D8).
    // Checked under the preparación's lock (confirmarPreparacionEnTx re-locks it, same transaction), the same order
    // as every other preparación command.
    if (!(await lockPreparacionParaAccion(tx, session.tenantId, input.preparacionId))) {
      throw new NotFoundError("Preparación no encontrada.");
    }
    if ((await listReservasDePreparacion(tx, session.tenantId, input.preparacionId)).length > 0) {
      throw new DomainError("Esta preparación tiene stock reservado: se confirma con \"Imprimir etiquetas\" desde la receta.");
    }

    // D8: this path writes a por-receta asiento with this single preparación, so every OTHER ítem of the receta must
    // already be CONFIRMADA. Read under the receta's lock (preparación -> receta, the order of every preparación
    // command; confirmarPreparacionEnTx re-locks it): every confirmation locks the receta, so no sibling ítem can be
    // confirmed in between. A preparación no longer INICIADA gets confirmarPreparacionEnTx's own message instead.
    const preparacion = await getPreparacionParaAccion(tx, session.tenantId, input.preparacionId);
    if (!preparacion) throw new NotFoundError("Preparación no encontrada.");
    const contextoInicial = await getRecetaContextoAsiento(tx, session.tenantId, preparacion.itemRecetaId);
    if (!contextoInicial) throw new NotFoundError("No se pudo resolver el contexto de la receta para el asiento.");
    if (!(await lockRecetaParaTransicion(tx, session.tenantId, contextoInicial.recetaId))) throw new NotFoundError("Receta no encontrada.");
    const itemIds = (await listItemIdsDeReceta(tx, session.tenantId, contextoInicial.recetaId)) ?? [];
    if (preparacion.estado === "INICIADA") {
      const vivas = await listPreparacionesVivasDeItems(tx, session.tenantId, itemIds);
      validarConfirmacionIndividual(
        itemIds.map((itemRecetaId) => {
          const delItem = vivas.filter((p) => p.itemRecetaId === itemRecetaId);
          const estadoPreparacion = delItem.some((p) => p.estado === "CONFIRMADA") ? "CONFIRMADA" : delItem.some((p) => p.estado === "INICIADA") ? "INICIADA" : null;
          return { itemRecetaId, estadoPreparacion };
        }),
        preparacion.itemRecetaId,
      );
    }

    const item = await confirmarPreparacionEnTx(tx, session, {
      preparacionId: input.preparacionId,
      seleccion: { modo: "automatica", entradas: input.lineas, pesadaAutorizadaPorId: input.pesadaAutorizadaPorId },
    });
    const asiento = await registrarAsientoRecetaEnTx(tx, session, {
      contexto: item.contexto,
      items: [{ ...item, numero: itemIds.indexOf(preparacion.itemRecetaId) + 1, preparacionId: item.id }],
    });
    const confirmada: ConfirmacionResultado = { id: item.id, asientoId: asiento.id, numeroCorrelativo: asiento.numeroCorrelativo, fechaVencimiento: item.fechaVencimiento };
    return {
      output: confirmada,
      audit: {
        entidadId: confirmada.id,
        valorNuevo: {
          estado: "CONFIRMADA",
          asientoRecetarioId: confirmada.asientoId,
          asientoRecetario: `Nº ${confirmada.numeroCorrelativo}`,
          numeroCorrelativo: confirmada.numeroCorrelativo,
          fechaVencimiento: confirmada.fechaVencimiento,
        },
      },
    };
  },
});

/**
 * Steps 2a-2h of this file's doc comment, inside the caller's transaction:
 * also run by `confirmarDesdeReservasEnTx` (./confirmar-desde-reservas.ts, the
 * toma workspace's "Imprimir etiquetas") on a preparación whose stock was
 * reserved. The caller declares the permiso, the step-up and the audit, and
 * MUST then write the receta's asiento with the returned libro data
 * (`registrarAsientoRecetaEnTx`) in the same transaction -- INV-P04 and
 * INV-L08 (deferred) refuse the COMMIT otherwise. The preparación's own
 * reservas (migration 0071) are available to it and are deleted at the end:
 * its movimientos now hold that stock.
 */
export async function confirmarPreparacionEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  input: { preparacionId: string; seleccion: SeleccionDePartidas },
): Promise<ConfirmacionDeItem> {
  // ------------------------------------------------------------------
  // 1-2. Lock + verify INICIADA; friendly INV-C03 pre-check.
  // ------------------------------------------------------------------
  const locked = await lockPreparacionParaAccion(tx, session.tenantId, input.preparacionId);
  if (!locked) throw new NotFoundError("Preparación no encontrada.");

  const preparacion = await getPreparacionParaAccion(tx, session.tenantId, input.preparacionId);
  if (!preparacion) throw new NotFoundError("Preparación no encontrada.");
  if (preparacion.estado !== "INICIADA") {
    throw new DomainError(`Esta preparación ya no está INICIADA (estado actual: ${preparacion.estado}): no se puede confirmar.`);
  }

  const jornada = await jornadaActualTenant(tx, session.tenantId);
  if (await existeCierreParaJornada(tx, session.tenantId, jornada)) {
    throw new DomainError(
      "La jornada de hoy ya fue firmada por el Director Técnico: no se pueden confirmar preparaciones para el día de hoy.",
    );
  }

  // ------------------------------------------------------------------
  // 2b. The receta, locked BEFORE the partidas and re-read under the lock;
  //     the preparación's ficha must still be the ítem's latest version.
  // ------------------------------------------------------------------
  const contexto = await getRecetaContextoAsiento(tx, session.tenantId, preparacion.itemRecetaId);
  if (!contexto) throw new NotFoundError("No se pudo resolver el contexto de la receta para el asiento.");
  if (!(await lockRecetaParaTransicion(tx, session.tenantId, contexto.recetaId))) throw new NotFoundError("Receta no encontrada.");
  const estadoInicial = await getRecetaEstado(tx, session.tenantId, contexto.recetaId);
  if (!estadoInicial || !ESTADOS_RECETA_EN_LABORATORIO.has(estadoInicial)) {
    throw new DomainError(`La receta está en estado ${estadoInicial ?? "desconocido"}: no se puede confirmar la preparación ni registrarla en el libro recetario.`);
  }
  const ultimaFicha = await getUltimaFichaDeItem(tx, session.tenantId, preparacion.itemRecetaId);
  if (!ultimaFicha || ultimaFicha.id !== preparacion.fichaTecnicaId) {
    throw new DomainError(
      "La ficha técnica de esta preparación ya no es la última versión del ítem: liberá la reserva (o descartá la preparación) y volvé a prepararlo con la ficha vigente.",
    );
  }

  const detalles: Array<{ lineaPesajeId: string; descripcion: string; cantidad: string; unidadTexto: string; orden: number; esInsumo: boolean }> = [];
  // Movimientos of a controlled droga (contralor activo) collected here --
  // their asiento_contralor row needs the receta's asiento_recetario id,
  // which does not exist until every ítem of the transaction is confirmed
  // (D8): returned to the caller.
  const movimientosControlados: EgresoControlado[] = [];

  try {
    // ------------------------------------------------------------------
    // 3-5. Líneas match the ficha, partidas locked, every split computed
    //      and validated (`planificarConsumoEnTx`); then, per línea (ficha
    //      order), write EGRESO_PREPARACION (+ asiento_contralor).
    // ------------------------------------------------------------------
    const plan = await planificarConsumoEnTx(tx, session.tenantId, {
      preparacionId: input.preparacionId,
      fichaTecnicaId: preparacion.fichaTecnicaId,
      seleccion: input.seleccion,
      jornada,
    });

    for (const { linea, split: reparto, totalFisico, esDesvio, pesada } of plan) {
      if (pesada) {
        await insertPesadaReal(tx, {
          tenantId: session.tenantId,
          preparacionId: input.preparacionId,
          lineaPesajeId: linea.id,
          cantidadEsperada: pesada.esperada.toString(),
          cantidadReal: pesada.real.toString(),
          margen: pesada.margen.toString(),
          autorizadoPorId: pesada.autorizadoPorId,
          registradoPorId: session.usuario.id,
        });
      }

      const droga = await getDrogaTipoControl(tx, session.tenantId, linea.drogaId);
      const fechaActivacionContralor = await getFechaActivacionContralor(tx, session.tenantId);
      const contralorActivo = droga !== null && droga.tipoControl !== "NINGUNO" && fechaActivacionContralor !== null;
      const esInsumo = droga !== null && droga.clase !== "DROGA";

      for (const split of reparto) {
        const movimiento = await insertEgresoPreparacion(tx, {
          tenantId: session.tenantId,
          partidaId: split.partidaId,
          cantidad: split.cantidad.toString(),
          preparacionId: input.preparacionId,
          lineaPesajeId: linea.id,
          registradoPorId: session.usuario.id,
          desvioPropuesta: esDesvio,
          potenciaAplicada: split.potenciaAplicada?.toString() ?? null,
        });

        if (contralorActivo && droga) {
          movimientosControlados.push({
            movimientoId: movimiento.id,
            drogaId: linea.drogaId,
            drogaNombre: droga.nombre,
            unidadBaseId: droga.unidadBaseId,
            cantidad: split.cantidad.toString(),
          });
        }
      }

      // The libro records the REAL weighed (physical) amount, in the línea's
      // unit: equal to cantidadRequerida unless a partida's purity corrected it.
      detalles.push({
        lineaPesajeId: linea.id,
        descripcion: linea.drogaNombre,
        cantidad: totalFisico.toString(),
        unidadTexto: linea.unidadSimbolo,
        orden: linea.orden,
        esInsumo,
      });
    }

    // The excipiente (migration 0092): descontado from its reserva, no línea, no contralor, no detalle (it is in
    // the fórmula through excipiente_texto).
    await consumirExcipienteEnTx(tx, session, { preparacionId: input.preparacionId, jornada });

    // ------------------------------------------------------------------
    // 6. The ítem's libro data (written by the caller in the receta's ONE
    //    asiento, D8): detalle lines (weighed, insumos left out) and the
    //    fórmula de la prescripción -- the ítem AS PRESCRIBED, every
    //    componente plus the excipiente used (domain/formula-prescripcion.ts).
    // ------------------------------------------------------------------
    const soloInsumos = detalles.every((d) => d.esInsumo);
    const detallesLibro = detalles.filter((d) => soloInsumos || !d.esInsumo).map((d) => ({ lineaPesajeId: d.lineaPesajeId, descripcion: d.descripcion, cantidad: d.cantidad, unidadTexto: d.unidadTexto, orden: d.orden }));
    const itemPrescripto = await getItemPrescriptoDePreparacion(tx, session.tenantId, input.preparacionId);
    if (!itemPrescripto) throw new NotFoundError("No se encontró el ítem de la receta de esta preparación.");
    const formulaTexto = formatearFormulaPrescripcion(itemPrescripto);

    // ------------------------------------------------------------------
    // 7. preparación -> CONFIRMADA (preparada_por_id = SESIÓN, INV-P06).
    // ------------------------------------------------------------------
    // `jornada` is fsj.jornada_actual(tenant): the tenant-local date of the
    // elaboración. Same transaction, so the parameter read is consistent with
    // the confirmation it dates.
    const mesesVencimiento = await getMesesVencimientoPreparado(tx, session.tenantId);
    const fechaVencimiento = calcularVencimientoPreparado(jornada, mesesVencimiento);
    await updatePreparacionConfirmada(tx, session.tenantId, input.preparacionId, session.usuario.id, fechaVencimiento);

    // ------------------------------------------------------------------
    // 8. receta (locked at 2b): PENDIENTE_PREPARACION -> EN_PREPARACION con
    //    la primera confirmación; EN_PREPARACION -> PREPARADA una vez que
    //    TODOS los ítems tienen una preparación CONFIRMADA (INV-P03.4).
    //    Re-read: an earlier ítem of the same "Imprimir etiquetas" may have
    //    moved it already.
    // ------------------------------------------------------------------
    const estadoReceta = await getRecetaEstado(tx, session.tenantId, contexto.recetaId);
    if (!estadoReceta || !ESTADOS_RECETA_EN_LABORATORIO.has(estadoReceta)) {
      throw new DomainError(`La receta está en estado ${estadoReceta ?? "desconocido"}: no se puede confirmar la preparación.`);
    }
    if (estadoReceta === "PENDIENTE_PREPARACION") {
      await updateRecetaEstado(tx, session.tenantId, contexto.recetaId, "EN_PREPARACION");
    }
    if (await todosLosItemsConfirmados(tx, session.tenantId, contexto.recetaId)) {
      await updateRecetaEstado(tx, session.tenantId, contexto.recetaId, "PREPARADA");
    }

    // ------------------------------------------------------------------
    // 9. The reserva de stock (if any) is consumed: the movimientos above
    //    now hold that stock (migration 0071).
    // ------------------------------------------------------------------
    await deleteReservasDePreparacion(tx, session.tenantId, input.preparacionId);

    return {
      id: input.preparacionId,
      fechaVencimiento,
      contexto,
      formulaTexto,
      detalles: detallesLibro,
      egresosControlados: movimientosControlados,
    };
  } catch (e) {
    throw comoErrorDeDominio(e);
  }
}

/**
 * `withTenantTransaction` (shared/db/transaction.ts) only calls `mapDbError`
 * AFTER the whole handler has already thrown -- too late for a handler's own
 * catch to react to it. Mapping explicitly turns a raw Postgres/Prisma error
 * into an `InvariantViolationError` (and then a clear Spanish `DomainError`)
 * BEFORE it leaves the command, never a raw driver message.
 */
export function comoErrorDeDominio(e: unknown): Error {
  const mapped = mapDbError(e);
  if (mapped instanceof InvariantViolationError) {
    return new DomainError(mensajeParaInvariante(mapped.invariantCode), { cause: mapped });
  }
  return mapped;
}

/** One línea of a validated consumption: steps 3-5 of the confirmation's checks, nothing written. */
export interface LineaPlanificada {
  linea: LineaParaPantalla;
  /** The partidas the línea draws from (automatic: exactly the split's; reservada: the reserved ones) and the línea's entrada. */
  elegido: LineaReservada;
  /** In the LÍNEA's unit (`linea.unidadSimbolo`). Manual enrase: the typed (physical) quantity; otherwise the ficha's frozen cantidadAPesar (active). What the fórmula text records. */
  cantidadRequerida: Decimal;
  /** `cantidadRequerida` in the droga's unidad base (`linea.unidadStock`): what the split covers. */
  cantidadRequeridaStock: Decimal;
  /** The system-computed split: PHYSICAL `cantidad` per partida, in the droga's unidad base (a stock quantity); `potenciaAplicada` null = no purity correction (manual enrase). */
  split: readonly ParteDeReparto[];
  /** What the split weighs in total (physical), converted back to the LÍNEA's unit: what the libro's detalle records. */
  totalFisico: Decimal;
  /** INV-S15: the partidas drawn from differ from the system's own proposal (`false` for the automatic plan unless the user chose the lots, R25). */
  esDesvio: boolean;
  /** The partidas drawn from, as read after the lock. */
  partidas: readonly PartidaFresca[];
  /** A non-manual línea weighed for real (docs/specs/pesada-real.md): what `fsj.pesada_real` records. Línea unit. */
  pesada: PesadaPlanificada | null;
}

export interface PesadaPlanificada {
  /** The physical (purity-corrected) weight the plan expected. */
  esperada: Decimal;
  real: Decimal;
  margen: Decimal;
  /** Only when the pesada is outside the tolerance. */
  autorizadoPorId: string | null;
}

/**
 * The automatic plan's candidates (R1), read BEFORE locking (the caller locks them, or `planificarConsumoEnTx` does):
 * the ficha's líneas and every eligible partida of their drogas -- available to `preparacionId` (its own reservas
 * count, other preparaciones' do not) and not expired on `jornada`.
 */
export async function candidatosAutomaticosEnTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: { preparacionId: string | null; fichaTecnicaId: string; jornada: string },
): Promise<CandidatosAutomaticos> {
  const lineas = await getLineasParaPreparacion(tx, tenantId, input.fichaTecnicaId);
  const partidaIdsPorDroga = new Map<string, string[]>();
  for (const drogaId of new Set(lineas.map((l) => l.drogaId))) {
    const elegibles = await listPartidasElegiblesDroga(tx, tenantId, drogaId, input.preparacionId);
    partidaIdsPorDroga.set(
      drogaId,
      elegibles.filter((p) => !estaVencida(p.fechaVencimiento, input.jornada)).map((p) => p.id),
    );
  }
  return { lineas, partidaIdsPorDroga };
}

/** Every partida id of the candidates (deduplicated): what the automatic plan locks, in one statement. */
export function partidaIdsDeCandidatos(candidatos: CandidatosAutomaticos): string[] {
  return [...new Set([...candidatos.partidaIdsPorDroga.values()].flat())];
}

/**
 * Steps 2c-2e of this file's doc comment WITHOUT the writes: the partidas of
 * every línea (`seleccion`, R1) are locked (one id-ordered statement) and
 * re-read, and each línea's split is computed and validated (cantidad,
 * droga, vencida, stock, INV-S15 desvío, INV-S18 motivo). Stock reserved by
 * OTHER preparaciones INICIADA (migration 0071) is not available;
 * `preparacionId`'s own reservas are. Shared by the confirmation,
 * `reservarStockPreparacion`, `recalcularReservaStock` and
 * `registrarPerdidaReserva`, so a reserva is validated exactly as its
 * confirmation will be. Runs inside the caller's transaction (the partida
 * locks last until it ends). All líneas are validated before the caller
 * writes anything.
 */
export async function planificarConsumoEnTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: { preparacionId: string; fichaTecnicaId: string; seleccion: SeleccionDePartidas; jornada: string },
): Promise<LineaPlanificada[]> {
  const { jornada, seleccion } = input;
  const automatica = seleccion.modo === "automatica";

  // ------------------------------------------------------------------
  // 3. Each ficha línea with the partidas it may draw from and its entrada.
  // ------------------------------------------------------------------
  let lineasFicha: LineaParaPantalla[];
  const elegidoPorLinea = new Map<string, LineaReservada>();
  // R25: the partidas the user chose for a línea (automatic plan only), applied below if its candidates differ in purity.
  const elegidasPorUsuario = new Map<string, readonly string[]>();
  if (seleccion.modo === "automatica") {
    const candidatos =
      seleccion.candidatos ?? (await candidatosAutomaticosEnTx(tx, tenantId, { preparacionId: input.preparacionId, fichaTecnicaId: input.fichaTecnicaId, jornada }));
    lineasFicha = candidatos.lineas;
    const entradaPorLinea = new Map(seleccion.entradas.map((e) => [e.lineaPesajeId, e]));
    if (entradaPorLinea.size !== seleccion.entradas.length) throw new DomainError("Hay líneas repetidas en los datos enviados.");
    if (seleccion.entradas.some((e) => !lineasFicha.some((l) => l.id === e.lineaPesajeId))) {
      throw new DomainError("Los datos enviados no corresponden a las líneas de la ficha técnica: recargá la página.");
    }
    for (const linea of lineasFicha) {
      const entrada = entradaPorLinea.get(linea.id);
      elegidoPorLinea.set(linea.id, {
        lineaPesajeId: linea.id,
        partidaIds: [...(candidatos.partidaIdsPorDroga.get(linea.drogaId) ?? [])],
        cantidadManual: entrada?.cantidadManual,
        motivoAperturaAdicional: entrada?.motivoAperturaAdicional,
        cantidadReal: entrada?.cantidadReal,
        pesadaAutorizadaPorId: seleccion.pesadaAutorizadaPorId ?? seleccion.autorizacionesPorLinea?.get(linea.id),
      });
      if (entrada?.partidaIds && entrada.partidaIds.length > 0) elegidasPorUsuario.set(linea.id, entrada.partidaIds);
    }
  } else {
    lineasFicha = await getLineasParaPreparacion(tx, tenantId, input.fichaTecnicaId);
    for (const linea of seleccion.lineas) {
      if (elegidoPorLinea.has(linea.lineaPesajeId)) throw new DomainError("Hay líneas repetidas en la reserva.");
      elegidoPorLinea.set(linea.lineaPesajeId, linea);
    }
    if (lineasFicha.length !== elegidoPorLinea.size || lineasFicha.some((l) => !elegidoPorLinea.has(l.id))) {
      throw new DomainError("La reserva no incluye exactamente las líneas de la ficha técnica: recalculá la reserva.");
    }
  }

  // ------------------------------------------------------------------
  // 4. Lock EVERY partida, across EVERY línea, in ONE id-ordered
  //    statement (see this file's doc comment), then re-read them.
  // ------------------------------------------------------------------
  const todosLosPartidaIds = [...new Set([...elegidoPorLinea.values()].flatMap((l) => l.partidaIds))];
  const lockedPartidaIds = new Set(await lockPartidasParaConfirmacion(tx, tenantId, todosLosPartidaIds));
  const faltante = todosLosPartidaIds.find((id) => !lockedPartidaIds.has(id));
  if (faltante) throw new NotFoundError(`Partida no encontrada: ${faltante}.`);

  const partidasFrescas = await getPartidasFrescas(tx, tenantId, todosLosPartidaIds, input.preparacionId);
  const partidaPorId = new Map(partidasFrescas.map((p) => [p.id, p]));
  const parametrosPesada = await getParametrosPesadaReal(tx, tenantId);

  // ------------------------------------------------------------------
  // 5. Per línea (ficha order): resolve cantidad, compute split, validate.
  // ------------------------------------------------------------------
  const plan: LineaPlanificada[] = [];
  const sinStock: string[] = [];
  const camposSinStock: string[] = [];
  for (const linea of lineasFicha) {
    const elegido = elegidoPorLinea.get(linea.id)!;

    let cantidadRequerida: Decimal;
    if (linea.esEnraseManual) {
      if (!elegido.cantidadManual) {
        throw new DomainError(`La línea ${linea.orden + 1} (${linea.drogaNombre}) es de enrase manual: falta la cantidad real registrada.`, {
          fields: [`cantidadManual_${linea.id}`],
        });
      }
      cantidadRequerida = dec(elegido.cantidadManual);
      validarCantidadManual(cantidadRequerida, linea.orden);
    } else {
      if (!linea.cantidadAPesar) {
        throw new DomainError(`La línea ${linea.orden + 1} (${linea.drogaNombre}) no tiene cantidad a pesar definida.`);
      }
      cantidadRequerida = dec(linea.cantidadAPesar);
    }

    // Stock is in the droga's unidad base, the línea in its magnitud's base unit:
    // convert the requirement once here; everything below that touches stock
    // works in the droga's unidad base.
    if (!mismaMagnitud(linea.unidad, linea.unidadStock)) {
      throw new DomainError(
        `La línea ${linea.orden + 1} (${linea.drogaNombre}) está en ${linea.unidadSimbolo} y el stock de la droga se lleva en ${linea.unidadStock.simbolo}: son magnitudes distintas y no se pueden convertir.`,
      );
    }
    const aUnidadLinea = (cantidad: Decimal) => convertirCantidad(cantidad, linea.unidadStock, linea.unidad);
    const cantidadRequeridaStock = convertirCantidad(cantidadRequerida, linea.unidad, linea.unidadStock);

    const frescas = elegido.partidaIds.map((id) => {
      const p = partidaPorId.get(id);
      if (!p) throw new NotFoundError(`Partida no encontrada: ${id}.`);
      if (p.drogaId !== linea.drogaId) {
        throw new DomainError(`Una partida de la línea ${linea.orden + 1} (${linea.drogaNombre}) no corresponde a esa droga.`);
      }
      return p;
    });

    // INV-S10 on the vencimiento VIGENTE (getPartidasFrescas reads fecha_vencimiento_vigente, migration 0074). The
    // automatic plan just leaves out a partida that expired since its candidates were read; a reserved one is refused.
    const vencida = frescas.find((p) => estaVencida(p.fechaVencimiento, jornada));
    if (vencida && !automatica) {
      throw new DomainError(
        `La partida ${vencida.lote} (${linea.drogaNombre}) está vencida: no se puede descontar stock de una partida vencida. Requiere acción del Director Técnico (reanálisis o marcarla como vencida). Recalculá la reserva.`,
      );
    }
    const usables = frescas.filter((p) => !estaVencida(p.fechaVencimiento, jornada));

    // The lots the user checked (docs/specs/pesada-real.md: the form pre-checks the automatic plan's): the split runs
    // over those only (still abiertas first, then FEFO). Required when the candidates differ in purity (R25): the
    // weight depends on the lot. A reserva already holds the chosen ones.
    let aRepartir: readonly PartidaFresca[] = usables;
    let porEleccion = false;
    const elegidasLinea = automatica ? elegidasPorUsuario.get(linea.id) : undefined;
    if (automatica && (elegidasLinea || requiereElegirPartida(usables, linea.esEnraseManual))) {
      // A chosen partida no longer available (emptied, expired, reserved by another) is left out, never replaced.
      const elegidas = elegidasLinea ?? [];
      aRepartir = usables.filter((p) => elegidas.includes(p.id));
      if (aRepartir.length === 0) {
        throw new DomainError(`La línea ${linea.orden + 1} (${linea.drogaNombre}) tiene partidas de distinta pureza: elegí de qué lote se pesa.`, {
          fields: [`partidas_${linea.id}`],
        });
      }
      porEleccion = true;
    }

    // Non-manual: split in ACTIVE terms (purity per partida). Manual enrase: the typed quantity is physical, no
    // purity correction (potenciaAplicada stays NULL) -- domain/reparto-linea.ts.
    const resultado = repartirLinea(aRepartir, cantidadRequeridaStock, jornada, linea.esEnraseManual);
    if (!resultado.ok) {
      // The shortfall comes in the droga's unidad base: shown in the línea's unit, the one the user reads.
      const texto = `Stock insuficiente de ${linea.drogaNombre}${automatica ? (porEleccion ? " en los lotes elegidos" : "") : " en las partidas reservadas"}: faltan ${aUnidadLinea(resultado.faltante).toFixed()} ${linea.unidadSimbolo}${
        !linea.esEnraseManual && usables.some((p) => tieneCorreccion(p.potenciaDeclarada)) ? " de principio activo" : ""
      }.`;
      if (!automatica) throw new DomainError(texto);
      // The automatic plan reports every línea short of stock at once.
      sinStock.push(texto);
      if (linea.esEnraseManual) camposSinStock.push(`cantidadManual_${linea.id}`);
      if (porEleccion) camposSinStock.push(`partidas_${linea.id}`);
      continue;
    }

    // Pesada real (docs/specs/pesada-real.md): the línea consumes what the balance showed, drained over the same
    // partidas; the plan above is what was EXPECTED. Outside the tolerance the DT must have co-signed.
    let split = resultado.partes;
    let pesada: PesadaPlanificada | null = null;
    if (!linea.esEnraseManual && elegido.cantidadReal) {
      const real = dec(elegido.cantidadReal);
      if (!real.isFinite() || !real.greaterThan(0)) {
        throw new DomainError(`La línea ${linea.orden + 1} (${linea.drogaNombre}): la pesada real debe ser mayor que 0.`, { fields: [`cantidadReal_${linea.id}`] });
      }
      const esperada = aUnidadLinea(resultado.totalFisico);
      const evaluacion = evaluarPesada(real, esperada, parametrosPesada.toleranciaPorcentaje, precisionDeLinea(linea.unidad, parametrosPesada.precisionBalanza));
      if (evaluacion.fueraDeTolerancia && !elegido.pesadaAutorizadaPorId) {
        throw new DomainError(
          `La pesada real de ${linea.drogaNombre} (${real.toFixed()} ${linea.unidadSimbolo}) se desvía ${evaluacion.desvioPorcentaje.toFixed()} % de la esperada (${esperada.toFixed()} ${linea.unidadSimbolo}): supera la tolerancia de ±${dec(parametrosPesada.toleranciaPorcentaje).toFixed()} %. Volvé a pesar o pedí la co-firma del Director Técnico.`,
          { fields: [`cantidadReal_${linea.id}`] },
        );
      }
      const repartoReal = repartirPesadaReal(aRepartir, convertirCantidad(real, linea.unidad, linea.unidadStock), jornada);
      if (!repartoReal.ok) {
        const texto = `Stock insuficiente de ${linea.drogaNombre} para la pesada real: faltan ${aUnidadLinea(repartoReal.faltante).toFixed()} ${linea.unidadSimbolo}.`;
        if (!automatica) throw new DomainError(texto);
        sinStock.push(texto);
        camposSinStock.push(`cantidadReal_${linea.id}`);
        continue;
      }
      split = repartoReal.partes;
      pesada = { esperada, real, margen: evaluacion.margen, autorizadoPorId: evaluacion.fueraDeTolerancia ? elegido.pesadaAutorizadaPorId! : null };
    }
    const usadas = split.map((parte) => parte.partidaId);

    // INV-S15 deviation: the system's OWN proposal over ALL eligible partidas for this droga. The automatic plan IS
    // that proposal (its candidates are every eligible partida, fresh) unless the user chose the lots (R25); a reserva
    // is compared with the current one.
    let esDesvio = false;
    let todasElegibles: readonly PartidaConPotencia[] = usables;
    if (porEleccion) {
      const propuestaCanonica = repartirLinea(usables, cantidadRequeridaStock, jornada, linea.esEnraseManual);
      esDesvio = !propuestaCanonica.ok || esDesvioPropuesta(propuestaCanonica.partes.map((p) => p.partidaId), usadas);
    } else if (!automatica) {
      const elegibles = await listPartidasElegiblesDroga(tx, tenantId, linea.drogaId, input.preparacionId);
      const propuestaCanonica = repartirLinea(elegibles, cantidadRequeridaStock, jornada, linea.esEnraseManual);
      esDesvio = !propuestaCanonica.ok || esDesvioPropuesta(propuestaCanonica.partes.map((p) => p.partidaId), usadas);
      todasElegibles = elegibles;
    }

    // INV-S18 [PROPUESTA TÉCNICA -- ver domain/preparacion.ts]: compared over every eligible partida, "elegida" = drawn from.
    const partidasConEstado = todasElegibles.map((p) => ({
      ...p,
      potenciaDeclarada: linea.esEnraseManual ? null : p.potenciaDeclarada,
      elegida: usadas.includes(p.id),
    }));
    if (requiereMotivoAperturaAdicional(partidasConEstado, cantidadRequeridaStock, jornada) && !elegido.motivoAperturaAdicional) {
      throw new DomainError(
        `La línea ${linea.orden + 1} (${linea.drogaNombre}) abre una partida nueva mientras hay otra ya abierta con saldo suficiente: indicá el motivo${
          automatica ? "" : " (o recalculá la reserva)"
        }.`,
        { fields: [`motivoApertura_${linea.id}`] },
      );
    }

    plan.push({
      linea,
      elegido: {
        ...elegido,
        partidaIds: automatica ? usadas : elegido.partidaIds,
        cantidadReal: pesada?.real,
        pesadaAutorizadaPorId: pesada?.autorizadoPorId ?? undefined,
      },
      cantidadRequerida,
      cantidadRequeridaStock,
      split,
      totalFisico: pesada ? pesada.real : aUnidadLinea(resultado.totalFisico),
      esDesvio,
      partidas: frescas.filter((p) => usadas.includes(p.id)),
      pesada,
    });
  }
  if (sinStock.length > 0) throw new DomainError(sinStock.join(" "), camposSinStock.length > 0 ? { fields: camposSinStock } : undefined);
  return plan;
}

export async function confirmarPreparacion(input: ConfirmarPreparacionInput): Promise<ConfirmacionResultado> {
  const { dtUsuarioId, dtPassword, ...resto } = input;
  const pesadaAutorizadaPorId = await autorizacionDePesadaReal({ dtUsuarioId, dtPassword });
  return confirmarPreparacionCommand.execute({ ...resto, pesadaAutorizadaPorId });
}
