/**
 * `confirmarReservasReceta`: the toma workspace's "Imprimir etiquetas" (docs/specs/reserva-stock-preparacion.md, R13)
 * -- the end of the lab's process and the ONLY point where a reserved ítem becomes fixed (there is no single-ítem
 * variant). Confirms EVERY ítem of the receta from its reserva (`confirmarDesdeReservasEnTx`,
 * ./confirmar-desde-reservas.ts), in ONE transaction and in ítem order ("Ítem N" of the toma workspace), then writes the
 * receta's ONE asiento in the libro recetario with all of them (D8, docs/specs/libro-recetario-y-contralor.md §1:
 * `registrarAsientoRecetaEnTx`, ./registrar-asiento-receta.ts -- one number, one snapshot, the asiento_contralor
 * EGRESO rows right after it) and finally generates each ítem's etiqueta, which prints that asiento's Nº.
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
 *   3. every partida any of the confirmed reservas draws from, in id order, in one statement -- BEFORE the asiento,
 *      whose insert locks the libro's counter row until the commit (partida locks taken while holding the counter
 *      could wait on a confirmation that holds those partidas and waits on the counter).
 * `confirmarPreparacionEnTx` then re-locks its preparación, its partidas and the receta: re-locking a row this
 * transaction already holds never waits. A preparación that appears after step 1 (a reserva made meanwhile) is not
 * locked, and locking it now would invert the order: the command refuses ("volvé a intentar") instead.
 *
 * Permisos: `preparaciones.confirmar` via the pipeline (no re-authentication, user decision 2026-10-21) and `etiquetas.generar` checked first thing in the handler. Audited ONCE (the pipeline writes one row per command), on the receta
 * (CONFIRMAR): the receta's asiento and each confirmed preparación with its etiqueta.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { authorize } from "@/shared/auth/authorize";
import { AppError, DomainError, NotFoundError, userMessageFor } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { estadoItemToma, itemsSinReserva, mensajeItemsSinReserva, type EstadoItemToma } from "../domain/toma";
import { TIPOS_VENCIMIENTO_PREPARADO, TIPO_VENCIMIENTO_DEFAULT, type TipoVencimientoPreparado } from "../domain/vencimiento";
import { confirmarDesdeReservasEnTx } from "./confirmar-desde-reservas";
import { registrarAsientoRecetaEnTx, type ItemParaAsiento } from "./registrar-asiento-receta";
import { generarEtiquetaEnTx } from "./generar-etiqueta";
import {
  listItemIdsDeReceta,
  listPreparacionesVivasDeItems,
  listReservasDePreparacion,
  lockPartidasParaConfirmacion,
  lockPreparacionesParaAccion,
  lockRecetaParaTransicion,
  type RecetaContextoAsiento,
  type ReservaDePreparacion,
} from "../infrastructure/preparacion-repository";

/** docs/specs/vencimiento-preparado.md R10: per preparación, the tipo chosen in "Imprimir etiquetas"; one missing = `ESTANDAR`. */
const confirmarReservasRecetaInput = z.object({
  recetaId: uuid,
  tiposVencimiento: z.record(uuid, z.enum(TIPOS_VENCIMIENTO_PREPARADO)).default({}),
});

export interface EtiquetaDeRecetaConfirmada {
  preparacionId: string;
  etiquetaId: string;
}

/** The receta's one asiento (D8) and the etiqueta of each ítem confirmed, in ítem order. */
export interface RecetaConfirmada {
  asientoId: string;
  numeroCorrelativo: string;
  etiquetas: EtiquetaDeRecetaConfirmada[];
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
    // All or nothing: the receta's ítems go into ONE asiento (D8).
    const sinReserva = itemsSinReserva(estados);
    if (sinReserva.length > 0) throw new DomainError(mensajeItemsSinReserva(sinReserva));
    if (aConfirmar.length === 0) throw new DomainError("Todos los ítems de esta receta ya están confirmados.");

    // 3. Every partida, before the asiento.
    await lockPartidasParaConfirmacion(tx, session.tenantId, [...new Set(aConfirmar.flatMap((c) => c.reservas.map((r) => r.partidaId)))]);

    // 4. Every ítem: stock, CONFIRMADA, its libro data.
    const items: ItemParaAsiento[] = [];
    const vencimientos = new Map<string, { fechaVencimiento: string; tipoVencimiento: string }>();
    let contexto: RecetaContextoAsiento | null = null;
    for (const { numero, preparacionId, reservas } of aConfirmar) {
      try {
        const tipo = input.tiposVencimiento[preparacionId] ?? TIPO_VENCIMIENTO_DEFAULT;
        const confirmada = await confirmarDesdeReservasEnTx(tx, session, preparacionId, reservas, tipo);
        contexto ??= confirmada.contexto;
        items.push({ ...confirmada, numero, preparacionId });
        vencimientos.set(preparacionId, { fechaVencimiento: confirmada.fechaVencimiento, tipoVencimiento: confirmada.tipoVencimiento });
      } catch (error) {
        throw conNumeroDeItem(error, numero);
      }
    }
    if (!contexto) throw new DomainError("Todos los ítems de esta receta ya están confirmados.");

    // 5. The receta's ONE asiento (D8), then the etiquetas, which print its Nº.
    const asiento = await registrarAsientoRecetaEnTx(tx, session, { contexto, items });
    const etiquetas: (EtiquetaDeRecetaConfirmada & { numero: number })[] = [];
    for (const { numero, preparacionId } of aConfirmar) {
      try {
        const etiqueta = await generarEtiquetaEnTx(tx, session.tenantId, preparacionId);
        etiquetas.push({ numero, preparacionId, etiquetaId: etiqueta.id });
      } catch (error) {
        throw conNumeroDeItem(error, numero);
      }
    }

    return {
      output: { asientoId: asiento.id, numeroCorrelativo: asiento.numeroCorrelativo, etiquetas: etiquetas.map(({ preparacionId, etiquetaId }) => ({ preparacionId, etiquetaId })) },
      audit: {
        entidadId: input.recetaId,
        valorNuevo: {
          desdeReservaStock: true,
          asientoRecetarioId: asiento.id,
          asientoRecetario: `Nº ${asiento.numeroCorrelativo}`,
          numeroCorrelativo: asiento.numeroCorrelativo,
          preparaciones: etiquetas.map((e) => ({
            item: e.numero,
            preparacionId: e.preparacionId,
            estado: "CONFIRMADA",
            ...vencimientos.get(e.preparacionId),
            etiquetaId: e.etiquetaId,
          })),
        },
      },
    };
  },
});

export async function confirmarReservasReceta(recetaId: string, tiposVencimiento: Record<string, TipoVencimientoPreparado> = {}): Promise<RecetaConfirmada> {
  return confirmarReservasRecetaCommand.execute({ recetaId, tiposVencimiento });
}
