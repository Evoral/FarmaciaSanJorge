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
 *         system-computed, whatever partidas were chosen -- INV-S13/S20),
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
 *         trigger (migration 0014) assigns both.
 *      g. UPDATE `preparacion` -> CONFIRMADA, `preparada_por_id` = the
 *         SESSION user (INV-P06 -- never from input).
 *      h. UPDATE the receta's estado: EN_PREPARACION -> PREPARADA once
 *         EVERY item_receta of the receta has a CONFIRMADA preparación
 *         (INV-P03.4).
 *      i. `audit.record` runs automatically after this handler returns
 *         (shared/usecase.ts's `defineCommand`, SAME transaction).
 *   3. Any failure at any point -> the WHOLE transaction rolls back --
 *      nothing above ever partially persists (see tests/preparaciones-confirmar-atomicidad.test.ts).
 *
 * Every `INV-XXX` the DB can still raise (defense in depth beyond the
 * pre-checks above) is caught and mapped to a clear Spanish message via
 * `mensajeParaInvariante` (domain/mensajes-invariantes.ts) before it
 * reaches the caller.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { DomainError, NotFoundError, InvariantViolationError, mapDbError } from "@/shared/errors";
import { uuid, nonEmptyString, decimalString } from "@/shared/validation";
import { dec, Decimal } from "@/shared/decimal";
import { proponerReparto } from "@/modules/stock/domain/reparto";
import {
  validarCantidadManual,
  esDesvioPropuesta,
  requiereMotivoAperturaAdicional,
  formatearMedicoTexto,
  formatearPacienteTexto,
  formatearFormulaTexto,
} from "../domain/preparacion";
import { mensajeParaInvariante } from "../domain/mensajes-invariantes";
import {
  lockPreparacionParaAccion,
  getPreparacionParaAccion,
  jornadaActualTenant,
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
} from "../infrastructure/preparacion-repository";

const lineaConfirmacionInput = z.object({
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
    // 3. The submitted líneas must match the ficha's líneas EXACTLY.
    // ------------------------------------------------------------------
    const lineasFicha = await getLineasParaPreparacion(tx, session.tenantId, preparacion.fichaTecnicaId);
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
    const lockedPartidaIds = new Set(await lockPartidasParaConfirmacion(tx, session.tenantId, todosLosPartidaIds));
    const faltante = todosLosPartidaIds.find((id) => !lockedPartidaIds.has(id));
    if (faltante) throw new NotFoundError(`Partida no encontrada: ${faltante}.`);

    const partidasFrescas = await getPartidasFrescas(tx, session.tenantId, todosLosPartidaIds);
    const partidaPorId = new Map(partidasFrescas.map((p) => [p.id, p]));

    // ------------------------------------------------------------------
    // 5. Per línea (ficha order): resolve cantidad, recompute split,
    //    validate, write EGRESO_PREPARACION (+ asiento_contralor).
    // ------------------------------------------------------------------
    const detalles: Array<{ lineaPesajeId: string; descripcion: string; cantidad: string; unidadTexto: string; orden: number }> = [];
    const formulaLineas: Array<{ drogaNombre: string; cantidad: string; unidadSimbolo: string; esEnraseManual: boolean }> = [];
    // Movimientos of a controlled droga (contralor activo) collected here --
    // their asiento_contralor row needs asiento_recetario_id, which does not
    // exist until AFTER every línea is processed (plan §9 M11 step 6 before
    // step 7) -- see the loop below.
    const movimientosControlados: Array<{ movimientoId: string; drogaId: string; drogaNombre: string; unidadBaseId: string; cantidad: string }> = [];

    try {
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

        const elegidasFrescas = elegido.partidaIds.map((id) => {
          const p = partidaPorId.get(id);
          if (!p) throw new NotFoundError(`Partida no encontrada: ${id}.`);
          if (p.drogaId !== linea.drogaId) {
            throw new DomainError(`La partida elegida para la línea ${linea.orden + 1} (${linea.drogaNombre}) no corresponde a esa droga.`);
          }
          return p;
        });

        const vencida = elegidasFrescas.find((p) => p.fechaVencimiento < jornada);
        if (vencida) {
          throw new DomainError(`La partida ${vencida.lote} (${linea.drogaNombre}) está vencida: no se puede descontar stock de una partida vencida.`);
        }

        const resultado = proponerReparto(
          elegidasFrescas.map((p) => ({ id: p.id, cantidadDisponible: p.cantidadDisponible, fechaVencimiento: p.fechaVencimiento, fechaApertura: p.fechaApertura })),
          cantidadRequerida,
          jornada,
        );
        if (!resultado.ok) {
          throw new DomainError(
            `Stock insuficiente de ${linea.drogaNombre} en las partidas elegidas: faltan ${resultado.faltante.toString()} ${linea.unidadSimbolo}.`,
          );
        }

        // INV-S15 deviation: compare against the system's OWN default
        // proposal over ALL eligible partidas for this droga (not just the
        // chosen subset).
        const todasElegibles = await listPartidasElegiblesDroga(tx, session.tenantId, linea.drogaId);
        const propuestaCanonica = proponerReparto(
          todasElegibles.map((p) => ({ id: p.id, cantidadDisponible: p.cantidadDisponible, fechaVencimiento: p.fechaVencimiento, fechaApertura: p.fechaApertura })),
          cantidadRequerida,
          jornada,
        );
        const esDesvio =
          !propuestaCanonica.ok || esDesvioPropuesta(propuestaCanonica.lineas.map((l) => l.partidaId), elegido.partidaIds);

        // INV-S18 [PROPUESTA TÉCNICA -- ver domain/preparacion.ts].
        const partidasConEstado = todasElegibles.map((p) => ({ ...p, elegida: elegido.partidaIds.includes(p.id) }));
        if (requiereMotivoAperturaAdicional(partidasConEstado, cantidadRequerida, jornada) && !elegido.motivoAperturaAdicional) {
          throw new DomainError(
            `La línea ${linea.orden + 1} (${linea.drogaNombre}) abre una partida nueva mientras hay otra ya abierta con saldo suficiente: indicá el motivo.`,
          );
        }

        const droga = await getDrogaTipoControl(tx, session.tenantId, linea.drogaId);
        const fechaActivacionContralor = await getFechaActivacionContralor(tx, session.tenantId);
        const contralorActivo = droga !== null && droga.tipoControl !== "NINGUNO" && fechaActivacionContralor !== null;

        for (const split of resultado.lineas) {
          const movimiento = await insertEgresoPreparacion(tx, {
            tenantId: session.tenantId,
            partidaId: split.partidaId,
            cantidad: split.cantidad.toString(),
            preparacionId: input.preparacionId,
            lineaPesajeId: linea.id,
            registradoPorId: session.usuario.id,
            desvioPropuesta: esDesvio,
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

        detalles.push({
          lineaPesajeId: linea.id,
          descripcion: linea.drogaNombre,
          cantidad: cantidadRequerida.toString(),
          unidadTexto: linea.unidadSimbolo,
          orden: linea.orden,
        });
        formulaLineas.push({
          drogaNombre: linea.drogaNombre,
          cantidad: cantidadRequerida.toString(),
          unidadSimbolo: linea.unidadSimbolo,
          esEnraseManual: linea.esEnraseManual,
        });
      }

      // ------------------------------------------------------------------
      // 6. asiento_recetario + detalle_asiento (no correlativo/hash -- DB-assigned).
      // ------------------------------------------------------------------
      const contexto = await getRecetaContextoAsiento(tx, session.tenantId, preparacion.itemRecetaId);
      if (!contexto) throw new NotFoundError("No se pudo resolver el contexto de la receta para el asiento.");

      const asiento = await insertAsientoRecetario(tx, {
        tenantId: session.tenantId,
        preparacionId: input.preparacionId,
        pacienteTexto: formatearPacienteTexto(contexto.pacienteNombre, contexto.pacienteApellido),
        medicoTexto: formatearMedicoTexto(contexto.medicoNombre, contexto.medicoApellido, contexto.medicoMatricula),
        formulaTexto: formatearFormulaTexto(formulaLineas),
        registradoPorId: session.usuario.id,
        detalles,
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
      await updatePreparacionConfirmada(tx, session.tenantId, input.preparacionId, session.usuario.id);

      // ------------------------------------------------------------------
      // 8. receta: EN_PREPARACION -> PREPARADA una vez que TODOS los ítems
      //    tienen una preparación CONFIRMADA (INV-P03.4).
      // ------------------------------------------------------------------
      const recetaLocked = await lockRecetaParaTransicion(tx, session.tenantId, contexto.recetaId);
      if (recetaLocked) {
        const estadoReceta = await getRecetaEstado(tx, session.tenantId, contexto.recetaId);
        if (estadoReceta === "EN_PREPARACION" && (await todosLosItemsConfirmados(tx, session.tenantId, contexto.recetaId))) {
          await updateRecetaEstado(tx, session.tenantId, contexto.recetaId, "PREPARADA");
        }
      }

      return {
        output: { id: input.preparacionId, asientoId: asiento.id, numeroCorrelativo: asiento.numeroCorrelativo },
        audit: {
          entidadId: input.preparacionId,
          valorNuevo: { estado: "CONFIRMADA", asientoRecetarioId: asiento.id, numeroCorrelativo: asiento.numeroCorrelativo },
        },
      };
    } catch (e) {
      // `withTenantTransaction` (shared/db/transaction.ts) only calls
      // `mapDbError` AFTER this whole handler has already thrown -- too
      // late for THIS catch to react to it. Map explicitly here so a raw
      // Postgres/Prisma error becomes an `InvariantViolationError` (and
      // then a clear Spanish `DomainError`) BEFORE it leaves this command,
      // never a raw driver message.
      const mapped = mapDbError(e);
      if (mapped instanceof InvariantViolationError) {
        throw new DomainError(mensajeParaInvariante(mapped.invariantCode));
      }
      throw mapped;
    }
  },
});

export async function confirmarPreparacion(input: ConfirmarPreparacionInput): Promise<{ id: string; asientoId: string; numeroCorrelativo: string }> {
  return confirmarPreparacionCommand.execute(input);
}
