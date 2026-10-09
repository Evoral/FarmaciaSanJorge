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
 *      c. Validate the submitted líneas match the ficha's líneas EXACTLY
 *         (no missing/extra/duplicate línea).
 *      d. Lock EVERY chosen partida across EVERY línea, ONE statement,
 *         ORDER BY id (S11 -- a single global id-ordered lock instead of a
 *         per-línea loop, which is STRICTLY SAFER against deadlocks between
 *         two concurrent confirmaciones that touch overlapping partidas in
 *         a different línea order -- see `lockPartidasParaConfirmacion`'s
 *         doc comment for why this is a deliberate, documented deviation
 *         from the plan's literal "por cada línea" wording, not a
 *         weakening of it).
 *      e. Per línea (ficha's own `orden`): resolve the real cantidad
 *         (manual línea -> the typed quantity, validated > 0; non-manual ->
 *         the ficha's frozen `cantidadAPesar`, NEVER client input),
 *         recompute the split via `proponerReparto` over the CHOSEN
 *         partidas' FRESH (post-lock) balances (the amounts are ALWAYS
 *         system-computed, whatever partidas were chosen -- INV-S13/S20;
 *         non-manual líneas split in ACTIVE terms via
 *         `proponerRepartoActivo`, domain/potencia.ts: `cantidadAPesar` is
 *         the active ingredient required, each partida contributes
 *         physical x potencia / 100, stock moves in PHYSICAL units and each
 *         movimiento records `potencia_aplicada`; manual-enrase líneas get
 *         no purity correction). UNITS: the línea's quantity (cantidadAPesar,
 *         or the typed cantidadManual) is in the línea's unit (its magnitud's
 *         base, e.g. g); stock is in the droga's unidad base (e.g. mg). The
 *         required amount is converted into the droga's unidad base BEFORE
 *         the split, so every stock quantity (split, reserva_stock,
 *         movimiento_stock, asiento_contralor, the stock checks) is in the
 *         droga's unidad base, while the libro recetario (detalle + fórmula)
 *         and the "faltan X" message stay in the línea's unit,
 *         reject an expired chosen partida or insufficient stock with a
 *         clear message, detect INV-S15 deviation + INV-S18's
 *         motivo-required case, then INSERT one `EGRESO_PREPARACION` per
 *         split line (the DB trigger updates the balance, sets
 *         `fecha_apertura`, and -- via a DEFERRED constraint trigger --
 *         requires a matching `asiento_contralor` row when the contralor is
 *         active, which this handler inserts explicitly right after each
 *         movimiento of a controlled droga).
 *      f. INSERT `asiento_recetario` (origen SISTEMA) + its `detalle_asiento`
 *         rows -- WITHOUT a correlativo or hash; the DB's `BEFORE INSERT`
 *         trigger (migration 0014) assigns both. Insumos (droga.clase
 *         EXCIPIENTE/MATERIAL, migration 0063) consume stock like any line
 *         but are left out of the detalle and the fórmula text -- unless
 *         EVERY line is an insumo, in which case all are recorded (an
 *         asiento never ends up without its fórmula).
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
 * "Imprimir etiqueta" (`confirmarReservaStock`, ./confirmar-reserva-stock.ts)
 * runs the very same confirmation from the preparación's reserva de stock
 * (migration 0071, docs/specs/reserva-stock-preparacion.md), together with
 * its etiqueta, in its own single transaction; the reserva is deleted in that
 * same transaction. The checks of 2c-2e (`planificarConsumoEnTx`) also
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
import { proponerReparto, type PartidaDisponible } from "@/modules/stock/domain/reparto";
import { proponerRepartoActivo, tieneCorreccion, type PartidaConPotencia, type RepartoActivoLinea } from "../domain/potencia";
import {
  validarCantidadManual,
  esDesvioPropuesta,
  requiereMotivoAperturaAdicional,
  formatearMedicoTexto,
  formatearPacienteTexto,
  formatearFormulaTexto,
} from "../domain/preparacion";
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
  insertAsientoRecetario,
  insertAsientoContralorEgreso,
  updatePreparacionConfirmada,
  lockRecetaParaTransicion,
  getRecetaEstado,
  updateRecetaEstado,
  todosLosItemsConfirmados,
  getRecetaContextoAsiento,
  deleteReservasDePreparacion,
} from "../infrastructure/preparacion-repository";
import type { LineaParaPantalla, PartidaFresca } from "../infrastructure/preparacion-repository";

