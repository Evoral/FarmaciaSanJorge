/**
 * `confirmarReservasReceta`: the toma workspace's "Imprimir etiquetas" (docs/specs/reserva-stock-preparacion.md, R13)
 * -- the end of the lab's process and the ONLY point where a reserved ítem becomes fixed (there is no single-ítem
 * variant). Confirms EVERY ítem of the receta from its reserva and generates its etiqueta (`confirmarDesdeReservasEnTx`,
 * ./confirmar-desde-reservas.ts), in ONE transaction and in ítem order ("Ítem N" of the toma workspace). The asiento
 * counter row the asiento_recetario trigger locks FOR UPDATE stays locked from the first insert to the commit, so no
 * other confirmation can take a number in between: the receta's asientos come out CONSECUTIVE.
 *
 * All or nothing, twice over:
 *   - Every ítem not yet CONFIRMADA must hold a reserva (domain/toma.ts#itemsSinReserva), checked under the locks
 *     below: an ítem still Pendiente, or with a preparación INICIADA without reserva ("Confirmación en curso",
 *     confirmed on its own screen), refuses the whole receta with an error naming those ítems. Ítems already
 *     CONFIRMADA (e.g. on their preparación's own screen) are skipped; none left to confirm -> clear error.
 *   - If one ítem fails (the stock changed since its reserva, the jornada was closed...) NOTHING persists and the
 *     message names the ítem ("Ítem 2: ...").
 * Since the last ítems are confirmed here, the receta ends PREPARADA; the toma workspace stays on it to print.
 *
 * Lock order -- preparación -> receta -> partidas, like "Registrar pérdida" (./registrar-perdida-reserva.ts), with sets:
 *   1. every candidate preparación (INICIADA, read first), in id order, in one statement;
 *   2. the receta;
 *   3. every partida any of the confirmed reservas draws from, in id order, in one statement -- BEFORE the first
 *      asiento: per-ítem partida locks taken while already holding the asiento counter could wait on a confirmation
 *      that holds those partidas and waits on the counter.
 * `confirmarPreparacionEnTx` then re-locks its preparación, its partidas and the receta: re-locking a row this
 * transaction already holds never waits. A preparación that appears after step 1 (a reserva made meanwhile) is not
 * locked, and locking it now would invert the order: the command refuses ("volvé a intentar") instead.
 *
 * Permisos: `preparaciones.confirmar` via the pipeline (recent re-authentication, INV-X02, same window as
 * `confirmarPreparacion`) and `etiquetas.generar` checked first thing in the handler. Audited ONCE (the pipeline writes one row per command), on the receta
 * (CONFIRMAR), listing each confirmed preparación with its asiento and etiqueta.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { authorize } from "@/shared/auth/authorize";
import { AppError, DomainError, NotFoundError, userMessageFor } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { estadoItemToma, itemsSinReserva, mensajeItemsSinReserva, type EstadoItemToma } from "../domain/toma";
import { confirmarDesdeReservasEnTx } from "./confirmar-desde-reservas";
import {
  listItemIdsDeReceta,
  listPreparacionesVivasDeItems,
  listReservasDePreparacion,
  lockPartidasParaConfirmacion,
  lockPreparacionesParaAccion,
  lockRecetaParaTransicion,
  type ReservaDePreparacion,
} from "../infrastructure/preparacion-repository";

const confirmarReservasRecetaInput = z.object({ recetaId: uuid });

export interface EtiquetaDeRecetaConfirmada {
  preparacionId: string;
  numeroCorrelativo: string;
  etiquetaId: string;
}

/** Errors about the ítem itself get its number; anything else (authentication, unexpected) passes through untouched. */
const CODIGOS_DEL_ITEM: ReadonlySet<string> = new Set(["DOMAIN_ERROR", "NOT_FOUND", "CONFLICT", "INVARIANT_VIOLATION", "VALIDATION_ERROR"]);

function conNumeroDeItem(error: unknown, numero: number): unknown {
  if (!(error instanceof AppError) || !CODIGOS_DEL_ITEM.has(error.code)) return error;
  return new DomainError(`Ítem ${numero}: ${userMessageFor(error, "no se pudo confirmar.")}`, { cause: error });
}

