/**
 * `stock.lote.elaborar` (openspec/changes/lotes-elaborados, EL1-EL8). Consumes partidas of the components and creates
 * ONE partida with origen ELABORACION_PROPIA:
 *
 *   - DILUCION: a partida of the SAME droga, with the computed potencia (the purity engine weighs from it unchanged);
 *   - FORMULA: a partida of another droga, optionally precargada from its fórmula (`formulaId`).
 *
 * Order (M3 discipline): lock every consumed partida (id order, the same as the confirmación), THEN read their free
 * balance (a reserva is only written under the same lock), validate (`validarElaboracion`), insert. The database
 * re-checks the whole at commit (migration 0111, INV-EL1..EL4, INV-S10, INV-S25).
 *
 * Controlled drogas are not limited while the contralor is off (user decision 2026-10-29). Once it is active, INV-L08
 * requires an asiento for every movement of a controlled droga and the elaboración asientos are not defined yet:
 * refused here with a clear message instead of the raw INV-L08 error (EL6).
 *
 * Quantities: each consumo in its droga's unidad base, the cantidad producida in the produced droga's unidad base.
 *
 * The lote code is assigned here, never typed (EL9): `DIL-`/`ELA-`, the jornada and the next number of the tipo, under
 * a per-tenant lock so two elaborations never take the same number.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { positiveDecimalString, uuid } from "@/shared/validation";
import { formulasDeDrogasEnTx } from "@/modules/drogas/application/formula-de-droga";
import { isoDate } from "../domain/partida";
import { MENSAJE_CONTRALOR_ELABORACION, codigoLoteElaborado, prefijoLoteElaborado, validarElaboracion } from "../domain/elaboracion-lote";
import { existePartidaLote, getFechaActivacionContralor, jornadaActualTenant } from "../infrastructure/partida-repository";
import {
  contarLotesConPrefijo,
  getDrogaProducida,
  getPartidasParaElaborar,
  insertLoteElaborado,
  lockNumeracionLotesElaborados,
  lockPartidasParaElaborar,
} from "../infrastructure/elaboracion-lote-repository";

const elaborarLoteInput = z.object({
  tipo: z.enum(["DILUCION", "FORMULA"]),
  drogaProducidaId: uuid,
  formulaId: uuid.optional(),
  cantidadProducida: positiveDecimalString,
  /** Absent = the earliest vencimiento consumed (EL5). */
  fechaVencimiento: isoDate.optional(),
  observacion: z.string().trim().max(500).optional(),
  consumos: z
    .array(z.object({ partidaId: uuid, cantidad: positiveDecimalString }))
    .min(1, "Indicá al menos un lote a consumir.")
    .max(50, "Una elaboración admite hasta 50 lotes."),
});

export interface ElaborarLoteInput {
  tipo: "DILUCION" | "FORMULA";
  drogaProducidaId: string;
  formulaId?: string;
  cantidadProducida: string;
  fechaVencimiento?: string;
  observacion?: string;
  consumos: { partidaId: string; cantidad: string }[];
}