export const lineaConfirmacionInput = z.object({
  lineaPesajeId: uuid,
  /** Required (and validated > 0) ONLY for esEnraseManual lines -- the DB is what says whether a línea is manual, never client input. */
  cantidadManual: decimalString.optional(),
  partidaIds: z.array(uuid).min(1, "Elegí al menos una partida para cada línea."),
  motivoAperturaAdicional: nonEmptyString.optional(),
});

const confirmarPreparacionInput = z.object({
  preparacionId: uuid,
  lineas: z.array(lineaConfirmacionInput).min(1),
});

/** The línea as parsed (`cantidadManual` already a `Decimal`): what `confirmarPreparacionEnTx` receives. */
export type LineaConfirmacion = z.infer<typeof lineaConfirmacionInput>;

export interface ConfirmarPreparacionLineaInput {
  lineaPesajeId: string;
  cantidadManual?: string;
  partidaIds: string[];
  motivoAperturaAdicional?: string;
}

export interface ConfirmarPreparacionInput {
  preparacionId: string;
  lineas: ConfirmarPreparacionLineaInput[];
}

/** What a confirmation returns; `fechaVencimiento` is the `YYYY-MM-DD` snapshot written on the preparación. */
export interface ConfirmacionResultado {
  id: string;
  asientoId: string;
  numeroCorrelativo: string;
  fechaVencimiento: string;
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
    const confirmada = await confirmarPreparacionEnTx(tx, session, input);
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
 * also run by `confirmarReservaStock` (./confirmar-reserva-stock.ts, the toma
 * workspace's "Imprimir etiqueta") on a preparación whose stock was reserved,
 * in the SAME transaction as its etiqueta. The caller declares the permiso,
 * the step-up and the audit. The preparación's own reservas (migration 0071)
 * are available to it and are deleted at the end: its movimientos now hold
 * that stock.
 */
export async function confirmarPreparacionEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  input: { preparacionId: string; lineas: LineaConfirmacion[] },
): Promise<ConfirmacionResultado> {
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

  const detalles: Array<{ lineaPesajeId: string; descripcion: string; cantidad: string; unidadTexto: string; orden: number; esInsumo: boolean }> = [];
  const formulaLineas: Array<{ drogaNombre: string; cantidad: string; unidadSimbolo: string; esEnraseManual: boolean; esInsumo: boolean }> = [];
  // Movimientos of a controlled droga (contralor activo) collected here --
  // their asiento_contralor row needs asiento_recetario_id, which does not
  // exist until AFTER every línea is processed (plan §9 M11 step 6 before
  // step 7) -- see the loop below.
  const movimientosControlados: Array<{ movimientoId: string; drogaId: string; drogaNombre: string; unidadBaseId: string; cantidad: string }> = [];

  try {
    // ------------------------------------------------------------------
    // 3-5. Líneas match the ficha, partidas locked, every split recomputed
    //      and validated (`planificarConsumoEnTx`); then, per línea (ficha
    //      order), write EGRESO_PREPARACION (+ asiento_contralor).
    // ------------------------------------------------------------------
    const plan = await planificarConsumoEnTx(tx, session.tenantId, {
      preparacionId: input.preparacionId,
      fichaTecnicaId: preparacion.fichaTecnicaId,
      lineas: input.lineas,
      jornada,
    });

    for (const { linea, cantidadRequerida, split: reparto, totalFisico, esDesvio } of plan) {
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
      formulaLineas.push({
        drogaNombre: linea.drogaNombre,
        cantidad: cantidadRequerida.toString(),
        unidadSimbolo: linea.unidadSimbolo,
        esEnraseManual: linea.esEnraseManual,
        esInsumo,
      });
    }

    // ------------------------------------------------------------------
    // 6. asiento_recetario + detalle_asiento (no correlativo/hash -- DB-assigned).
    // ------------------------------------------------------------------
    const soloInsumos = detalles.every((d) => d.esInsumo);
    const detallesLibro = detalles.filter((d) => soloInsumos || !d.esInsumo).map((d) => ({ lineaPesajeId: d.lineaPesajeId, descripcion: d.descripcion, cantidad: d.cantidad, unidadTexto: d.unidadTexto, orden: d.orden }));
    const formulaLibro = formulaLineas.filter((l) => soloInsumos || !l.esInsumo);

    const contexto = await getRecetaContextoAsiento(tx, session.tenantId, preparacion.itemRecetaId);
    if (!contexto) throw new NotFoundError("No se pudo resolver el contexto de la receta para el asiento.");

    const asiento = await insertAsientoRecetario(tx, {
      tenantId: session.tenantId,
      preparacionId: input.preparacionId,
      pacienteTexto: formatearPacienteTexto(contexto.pacienteNombre, contexto.pacienteApellido),
      medicoTexto: formatearMedicoTexto(contexto.medicoNombre, contexto.medicoApellido, contexto.medicoMatricula),
      formulaTexto: formatearFormulaTexto(formulaLibro),
      registradoPorId: session.usuario.id,
      detalles: detallesLibro,
    });

    // ------------------------------------------------------------------
    // 6b. asiento_contralor per movimiento of a controlled droga
    //     (INV-L08), now that asiento_recetario.id exists.
    // ------------------------------------------------------------------
    for (const mov of movimientosControlados) {
      await insertAsientoContralorEgreso(tx, {
        tenantId: session.tenantId,
        drogaId: mov.drogaId,
        drogaDescripcion: mov.drogaNombre,
        cantidad: mov.cantidad,
        unidadMedidaId: mov.unidadBaseId,
        movimientoStockId: mov.movimientoId,
        asientoRecetarioId: asiento.id,
        registradoPorId: session.usuario.id,
      });
    }

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
    // 8. receta: PENDIENTE_PREPARACION -> EN_PREPARACION con la primera
    //    confirmación; EN_PREPARACION -> PREPARADA una vez que TODOS los
    //    ítems tienen una preparación CONFIRMADA (INV-P03.4).
    // ------------------------------------------------------------------
    const recetaLocked = await lockRecetaParaTransicion(tx, session.tenantId, contexto.recetaId);
    if (recetaLocked) {
      let estadoReceta = await getRecetaEstado(tx, session.tenantId, contexto.recetaId);
      if (estadoReceta === "PENDIENTE_PREPARACION") {
        await updateRecetaEstado(tx, session.tenantId, contexto.recetaId, "EN_PREPARACION");
        estadoReceta = "EN_PREPARACION";
      }
      if (estadoReceta === "EN_PREPARACION" && (await todosLosItemsConfirmados(tx, session.tenantId, contexto.recetaId))) {
        await updateRecetaEstado(tx, session.tenantId, contexto.recetaId, "PREPARADA");
      }
    }

    // ------------------------------------------------------------------
    // 9. The reserva de stock (if any) is consumed: the movimientos above
    //    now hold that stock (migration 0071).
    // ------------------------------------------------------------------
    await deleteReservasDePreparacion(tx, session.tenantId, input.preparacionId);

    return { id: input.preparacionId, asientoId: asiento.id, numeroCorrelativo: asiento.numeroCorrelativo, fechaVencimiento };
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
  elegido: LineaConfirmacion;
  /** In the LÍNEA's unit (`linea.unidadSimbolo`). Manual enrase: the typed (physical) quantity; otherwise the ficha's frozen cantidadAPesar (active). What the fórmula text records. */
  cantidadRequerida: Decimal;
  /** `cantidadRequerida` in the droga's unidad base (`linea.unidadStock`): what the split covers. */
  cantidadRequeridaStock: Decimal;
  /** The system-computed split over the chosen partidas: PHYSICAL `cantidad` per partida, in the droga's unidad base (a stock quantity); `potenciaAplicada` null = no purity correction (manual enrase). */
  split: readonly { partidaId: string; cantidad: Decimal; potenciaAplicada: Decimal | null }[];
  /** What the split weighs in total (physical), converted back to the LÍNEA's unit: what the libro's detalle records. */
  totalFisico: Decimal;
  /** INV-S15: the choice differs from the system's own proposal. */
  esDesvio: boolean;
  /** The chosen partidas, as read after the lock. */
  partidas: readonly PartidaFresca[];
}

/**
 * Steps 2c-2e of this file's doc comment WITHOUT the writes: the submitted
 * líneas match the ficha's EXACTLY, every chosen partida is locked (one
 * id-ordered statement) and re-read, and each línea's split is recomputed
 * and validated (cantidad, droga, vencida, stock, INV-S15 desvío, INV-S18
 * motivo). Stock reserved by OTHER preparaciones INICIADA (migration 0071)
 * is not available; `preparacionId`'s own reservas are. Shared by the
 * confirmation and by `reservarStockPreparacion`
 * (./reservar-stock-preparacion.ts), so a reserva is validated exactly as
 * its confirmation will be. Runs inside the caller's transaction (the
 * partida locks last until it ends). All líneas are validated before the
 * caller writes anything.
 */
export async function planificarConsumoEnTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: { preparacionId: string; fichaTecnicaId: string; lineas: readonly LineaConfirmacion[]; jornada: string },
): Promise<LineaPlanificada[]> {
  const { jornada } = input;

  // ------------------------------------------------------------------
  // 3. The submitted líneas must match the ficha's líneas EXACTLY.
  // ------------------------------------------------------------------
  const lineasFicha = await getLineasParaPreparacion(tx, tenantId, input.fichaTecnicaId);
  const porInputId = new Map(input.lineas.map((l) => [l.lineaPesajeId, l]));
  if (porInputId.size !== input.lineas.length) {
    throw new DomainError("Hay líneas repetidas en la confirmación.");
  }
  if (lineasFicha.length !== input.lineas.length || lineasFicha.some((l) => !porInputId.has(l.id))) {
    throw new DomainError("La confirmación no incluye exactamente las líneas de la ficha técnica.");
  }

  // ------------------------------------------------------------------
  // 4. Lock EVERY chosen partida, across EVERY línea, in ONE
  //    id-ordered statement (see this file's doc comment).
  // ------------------------------------------------------------------
  const todosLosPartidaIds = [...new Set(input.lineas.flatMap((l) => l.partidaIds))];
  const lockedPartidaIds = new Set(await lockPartidasParaConfirmacion(tx, tenantId, todosLosPartidaIds));
  const faltante = todosLosPartidaIds.find((id) => !lockedPartidaIds.has(id));
  if (faltante) throw new NotFoundError(`Partida no encontrada: ${faltante}.`);

  const partidasFrescas = await getPartidasFrescas(tx, tenantId, todosLosPartidaIds, input.preparacionId);
  const partidaPorId = new Map(partidasFrescas.map((p) => [p.id, p]));

  // ------------------------------------------------------------------
  // 5. Per línea (ficha order): resolve cantidad, recompute split, validate.
  // ------------------------------------------------------------------
  const plan: LineaPlanificada[] = [];
  for (const linea of lineasFicha) {
    const elegido = porInputId.get(linea.id)!;

    let cantidadRequerida: Decimal;
    if (linea.esEnraseManual) {
      if (!elegido.cantidadManual) {
        throw new DomainError(`La línea ${linea.orden + 1} (${linea.drogaNombre}) es de enrase manual: falta la cantidad real registrada.`);
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

    const elegidasFrescas = elegido.partidaIds.map((id) => {
      const p = partidaPorId.get(id);
      if (!p) throw new NotFoundError(`Partida no encontrada: ${id}.`);
      if (p.drogaId !== linea.drogaId) {
        throw new DomainError(`La partida elegida para la línea ${linea.orden + 1} (${linea.drogaNombre}) no corresponde a esa droga.`);
      }
      return p;
    });

    const vencida = elegidasFrescas.find((p) => p.fechaVencimiento !== null && p.fechaVencimiento < jornada);
    if (vencida) {
      throw new DomainError(`La partida ${vencida.lote} (${linea.drogaNombre}) está vencida: no se puede descontar stock de una partida vencida.`);
    }

    // Non-manual: split in ACTIVE terms (purity per partida,
    // domain/potencia.ts). Manual enrase: the typed quantity is
    // physical, no purity correction (potenciaAplicada stays NULL).
    const repartir = (partidas: readonly PartidaConPotencia[]) =>
      linea.esEnraseManual
        ? repartoSinCorreccion(partidas, cantidadRequeridaStock, jornada)
        : proponerRepartoActivo(partidas, cantidadRequeridaStock, jornada);

    const resultado = repartir(elegidasFrescas);
    if (!resultado.ok) {
      // The shortfall comes in the droga's unidad base: shown in the línea's unit, the one the user reads.
      throw new DomainError(
        `Stock insuficiente de ${linea.drogaNombre} en las partidas elegidas: faltan ${aUnidadLinea(resultado.faltante).toFixed()} ${linea.unidadSimbolo}${
          !linea.esEnraseManual && elegidasFrescas.some((p) => tieneCorreccion(p.potenciaDeclarada)) ? " de principio activo" : ""
        }.`,
      );
    }

    // INV-S15 deviation: compare against the system's OWN default
    // proposal over ALL eligible partidas for this droga (not just the
    // chosen subset).
    const todasElegibles = await listPartidasElegiblesDroga(tx, tenantId, linea.drogaId, input.preparacionId);
    const propuestaCanonica = repartir(todasElegibles);
    const esDesvio =
      !propuestaCanonica.ok || esDesvioPropuesta(propuestaCanonica.lineas.map((l) => l.partidaId), elegido.partidaIds);

    // INV-S18 [PROPUESTA TÉCNICA -- ver domain/preparacion.ts].
    const partidasConEstado = todasElegibles.map((p) => ({
      ...p,
      potenciaDeclarada: linea.esEnraseManual ? null : p.potenciaDeclarada,
      elegida: elegido.partidaIds.includes(p.id),
    }));
    if (requiereMotivoAperturaAdicional(partidasConEstado, cantidadRequeridaStock, jornada) && !elegido.motivoAperturaAdicional) {
      throw new DomainError(
        `La línea ${linea.orden + 1} (${linea.drogaNombre}) abre una partida nueva mientras hay otra ya abierta con saldo suficiente: indicá el motivo.`,
      );
    }

    plan.push({
      linea,
      elegido,
      cantidadRequerida,
      cantidadRequeridaStock,
      split: resultado.lineas,
      totalFisico: aUnidadLinea(resultado.totalFisico),
      esDesvio,
      partidas: elegidasFrescas,
    });
  }
  return plan;
}

/**
 * Manual-enrase líneas: `proponerReparto` over the typed (physical)
 * quantity, shaped like `proponerRepartoActivo`'s result with no purity
 * correction (`potenciaAplicada: null`, activo = physical).
 */
function repartoSinCorreccion(
  partidas: readonly PartidaDisponible[],
  cantidad: Decimal,
  jornada: string,
):
  | { ok: true; lineas: readonly (Omit<RepartoActivoLinea, "potenciaAplicada"> & { potenciaAplicada: null })[]; totalFisico: Decimal }
  | { ok: false; faltante: Decimal } {
  const resultado = proponerReparto(partidas, cantidad, jornada);
  if (!resultado.ok) return { ok: false, faltante: resultado.faltante };
  return {
    ok: true,
    lineas: resultado.lineas.map((l) => ({ partidaId: l.partidaId, cantidad: l.cantidad, activo: l.cantidad, potenciaAplicada: null })),
    totalFisico: cantidad,
  };
}

export async function confirmarPreparacion(input: ConfirmarPreparacionInput): Promise<ConfirmacionResultado> {
  return confirmarPreparacionCommand.execute(input);
}