export const confirmarReservasRecetaCommand = defineCommand({
  name: "preparaciones.confirmarReservasReceta",
  permiso: "preparaciones.confirmar",
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  input: confirmarReservasRecetaInput,
  audit: { entidad: "receta", accion: TipoAccion.CONFIRMAR },
  handler: async ({ tx, session, input }) => {
    // The pipeline checks one permiso: the etiquetas need their own.
    authorize(session, "etiquetas.generar");

    const itemIds = await listItemIdsDeReceta(tx, session.tenantId, input.recetaId);
    if (!itemIds) throw new NotFoundError("Receta no encontrada.");

    // 1-2. Preparaciones (id order), then the receta.
    const candidatas = (await listPreparacionesVivasDeItems(tx, session.tenantId, itemIds)).filter((p) => p.estado === "INICIADA");
    const bloqueadas = new Set(await lockPreparacionesParaAccion(tx, session.tenantId, candidatas.map((p) => p.id)));
    await lockRecetaParaTransicion(tx, session.tenantId, input.recetaId);

    // Re-read under the locks: a candidate confirmed or released meanwhile is no longer INICIADA.
    const vivas = await listPreparacionesVivasDeItems(tx, session.tenantId, itemIds);
    if (vivas.some((p) => p.estado === "INICIADA" && !bloqueadas.has(p.id))) {
      throw new DomainError("Se reservó el stock de un ítem de esta receta mientras se confirmaba: volvé a intentar.");
    }
    const aConfirmar: { numero: number; preparacionId: string; reservas: ReservaDePreparacion[] }[] = [];
    const estados: EstadoItemToma[] = [];
    for (const [indice, itemId] of itemIds.entries()) {
      const viva = vivas.find((p) => p.itemRecetaId === itemId && p.estado === "CONFIRMADA") ?? vivas.find((p) => p.itemRecetaId === itemId);
      const reservas = viva?.estado === "INICIADA" ? await listReservasDePreparacion(tx, session.tenantId, viva.id) : [];
      estados.push(estadoItemToma(viva ? { estado: viva.estado === "CONFIRMADA" ? "CONFIRMADA" : "INICIADA", reservas } : null));
      if (viva && viva.estado === "INICIADA" && reservas.length > 0) aConfirmar.push({ numero: indice + 1, preparacionId: viva.id, reservas });
    }
    // All or nothing: the receta's asientos are consecutive only when every ítem is confirmed here.
    const sinReserva = itemsSinReserva(estados);
    if (sinReserva.length > 0) throw new DomainError(mensajeItemsSinReserva(sinReserva));
    if (aConfirmar.length === 0) throw new DomainError("Todos los ítems de esta receta ya están confirmados.");

    // 3. Every partida, before the first asiento.
    await lockPartidasParaConfirmacion(tx, session.tenantId, [...new Set(aConfirmar.flatMap((c) => c.reservas.map((r) => r.partidaId)))]);

    const confirmadas: (EtiquetaDeRecetaConfirmada & { numero: number; asientoId: string; fechaVencimiento: string })[] = [];
    for (const { numero, preparacionId, reservas } of aConfirmar) {
      try {
        const confirmada = await confirmarDesdeReservasEnTx(tx, session, preparacionId, reservas);
        confirmadas.push({
          numero,
          preparacionId,
          numeroCorrelativo: confirmada.numeroCorrelativo,
          etiquetaId: confirmada.etiquetaId,
          asientoId: confirmada.asientoId,
          fechaVencimiento: confirmada.fechaVencimiento,
        });
      } catch (error) {
        throw conNumeroDeItem(error, numero);
      }
    }

    return {
      output: confirmadas.map(({ preparacionId, numeroCorrelativo, etiquetaId }) => ({ preparacionId, numeroCorrelativo, etiquetaId })),
      audit: {
        entidadId: input.recetaId,
        valorNuevo: {
          desdeReservaStock: true,
          preparaciones: confirmadas.map((c) => ({
            item: c.numero,
            preparacionId: c.preparacionId,
            estado: "CONFIRMADA",
            asientoRecetarioId: c.asientoId,
            asientoRecetario: `Nº ${c.numeroCorrelativo}`,
            numeroCorrelativo: c.numeroCorrelativo,
            fechaVencimiento: c.fechaVencimiento,
            etiquetaId: c.etiquetaId,
          })),
        },
      },
    };
  },
});

export async function confirmarReservasReceta(recetaId: string): Promise<EtiquetaDeRecetaConfirmada[]> {
  return confirmarReservasRecetaCommand.execute({ recetaId });
}