export const elaborarLoteCommand = defineCommand({
  name: "stock.lote.elaborar",
  permiso: "stock.lote.elaborar",
  input: elaborarLoteInput,
  audit: { entidad: "partida", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    const tenantId = session.tenantId;
    const droga = await getDrogaProducida(tx, tenantId, input.drogaProducidaId);
    if (!droga) throw new NotFoundError("Droga no encontrada.");
    if (droga.deBaja) throw new DomainError(`${droga.nombre} está dada de baja: no se pueden elaborar lotes.`, { fields: ["drogaProducidaId"] });

    if (input.formulaId) {
      if (input.tipo === "DILUCION") throw new DomainError("Una dilución no se elabora desde una fórmula.");
      const formula = (await formulasDeDrogasEnTx(tx, tenantId, [droga.id])).get(droga.id);
      if (formula?.id !== input.formulaId) throw new DomainError("La fórmula no corresponde a la droga: recargá la página.");
    }

    const partidaIds = [...new Set(input.consumos.map((c) => c.partidaId))];
    const bloqueadas = await lockPartidasParaElaborar(tx, tenantId, partidaIds);
    if (bloqueadas.length !== partidaIds.length) throw new NotFoundError("Uno de los lotes ya no existe: recargá la página.");
    const partidas = new Map((await getPartidasParaElaborar(tx, tenantId, partidaIds)).map((p) => [p.id, p]));

    const controlada = droga.tipoControl !== "NINGUNO" || [...partidas.values()].some((p) => p.drogaTipoControl !== "NINGUNO");
    if (controlada && (await getFechaActivacionContralor(tx, tenantId)) !== null) throw new DomainError(MENSAJE_CONTRALOR_ELABORACION);

    const jornada = await jornadaActualTenant(tx, tenantId);
    const consumos = input.consumos.map((c) => {
      const p = partidas.get(c.partidaId)!;
      return {
        partidaId: p.id,
        lote: p.lote,
        drogaId: p.drogaId,
        drogaNombre: p.drogaNombre,
        cantidad: c.cantidad,
        cantidadDisponible: p.cantidadDisponible,
        costoUnitario: p.costoUnitario,
        potenciaDeclarada: p.potenciaDeclarada,
        fechaVencimiento: p.fechaVencimiento,
      };
    });
    const lote = validarElaboracion({
      tipo: input.tipo,
      drogaProducidaId: droga.id,
      drogaProducidaRequiereVencimiento: droga.clase === "DROGA",
      cantidadProducida: input.cantidadProducida,
      fechaVencimiento: input.fechaVencimiento ?? null,
      consumos,
      jornada,
    });

    // EL9: the next free number of the tipo in the jornada (a lot typed by hand with the same code is skipped).
    await lockNumeracionLotesElaborados(tx, tenantId);
    let usados = await contarLotesConPrefijo(tx, tenantId, prefijoLoteElaborado(input.tipo, jornada));
    let codigo = codigoLoteElaborado(input.tipo, jornada, usados);
    while (await existePartidaLote(tx, tenantId, droga.id, null, codigo)) codigo = codigoLoteElaborado(input.tipo, jornada, ++usados);

    const { partidaId, elaboracionLoteId } = await insertLoteElaborado(tx, {
      tenantId,
      tipo: input.tipo,
      drogaId: droga.id,
      formulaId: input.formulaId ?? null,
      lote: codigo,
      cantidadProducida: input.cantidadProducida.toString(),
      costoUnitario: lote.costoUnitario.toString(),
      potenciaDeclarada: lote.potenciaDeclarada?.toString() ?? null,
      fechaVencimiento: lote.fechaVencimiento,
      observacion: input.observacion ?? null,
      usuarioId: session.usuario.id,
      consumos: consumos.map((c) => ({ partidaId: c.partidaId, cantidad: c.cantidad.toString() })),
    });

    return {
      output: { partidaId },
      audit: {
        entidadId: partidaId,
        valorNuevo: {
          origen: "ELABORACION_PROPIA",
          elaboracionLoteId,
          tipo: input.tipo,
          droga: droga.nombre,
          lote: codigo,
          cantidadProducida: `${input.cantidadProducida.toString()} ${droga.unidadBaseSimbolo}`,
          potenciaDeclarada: lote.potenciaDeclarada?.toString() ?? null,
          costoUnitario: lote.costoUnitario.toString(),
          fechaVencimiento: lote.fechaVencimiento,
          consumos: consumos.map((c) => ({ droga: c.drogaNombre, lote: c.lote, cantidad: c.cantidad.toString() })),
        },
      },
    };
  },
});

export async function elaborarLote(input: ElaborarLoteInput): Promise<{ partidaId: string }> {
  return elaborarLoteCommand.execute(input);
}
